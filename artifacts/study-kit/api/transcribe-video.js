import { fetchTranscript } from 'youtube-transcript';
import { Innertube, UniversalCache } from 'youtubei.js';

export const config = { maxDuration: 60 };

const NO_CAPTIONS_MESSAGE =
  'This video has no captions available. Please upload the video file directly instead.';
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
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
        return parts[1] || null;
      }
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

function isNoCaptionsError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  return (
    normalized.includes('transcript is disabled') ||
    normalized.includes('no transcript') ||
    normalized.includes('transcripts disabled') ||
    normalized.includes('captions') ||
    normalized.includes('subtitle') ||
    normalized.includes('no transcript')
  );
}

async function getCaptionTranscript(videoId) {
  // youtube-transcript 1.3.1 accepts a language option. Try the requested
  // English variants in priority order, then let the package discover its
  // available/auto-generated English transcript.
  const languageAttempts = ['en', 'en-US', 'en-GB'];
  let lastError = null;

  for (const lang of languageAttempts) {
    try {
      const transcript = await fetchTranscript(videoId, { lang });
      const text = transcriptToText(transcript);
      if (text) return text;
    } catch (error) {
      lastError = error;
      if (isPrivateOrAgeRestrictedError(error)) throw error;
    }
  }

  try {
    const transcript = await fetchTranscript(videoId);
    const text = transcriptToText(transcript);
    if (text) return text;
  } catch (error) {
    lastError = error;
    if (isPrivateOrAgeRestrictedError(error)) throw error;
  }

  throw lastError || new Error('No YouTube captions were found.');
}

function getProxyUrl() {
  const value = process.env.YOUTUBE_PROXY_URL?.trim();
  return value || null;
}

async function createInnertube() {
  const proxyUrl = getProxyUrl();
  const options = {
    cache: new UniversalCache(false),
    generate_session_locally: true,
  };

  // If a YOUTUBE_PROXY_URL is configured, youtubei.js will use it for its
  // requests. This keeps the fallback deployable on Vercel without changing
  // the working direct-upload path.
  if (proxyUrl) {
    options.http = { proxy: proxyUrl };
  }

  return Innertube.create(options);
}

async function downloadAudio(videoId) {
  const youtube = await createInnertube();
  const info = await youtube.getBasicInfo(videoId);

  const status = info.playability_status?.status;
  if (status === 'LOGIN_REQUIRED' || status === 'ERROR') {
    const reason = info.playability_status?.reason || '';
    throw new Error(reason || status);
  }

  // Request audio only. youtubei.js selects an adaptive audio format and
  // returns a stream; no video stream is downloaded.
  const stream = await youtube.download(videoId, {
    type: 'audio',
    quality: 'best',
    format: 'mp4',
  });

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 24 * 1024 * 1024) {
      throw new Error('YouTube audio is too large for the Groq transcription fallback.');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function transcribeAudioWithGroq(audioBuffer) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured.');

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/mp4' }), 'youtube-audio.mp4');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Groq transcription failed (${response.status}).`);
  }

  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!text) throw new Error('Groq returned an empty transcription.');
  return text;
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
    // 1) Captions first. This is intentionally the cheapest/most reliable path.
    try {
      const text = await getCaptionTranscript(videoId);
      return res.status(200).json({ text, title: 'YouTube lecture transcript' });
    } catch (captionError) {
      if (isPrivateOrAgeRestrictedError(captionError)) {
        return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
      }

      if (!isNoCaptionsError(captionError)) {
        console.error('YouTube caption lookup failed; trying audio fallback:', captionError);
      }
    }

    // 2) No usable captions: audio-only youtubei.js -> Groq Whisper.
    try {
      const audio = await downloadAudio(videoId);
      const text = await transcribeAudioWithGroq(audio);
      return res.status(200).json({ text, title: 'YouTube lecture transcript' });
    } catch (audioError) {
      console.error('YouTube audio fallback failed:', audioError);
      if (isPrivateOrAgeRestrictedError(audioError)) {
        return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
      }
      return res.status(502).json({
        error:
          'Could not transcribe this YouTube video. Captions were unavailable and the audio fallback could not access the video. Please try another public video or upload the video file directly.',
      });
    }
  } catch (error) {
    console.error('YouTube transcription failed:', error);
    if (isPrivateOrAgeRestrictedError(error)) {
      return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
    }
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Could not transcribe this YouTube video.',
    });
  }
}
