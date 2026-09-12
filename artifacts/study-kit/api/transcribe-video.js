export const config = { maxDuration: 60 };

const FALLBACK_MESSAGE = 'Could not get captions. Please upload the video file directly instead.';

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0] || null;
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');

      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) return parts[1] || null;
    }
  } catch {
    // Invalid URL is handled by the caller.
  }

  return null;
}

function encodeTranscriptParams(videoId) {
  return Buffer.from(`\n\x0b${videoId}`).toString('base64');
}

function extractTranscriptText(data) {
  const texts = [];

  function visit(value) {
    if (!value || typeof value !== 'object') return;

    if (typeof value.text === 'string') texts.push(value.text);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else {
      for (const child of Object.values(value)) visit(child);
    }
  }

  visit(data);
  return texts
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

async function fetchInnertubeTranscript(videoId) {
  const params = encodeTranscriptParams(videoId);

  const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240101',
        },
      },
      params,
    }),
  });

  const bodyText = await response.text();
  let data = null;

  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`YouTube Innertube returned HTTP ${response.status}`);
  }

  const text = extractTranscriptText(data);
  if (!text) throw new Error('YouTube Innertube returned no transcript text');

  return text;
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

  console.log(`[transcribe-video:${requestId}] Innertube request`, {
    hasUrl: Boolean(url),
    videoId,
  });

  if (!videoId) {
    return res.status(400).json({ error: 'Add a valid YouTube video URL.', requestId });
  }

  try {
    const text = await fetchInnertubeTranscript(videoId);

    console.log(`[transcribe-video:${requestId}] Innertube transcript success`, {
      videoId,
      textLength: text.length,
    });

    return res.status(200).json({
      text,
      title: 'YouTube lecture transcript',
      requestId,
    });
  } catch (error) {
    console.error(`[transcribe-video:${requestId}] Innertube transcript failed`, {
      videoId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error || ''),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.status(422).json({
      error: FALLBACK_MESSAGE,
      requestId,
      code: 'CAPTIONS_UNAVAILABLE',
    });
  }
}
