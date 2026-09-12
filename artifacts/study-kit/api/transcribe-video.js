export const config = { maxDuration: 60 };

const NO_CAPTIONS_MESSAGE = 'This video has no captions. Please upload the video file directly.';
const API_KEY = process.env.YOUTUBE_API_KEY;
const DIAGNOSTIC_VIDEO_ID = 'arj7oStGLkU';

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0] || null;
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') {
        // Only the v parameter is used; playlist parameters are intentionally ignored.
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

function parseCaptionTrack(body) {
  const raw = String(body || '').trim();
  if (!raw) return '';

  if (/^WEBVTT(?:\s|$)/i.test(raw)) {
    return normalizeText(
      raw
        .replace(/^WEBVTT[^\n]*\n?/i, '')
        .replace(/\n?\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}[^\n]*\n?/g, '\n')
        .replace(/\n?\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}[^\n]*\n?/g, '\n')
    );
  }

  const withoutSrtMetadata = raw
    .split('\n')
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .filter((line) => !/^\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(line));

  return normalizeText(withoutSrtMetadata.join('\n'));
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

  // Log the complete response body so Vercel logs show exactly what Google returned.
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

async function listCaptionTracks(videoId) {
  if (!API_KEY) {
    throw new Error('YOUTUBE_API_KEY is missing from the Vercel environment variables');
  }

  const result = await fetchYouTubeApi(
    'captions',
    { part: 'snippet', videoId, key: API_KEY },
    `captions list (${videoId})`
  );

  if (!result.response.ok) {
    const apiMessage = result.data?.error?.message || `YouTube Data API returned HTTP ${result.response.status}`;
    throw new Error(
      `${apiMessage}. Raw YouTube captions API response: ${result.body.slice(0, 4000)}`
    );
  }

  return Array.isArray(result.data?.items) ? result.data.items : [];
}

async function verifyVideosEndpoint(videoId) {
  if (!API_KEY) return;

  try {
    const result = await fetchYouTubeApi(
      'videos',
      { part: 'snippet', id: videoId, key: API_KEY },
      `videos diagnostic (${videoId})`
    );

    console.log('[YouTube API] videos endpoint diagnostic result', {
      videoId,
      status: result.response.status,
      ok: result.response.ok,
      itemCount: Array.isArray(result.data?.items) ? result.data.items.length : 0,
      error: result.data?.error || null,
      rawResponse: result.body,
    });
  } catch (error) {
    console.error('[YouTube API] videos diagnostic failed', {
      videoId,
      message: error instanceof Error ? error.message : String(error || ''),
    });
  }
}

async function downloadCaptionTrack(trackId) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY is missing from the Vercel environment variables');

  const result = await fetchYouTubeApi(
    'captions/download',
    { id: trackId, key: API_KEY, tfmt: 'vtt' },
    `caption download (${trackId})`
  );

  if (!result.response.ok) {
    throw new Error(
      `Caption download failed with HTTP ${result.response.status}. Raw YouTube caption download response: ${result.body.slice(0, 4000)}`
    );
  }

  return parseCaptionTrack(result.body);
}

function chooseCaptionTracks(items) {
  return [...items].sort((a, b) => {
    const aSnippet = a?.snippet || {};
    const bSnippet = b?.snippet || {};

    const score = (snippet) => {
      let value = 0;
      if (snippet.language === 'en') value += 100;
      else if (snippet.language?.startsWith('en')) value += 80;
      if (snippet.trackKind === 'ASR') value += 10;
      if (snippet.status === 'serving') value += 5;
      return value;
    };

    return score(bSnippet) - score(aSnippet);
  });
}

async function fetchYouTubeTranscript(videoId) {
  const tracks = chooseCaptionTracks(await listCaptionTracks(videoId));

  console.log('[YouTube API] caption tracks parsed', {
    videoId,
    count: tracks.length,
    tracks: tracks.map((track) => ({
      id: track?.id,
      language: track?.snippet?.language,
      trackKind: track?.snippet?.trackKind,
      status: track?.snippet?.status,
      name: track?.snippet?.name,
    })),
  });

  if (!tracks.length) {
    return { text: '', trackId: null };
  }

  let lastDownloadError = null;

  for (const track of tracks) {
    if (!track?.id) continue;

    try {
      const text = await downloadCaptionTrack(track.id);
      if (text) return { text, trackId: track.id };
    } catch (error) {
      lastDownloadError = error;
      console.error('YouTube caption track download failed', {
        trackId: track.id,
        language: track?.snippet?.language,
        trackKind: track?.snippet?.trackKind,
        message: error instanceof Error ? error.message : String(error || ''),
      });
    }
  }

  if (lastDownloadError) throw lastDownloadError;
  return { text: '', trackId: null };
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

  console.log(`[transcribe-video:${requestId}] YouTube Data API configuration`, {
    hasApiKey: Boolean(API_KEY),
    apiKeyLength: API_KEY ? API_KEY.length : 0,
    apiKeyPrefix: API_KEY ? `${API_KEY.slice(0, 4)}...` : null,
    diagnosticVideoId: DIAGNOSTIC_VIDEO_ID,
  });

  console.log(`[transcribe-video:${requestId}] YouTube Data API request`, {
    hasUrl: Boolean(url),
    videoId,
    hasApiKey: Boolean(API_KEY),
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
    // Run the requested videos endpoint diagnostic on every transcription request.
    // This confirms whether the API key itself can access a normal YouTube Data API endpoint.
    await verifyVideosEndpoint(DIAGNOSTIC_VIDEO_ID);

    // Also run the requested captions-list diagnostic for the known test video.
    try {
      const diagnostic = await fetchYouTubeApi(
        'captions',
        { part: 'snippet', videoId: DIAGNOSTIC_VIDEO_ID, key: API_KEY },
        `captions exact diagnostic (${DIAGNOSTIC_VIDEO_ID})`
      );
      console.log('[YouTube API] exact captions diagnostic complete', {
        status: diagnostic.response.status,
        ok: diagnostic.response.ok,
        rawResponse: diagnostic.body,
      });
    } catch (error) {
      console.error('[YouTube API] exact captions diagnostic failed', {
        message: error instanceof Error ? error.message : String(error || ''),
      });
    }

    const result = await fetchYouTubeTranscript(videoId);

    if (!result.text) {
      console.log(`[transcribe-video:${requestId}] No captions found`, { videoId });
      return res.status(422).json({
        error: NO_CAPTIONS_MESSAGE,
        requestId,
        code: 'NO_CAPTIONS',
      });
    }

    console.log(`[transcribe-video:${requestId}] YouTube Data API transcript success`, {
      videoId,
      trackId: result.trackId,
      textLength: result.text.length,
    });

    return res.status(200).json({
      text: result.text,
      title: 'YouTube lecture transcript',
      requestId,
    });
  } catch (error) {
    console.error(`[transcribe-video:${requestId}] YouTube Data API transcription failed`, {
      videoId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error || ''),
      stack: error instanceof Error ? error.stack : undefined,
    });

    const rawApiResponse = error instanceof Error ? error.message : String(error || '');

    return res.status(422).json({
      error: `${NO_CAPTIONS_MESSAGE}\n\nYouTube API diagnostic: ${rawApiResponse}`,
      requestId,
      code: 'CAPTIONS_UNAVAILABLE',
    });
  }
}
