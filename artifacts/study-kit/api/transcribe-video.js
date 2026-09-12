export const config = { maxDuration: 60 };

const NO_CAPTIONS_MESSAGE = 'No captions found';
const PRIVATE_OR_AGE_RESTRICTED_MESSAGE =
  'This video is private or age-restricted. Please try a public YouTube video.';

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0] || null;
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') {
        // Only the v parameter is used, so playlist/list and other parameters
        // are deliberately ignored.
        return url.searchParams.get('v');
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) {
        return parts[1] || null;
      }
    }
  } catch {
    // Invalid URL is handled by the caller.
  }

  return null;
}

function transcriptToText(data) {
  if (!data || typeof data !== 'object') return '';

  const events = Array.isArray(data.events) ? data.events : [];
  return events
    .flatMap((event) => (Array.isArray(event.segs) ? event.segs : []))
    .map((segment) => (typeof segment?.utf8 === 'string' ? segment.utf8 : ''))
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function isPrivateOrAgeRestrictedResponse(response, bodyText) {
  const normalized = `${response.status} ${bodyText}`.toLowerCase();
  return (
    response.status === 401 ||
    response.status === 403 ||
    normalized.includes('login required') ||
    normalized.includes('age-restricted') ||
    normalized.includes('age restricted') ||
    normalized.includes('private video') ||
    normalized.includes('confirm your age')
  );
}

async function fetchTimedText(videoId, lang) {
  const params = new URLSearchParams({ v: videoId, fmt: 'json3' });
  if (lang) params.set('lang', lang);

  const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const bodyText = await response.text();

  if (!response.ok) {
    const error = new Error(`YouTube timedtext returned HTTP ${response.status}`);
    error.status = response.status;
    error.privateOrAgeRestricted = isPrivateOrAgeRestrictedResponse(response, bodyText);
    throw error;
  }

  if (!bodyText.trim()) return '';

  try {
    return transcriptToText(JSON.parse(bodyText));
  } catch {
    // A non-JSON/empty response means this caption attempt did not produce a
    // usable transcript. The caller will try the next caption variant.
    return '';
  }
}

async function getCaptionTranscript(videoId) {
  let lastError = null;

  // Requested order: English, en-US, then no lang (auto-generated/available).
  for (const lang of ['en', 'en-US', null]) {
    try {
      const text = await fetchTimedText(videoId, lang);
      if (text) return text;
    } catch (error) {
      lastError = error;
      if (error?.privateOrAgeRestricted) throw error;
    }
  }

  if (lastError?.privateOrAgeRestricted) throw lastError;
  return '';
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

  console.log(`[transcribe-video:${requestId}] request`, {
    hasUrl: Boolean(url),
    videoId,
  });

  if (!videoId) {
    return res.status(400).json({ error: 'Add a valid YouTube video URL.', requestId });
  }

  try {
    const text = await getCaptionTranscript(videoId);

    if (!text) {
      console.log(`[transcribe-video:${requestId}] no captions found`, { videoId });
      return res.status(422).json({ error: NO_CAPTIONS_MESSAGE, requestId, code: 'NO_CAPTIONS' });
    }

    console.log(`[transcribe-video:${requestId}] transcript success`, {
      videoId,
      textLength: text.length,
    });

    return res.status(200).json({
      text,
      title: 'YouTube lecture transcript',
      requestId,
    });
  } catch (error) {
    console.error(`[transcribe-video:${requestId}] timedtext lookup failed`, {
      videoId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error || ''),
      status: error?.status,
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (error?.privateOrAgeRestricted) {
      return res.status(403).json({ error: PRIVATE_OR_AGE_RESTRICTED_MESSAGE, requestId });
    }

    // Do not turn a server/network failure into a false "no captions" result.
    return res.status(502).json({
      error: 'YouTube could not be reached from the server while fetching captions. Please try again or upload the video file directly.',
      requestId,
      code: 'YOUTUBE_ACCESS_FAILED',
    });
  }
}
