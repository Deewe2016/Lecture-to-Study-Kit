import { fetchTranscript } from 'youtube-transcript';

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

function isCaptionUnavailableError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  return (
    normalized.includes('transcript is disabled') ||
    normalized.includes('no transcript') ||
    normalized.includes('transcripts disabled') ||
    normalized.includes('captions') ||
    normalized.includes('transcript') ||
    normalized.includes('subtitle')
  );
}

async function getCaptionTranscript(videoId) {
  const transcript = await fetchTranscript(videoId);
  const text = transcriptToText(transcript);
  if (!text) throw new Error('YouTube captions were empty.');
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
    // YouTube URL transcription is intentionally captions-only. We do not use
    // youtubei.js, ytdl-core, yt-dlp, or any audio downloader here because those
    // approaches are unreliable from Vercel server IPs.
    try {
      const text = await getCaptionTranscript(videoId);
      return res.status(200).json({ text, title: 'YouTube lecture transcript' });
    } catch (captionError) {
      if (isPrivateOrAgeRestrictedError(captionError)) {
        return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
      }

      if (isCaptionUnavailableError(captionError)) {
        return res.status(404).json({ error: NO_CAPTIONS_MESSAGE });
      }

      console.error('YouTube caption lookup failed:', captionError);
      return res.status(502).json({
        error: 'Could not retrieve captions from this YouTube video. Please try another public video or upload the video file directly.',
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
