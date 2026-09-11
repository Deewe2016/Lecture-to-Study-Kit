import { fetchTranscript } from 'youtube-transcript';
import { Innertube } from 'youtubei.js';

export const config = { maxDuration: 60 };

const PRIVATE_OR_AGE_RESTRICTED_MESSAGE =
  'This video is private or age-restricted. Please try a public YouTube video.';

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] || null;
    }
  } catch {}
  return null;
}

function transcriptToText(transcript) {
  if (!Array.isArray(transcript)) return '';
  return transcript
    .map((item) => (typeof item === 'string' ? item : item?.text || ''))
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function getCaptionTranscript(videoId) {
  const transcript = await fetchTranscript(videoId);
  const text = transcriptToText(transcript);
  if (!text) throw new Error('YouTube captions were empty.');
  return text;
}

function getAudioMimeType(mimeType, extension) {
  const normalized = (mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (normalized.startsWith('audio/')) return normalized;

  switch ((extension || '').toLowerCase()) {
    case 'm4a': return 'audio/mp4';
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'wav': return 'audio/wav';
    case 'webm': return 'audio/webm';
    default: return 'audio/mp4';
  }
}

function isPrivateOrAgeRestrictedError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  return (
    normalized.includes('login required') ||
    normalized.includes('age-restricted') ||
    normalized.includes('age restricted') ||
    normalized.includes('private video') ||
    normalized.includes('video is private') ||
    normalized.includes('sign in to confirm your age') ||
    normalized.includes('confirm your age')
  );
}

async function downloadYouTubeAudio(videoId) {
  // Pure JavaScript/Node.js YouTube extraction. No Python, yt-dlp, or external
  // executable is used. youtubei.js returns a Web ReadableStream in Node.
  const youtube = await Innertube.create();
  const stream = await youtube.download(videoId, {
    type: 'audio',
    quality: 'best',
  });

  if (!stream) throw new Error('YouTube did not provide an audio stream.');

  const reader = stream.getReader();
  const chunks = [];
  let totalBytes = 0;
  const maxBytes = 25 * 1024 * 1024;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        throw new Error("The YouTube audio is larger than Groq's 25 MB file-upload limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (!chunks.length) throw new Error('YouTube returned no audio data.');

  // youtubei.js selects an audio format for us. Groq accepts common audio
  // containers directly; m4a/mp4 is the usual result for best audio.
  const extension = 'm4a';
  const mimeType = getAudioMimeType('audio/mp4', extension);
  return { audio: Buffer.concat(chunks), extension, mimeType };
}

async function transcribeWithGroq(audio, extension, mimeType) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured in Vercel.');

  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), `youtube-audio.${extension}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Groq transcription failed (HTTP ${response.status}): ${details.slice(0, 300)}`);
  }
  const data = await response.json();
  if (!data?.text?.trim()) throw new Error('Groq returned an empty transcript.');
  return data.text.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const input = req.body || {};
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).json({ error: 'Add a valid YouTube video URL.' });

  try {
    // First try the video's existing captions. This avoids downloading audio entirely.
    try {
      const text = await getCaptionTranscript(videoId);
      return res.status(200).json({ text, title: 'YouTube lecture transcript' });
    } catch (captionError) {
      // If YouTube itself tells us the video requires login/age verification,
      // do not attempt a fallback that will fail for the same reason.
      if (isPrivateOrAgeRestrictedError(captionError)) {
        return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
      }

      console.warn('YouTube captions unavailable; falling back to youtubei.js + Groq:', captionError);
    }

    // No captions: download the audio directly with youtubei.js, then send it to Groq Whisper.
    try {
      const { audio, extension, mimeType } = await downloadYouTubeAudio(videoId);
      const text = await transcribeWithGroq(audio, extension, mimeType);
      return res.status(200).json({ text, title: 'YouTube lecture transcript' });
    } catch (fallbackError) {
      if (isPrivateOrAgeRestrictedError(fallbackError)) {
        return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
      }
      throw fallbackError;
    }
  } catch (error) {
    console.error('YouTube transcription failed:', error);

    // Keep all expected YouTube access failures inside the API response so the
    // frontend can show a normal error state instead of crashing.
    if (isPrivateOrAgeRestrictedError(error)) {
      return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
    }

    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Could not transcribe this YouTube video.',
    });
  }
}
