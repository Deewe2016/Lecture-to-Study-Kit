import { fetchTranscript } from 'youtube-transcript';
import youtubedl from 'youtube-dl-exec';

export const config = { maxDuration: 60 };

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

function getAudioMimeType(extension) {
  switch ((extension || '').toLowerCase()) {
    case 'm4a': return 'audio/mp4';
    case 'mp3': return 'audio/mpeg';
    case 'ogg': return 'audio/ogg';
    case 'wav': return 'audio/wav';
    default: return 'audio/webm';
  }
}

async function downloadYouTubeAudio(url) {
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    skipDownload: true,
    noPlaylist: true,
    quiet: true,
    noWarnings: true,
  });

  const extension = info?.ext || 'webm';
  const mimeType = getAudioMimeType(extension);
  const subprocess = youtubedl.exec(url, {
    format: 'bestaudio',
    output: '-',
    noPlaylist: true,
    quiet: true,
    noWarnings: true,
  }, { timeout: 50000 });

  const chunks = [];
  let totalBytes = 0;
  const maxBytes = 25 * 1024 * 1024;
  subprocess.stdout.on('data', (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes <= maxBytes) chunks.push(buffer);
    else subprocess.kill('SIGKILL');
  });

  try {
    await subprocess;
  } catch (error) {
    if (totalBytes > maxBytes) throw new Error("The YouTube audio is larger than Groq's 25 MB file-upload limit.");
    throw error;
  }

  if (!chunks.length) throw new Error('yt-dlp returned no audio data.');
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
      console.warn('YouTube captions unavailable; falling back to yt-dlp + Groq:', captionError);
    }

    // If captions are unavailable, download audio with yt-dlp and transcribe it with Groq Whisper.
    const { audio, extension, mimeType } = await downloadYouTubeAudio(url);
    const text = await transcribeWithGroq(audio, extension, mimeType);
    return res.status(200).json({ text, title: 'YouTube lecture transcript' });
  } catch (error) {
    console.error('YouTube transcription failed:', error);
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Could not transcribe this YouTube video.',
    });
  }
}
