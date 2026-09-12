export const config = { maxDuration: 60 };

const NO_CAPTIONS_MESSAGE = 'This video has no captions. Please upload the video file directly.';
const API_KEY = process.env.YOUTUBE_API_KEY;

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0] || null;
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') {
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

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTimedText(body, format) {
  const raw = String(body || '').trim();
  if (!raw) return '';

  if (format === 'json3') {
    try {
      const data = JSON.parse(raw);
      const parts = [];

      for (const event of Array.isArray(data.events) ? data.events : []) {
        for (const segment of Array.isArray(event.segs) ? event.segs : []) {
          if (typeof segment.utf8 === 'string') parts.push(segment.utf8);
        }
      }

      return normalizeText(parts.join(' '));
    } catch (error) {
      console.error('[YouTube timedtext] json3 parse failed', {
        message: error instanceof Error ? error.message : String(error || ''),
        rawResponse: raw,
      });
      return '';
    }
  }

  // srv3 is XML. Strip the transcript tags and decode the common entities.
  if (format === 'srv3') {
    return normalizeText(
      raw
        .replace(/<text[^>]*>([\s\S]*?)<\/text>/gi, '$1 ')
        .replace(/<[^>]+>/g, ' ')
    );
  }

  return normalizeText(raw);
}

function buildYouTubeApiUrl(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function redactApiKey(url) {
  const safe = new URL(url);
  if (safe.searchParams.has('key')) safe.searchParams.set('key', '[REDACTED]');
  return safe.toString();
}

async function fetchYouTubeApi(endpoint, params, label) {
  const url = buildYouTubeApiUrl(endpoint, params);

  console.log(`[YouTube API] ${label} request`, {
    url: redactApiKey(url),
    hasApiKey: Boolean(API_KEY),
    apiKeyLength: API_KEY ? API_KEY.length : 0,
  });

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  const body = await response.text();

  console.log(`[YouTube API] ${label} raw response`, {
    status: response.status,
    ok: response.ok,
    body,
  });

  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }

  return { response, body, data };
}

async function getVideoMetadata(videoId) {
  const result = await fetchYouTubeApi(
    'videos',
    { part: 'snippet', id: videoId, key: API_KEY },
    `video metadata (${videoId})`
  );

  if (!result.response.ok) {
    throw new Error(
      `YouTube videos API failed with HTTP ${result.response.status}. Raw response: ${result.body.slice(0, 4000)}`
    );
  }

  const item = result.data?.items?.[0];
  if (!item) {
    return { exists: false, defaultLanguage: null, defaultAudioLanguage: null };
  }

  return {
    exists: true,
    defaultLanguage: item.snippet?.defaultLanguage || null,
    defaultAudioLanguage: item.snippet?.defaultAudioLanguage || null,
    title: item.snippet?.title || null,
  };
}

async function confirmCaptionsExist(videoId) {
  const result = await fetchYouTubeApi(
    'captions',
    { part: 'snippet', videoId, key: API_KEY },
    `captions list (${videoId})`
  );

  if (!result.response.ok) {
    throw new Error(
      `YouTube captions API failed with HTTP ${result.response.status}. Raw response: ${result.body.slice(0, 4000)}`
    );
  }

  const items = Array.isArray(result.data?.items) ? result.data.items : [];

  console.log('[YouTube API] captions confirmation', {
    videoId,
    captionCount: items.length,
    tracks: items.map((track) => ({
      id: track?.id,
      language: track?.snippet?.language,
      trackKind: track?.snippet?.trackKind,
      status: track?.snippet?.status,
      name: track?.snippet?.name,
    })),
  });

  return items;
}

async function fetchTimedText(videoId, format, lang) {
  const url = new URL('https://www.youtube.com/api/timedtext');
  url.searchParams.set('v', videoId);
  url.searchParams.set('fmt', format);
  if (lang) url.searchParams.set('lang', lang);

  console.log('[YouTube timedtext] attempt request', {
    videoId,
    format,
    lang: lang || null,
    url: url.toString(),
  });

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: '*/*',
    },
  });
  const body = await response.text();

  // Intentionally log the full response from every attempt for Vercel diagnostics.
  console.log('[YouTube timedtext] attempt full response', {
    videoId,
    format,
    lang: lang || null,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    body,
  });

  if (!response.ok) return '';

  return parseTimedText(body, format);
}

