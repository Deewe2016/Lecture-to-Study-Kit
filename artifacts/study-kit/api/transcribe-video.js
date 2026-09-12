import { fetchTranscript } from 'youtube-transcript';

export const config = { maxDuration: 60 };

const NO_CAPTIONS_MESSAGE =
  'This video has no captions. Please upload the video file directly instead.';
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
  } catch {
    // Invalid URL is handled by the caller.
  }
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || '');
}

function isPrivateOrAgeRestrictedError(error) {
  const normalized = getErrorMessage(error).toLowerCase();
  return normalized.includes('login required') || normalized.includes('age-restricted') || normalized.includes('age restricted') || normalized.includes('private video') || normalized.includes('video is private') || normalized.includes('sign in to confirm your age') || normalized.includes('confirm your age');
}

function isNoCaptionsError(error) {
  const normalized = getErrorMessage(error).toLowerCase();
  return normalized.includes('transcript is disabled') || normalized.includes('no transcript') || normalized.includes('transcripts disabled') || normalized.includes('no captions') || normalized.includes('captions are not available') || normalized.includes('subtitles are not available') || normalized.includes('subtitle');
}

async function getCaptionTranscript(videoId) {
  let lastError = null;
  for (const lang of ['en', 'en-US', 'en-GB']) {
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
  throw lastError || new Error('No captions available for this video.');
}

export default async function handler(req, res) {
  const requestId = `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.', requestId });
  }

  const input = req.body || {};
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const videoId = getYouTubeVideoId(url);
  console.log(`[transcribe-video:${requestId}] request`, { hasUrl: Boolean(url), videoId });

  if (!videoId) return res.status(400).json({ error: 'Add a valid YouTube video URL.', requestId });

  try {
    const text = await getCaptionTranscript(videoId);
    console.log(`[transcribe-video:${requestId}] transcript success`, { videoId, textLength: text.length });
    return res.status(200).json({ text, title: 'YouTube lecture transcript', requestId });
  } catch (error) {
    console.error(`[transcribe-video:${requestId}] caption lookup failed`, {
      videoId,
      name: error instanceof Error ? error.name : typeof error,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (isPrivateOrAgeRestrictedError(error)) {
      return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE, requestId });
    }

    if (isNoCaptionsError(error)) {
      // This must be a non-2xx response. Returning 200 here makes the frontend
      // treat { error: ... } as a successful transcript and pass empty text
      // into /api/generate-kit.
      return res.status(422).json({ error: NO_CAPTIONS_MESSAGE, requestId, code: 'NO_CAPTIONS' });
    }

    return res.status(502).json({
      error: 'YouTube could not be reached from the server while fetching captions. Please try again or upload the video file directly.',
      requestId,
      code: 'YOUTUBE_ACCESS_FAILED',
    });
  }
}
