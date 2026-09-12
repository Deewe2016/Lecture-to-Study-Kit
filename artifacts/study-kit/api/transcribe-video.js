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

    // youtu.be/<id>?list=... -> only keep <id>
    if (hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0] || null;
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      // youtube.com/watch?v=<id>&list=... -> only keep v=<id>
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
        return parts[1] || null;
      }
    }
  } catch {
    // Handled by the caller as an invalid URL.
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
  const normalized = getErrorMessage(error).toLowerCase();
  return (
    normalized.includes('transcript is disabled') ||
    normalized.includes('no transcript') ||
    normalized.includes('transcripts disabled') ||
    normalized.includes('no captions') ||
    normalized.includes('captions are not available') ||
    normalized.includes('subtitles are not available') ||
    normalized.includes('subtitle')
  );
}

async function getCaptionTranscript(videoId) {
  let lastError = null;

  // 1) English first. youtube-transcript can return either uploaded or
  // auto-generated English when YouTube exposes it under the requested code.
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

  // 2) Auto-generated / default YouTube caption track. youtube-transcript's
  // no-language call selects the first available caption track, which is the
  // package's supported way to reach an auto-generated track when one exists.
  try {
    const transcript = await fetchTranscript(videoId);
    const text = transcriptToText(transcript);
    if (text) return text;
  } catch (error) {
    lastError = error;
    if (isPrivateOrAgeRestrictedError(error)) throw error;
  }

  // 3) No language restriction: the package has exhausted its available
  // caption-track selection, so there is no usable caption transcript.
  throw lastError || new Error('No captions available for this video.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const input = req.body || {};
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  const videoId = getYouTubeVideoId(url);

  if (!videoId) {
    return res.status(400).json({ error: 'Add a valid YouTube video URL.' });
  }

  try {
    const text = await getCaptionTranscript(videoId);
    return res.status(200).json({ text, title: 'YouTube lecture transcript' });
  } catch (error) {
    console.error('YouTube caption lookup failed:', error);

    if (isPrivateOrAgeRestrictedError(error)) {
      return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE });
    }

    if (isNoCaptionsError(error)) {
      return res.status(200).json({ error: NO_CAPTIONS_MESSAGE });
    }

    // Do not falsely report a YouTube/Vercel network or IP-block failure as
    // "no captions". The caller can then distinguish access failures from a
    // video that genuinely has no caption track.
    return res.status(502).json({
      error:
        'YouTube could not be reached from the server while fetching captions. Please try again or upload the video file directly.',
    });
  }
}