async function fetchYouTubeTranscript(videoId, defaultLanguage) {
  // Requested order: srv3/en, srv3/en-US, json3/en, srv3/no-lang, json3/no-lang.
  // If the Data API says the video's default language is English, use the requested
  // English attempts first. We still preserve the exact five-attempt fallback order.
  const attempts = [
    { format: 'srv3', lang: 'en' },
    { format: 'srv3', lang: 'en-US' },
    { format: 'json3', lang: 'en' },
    { format: 'srv3', lang: null },
    { format: 'json3', lang: null },
  ];

  console.log('[YouTube timedtext] starting caption fetch', {
    videoId,
    defaultLanguage: defaultLanguage || null,
    attempts,
  });

  for (const attempt of attempts) {
    try {
      const text = await fetchTimedText(videoId, attempt.format, attempt.lang);
      if (text) {
        return {
          text,
          format: attempt.format,
          lang: attempt.lang,
        };
      }
    } catch (error) {
      console.error('[YouTube timedtext] attempt failed', {
        videoId,
        format: attempt.format,
        lang: attempt.lang || null,
        message: error instanceof Error ? error.message : String(error || ''),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  return { text: '', format: null, lang: null };
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

  console.log(`[transcribe-video:${requestId}] YouTube timedtext configuration`, {
    hasApiKey: Boolean(API_KEY),
    apiKeyLength: API_KEY ? API_KEY.length : 0,
    hasUrl: Boolean(url),
    videoId,
  });

  if (!videoId) {
    return res.status(400).json({ error: 'Add a valid YouTube video URL.', requestId });
  }

  if (!API_KEY) {
    return res.status(500).json({
      error: 'YOUTUBE_API_KEY is not available to this Vercel API route. Check the Vercel environment variable name and redeploy.',
      requestId,
      code: 'MISSING_YOUTUBE_API_KEY',
    });
  }

  try {
    // First use the Data API to confirm the video exists and read its default language.
    const metadata = await getVideoMetadata(videoId);

    if (!metadata.exists) {
      return res.status(422).json({
        error: NO_CAPTIONS_MESSAGE,
        requestId,
        code: 'VIDEO_NOT_FOUND',
      });
    }

    console.log(`[transcribe-video:${requestId}] video metadata`, {
      videoId,
      defaultLanguage: metadata.defaultLanguage,
      defaultAudioLanguage: metadata.defaultAudioLanguage,
      title: metadata.title,
    });

    // Then confirm that YouTube reports at least one caption track for the video.
    const tracks = await confirmCaptionsExist(videoId);

    if (!tracks.length) {
      console.log(`[transcribe-video:${requestId}] Data API reports no caption tracks`, { videoId });
      return res.status(422).json({
        error: NO_CAPTIONS_MESSAGE,
        requestId,
        code: 'NO_CAPTIONS',
      });
    }

    const result = await fetchYouTubeTranscript(videoId, metadata.defaultLanguage);

    if (!result.text) {
      console.log(`[transcribe-video:${requestId}] timedtext returned no transcript`, {
        videoId,
        captionTrackCount: tracks.length,
      });
      return res.status(422).json({
        error: NO_CAPTIONS_MESSAGE,
        requestId,
        code: 'TIMEDTEXT_EMPTY',
      });
    }

    console.log(`[transcribe-video:${requestId}] YouTube timedtext transcript success`, {
      videoId,
      format: result.format,
      lang: result.lang,
      textLength: result.text.length,
    });

    return res.status(200).json({
      text: result.text,
      title: metadata.title || 'YouTube lecture transcript',
      requestId,
    });
  } catch (error) {
    console.error(`[transcribe-video:${requestId}] YouTube transcription failed`, {
      videoId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error || ''),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const message = error instanceof Error ? error.message : String(error || '');

    return res.status(422).json({
      error: `${NO_CAPTIONS_MESSAGE}\n\nYouTube diagnostic: ${message}`,
      requestId,
      code: 'CAPTIONS_UNAVAILABLE',
    });
  }
}
