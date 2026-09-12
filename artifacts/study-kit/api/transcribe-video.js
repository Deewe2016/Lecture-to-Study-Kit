export const config = { maxDuration: 60 };

const NO_CAPTIONS_MESSAGE = 'This video has no captions. Please upload the video file directly.';
const API_KEY = process.env.YOUTUBE_API_KEY;

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;

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

function buildYouTubeApiUrl(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function fetchYouTubeApi(endpoint, params, label) {
  const url = buildYouTubeApiUrl(endpoint, params);
  console.log(`[YouTube API] ${label} request`, {
    url: (() => { const safe = new URL(url); safe.searchParams.set('key', '[REDACTED]'); return safe.toString(); })(),
    hasApiKey: Boolean(API_KEY),
    apiKeyLength: API_KEY ? API_KEY.length : 0,
  });

  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const body = await response.text();
  console.log(`[YouTube API] ${label} raw response`, { status: response.status, ok: response.ok, body });

  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = null; }
  return { response, body, data };
}

async function listCaptionTracks(videoId) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY is missing from the Vercel environment variables');

  const result = await fetchYouTubeApi('captions', { part: 'snippet', videoId, key: API_KEY }, `captions list (${videoId})`);
  if (!result.response.ok) {
    throw new Error(`${result.data?.error?.message || `YouTube Data API returned HTTP ${result.response.status}`}. Raw YouTube captions API response: ${result.body.slice(0, 4000)}`);
  }
  return Array.isArray(result.data?.items) ? result.data.items : [];
}

async function getVideoSnippet(videoId) {
  if (!API_KEY) return null;
  const result = await fetchYouTubeApi('videos', { part: 'snippet', id: videoId, key: API_KEY }, `videos metadata (${videoId})`);
  if (!result.response.ok) return null;
  const item = result.data?.items?.[0];
  if (!item) return null;
  return item.snippet || null;
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

function parseJson3(body) {
  try {
    const data = JSON.parse(body);
    const parts = [];
    for (const event of data?.events || []) {
      for (const segment of event?.segs || []) {
        if (segment?.utf8) parts.push(segment.utf8);
      }
    }
    return normalizeText(parts.join(' '));
  } catch {
    return '';
  }
}

function parseCaptionResponse(body, contentType = '') {
  const raw = String(body || '').trim();
  if (!raw) return '';

  // json3 is sometimes returned with a non-JSON content type, so inspect the body too.
  if (contentType.includes('json') || raw.startsWith('{')) return parseJson3(raw);

  // srv3/timedtext is XML. Extract text nodes while decoding common XML entities.
  const matches = [...raw.matchAll(/<text(?:\s[^>]*)?>([\s\S]*?)<\/text>/gi)];
  if (matches.length) return normalizeText(matches.map((match) => match[1]).join(' '));

  // Some responses can still contain JSON despite an XML-ish content type.
  return parseJson3(raw);
}

const TIMEDTEXT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': 'https://www.youtube.com/',
};

async function fetchTimedtextAttempt(videoId, track, format, language, attemptNumber) {
  const url = new URL('https://www.youtube.com/api/timedtext');
  url.searchParams.set('v', videoId);
  url.searchParams.set('fmt', format);

  // Use the actual track metadata when available. lang selects the source track;
  // tlang requests translation, and name identifies the caption track by name.
  if (language) url.searchParams.set('lang', language);
  if (track?.snippet?.language) url.searchParams.set('tlang', track.snippet.language);
  if (track?.snippet?.name?.simpleText) url.searchParams.set('name', track.snippet.name.simpleText);
  else if (typeof track?.snippet?.name === 'string') url.searchParams.set('name', track.snippet.name);
  if (track?.snippet?.trackKind?.toLowerCase() === 'asr') url.searchParams.set('kind', 'asr');

  // The timedtext endpoint does not document a stable public parameter for the
  // Data API caption ID. We therefore also try the supplied ID as a diagnostic
  // parameter without replacing the required v/video ID parameter.
  if (track?.id) url.searchParams.set('trackId', track.id);

  console.log(`[Timedtext] attempt ${attemptNumber} request`, {
    url: url.toString(),
    videoId,
    trackId: track?.id || null,
    language: language || null,
    trackLanguage: track?.snippet?.language || null,
    trackName: track?.snippet?.name?.simpleText || track?.snippet?.name || null,
    trackKind: track?.snippet?.trackKind || null,
    format,
    headers: TIMEDTEXT_HEADERS,
  });

  const response = await fetch(url.toString(), { headers: TIMEDTEXT_HEADERS });
  const body = await response.text();

  console.log(`[Timedtext] attempt ${attemptNumber} full response`, {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    contentLength: body.length,
    body,
  });

  if (!response.ok || !body.trim()) return '';
  return parseCaptionResponse(body, response.headers.get('content-type') || '');
}

function chooseCaptionTracks(items, videoSnippet) {
  const defaultLanguage = videoSnippet?.defaultLanguage || videoSnippet?.defaultAudioLanguage || null;
  return [...items].sort((a, b) => {
    const score = (track) => {
      const snippet = track?.snippet || {};
      let value = 0;
      if (snippet.language === 'en') value += 200;
      else if (snippet.language?.startsWith('en')) value += 150;
      if (defaultLanguage && snippet.language === defaultLanguage) value += 100;
      if (snippet.trackKind?.toUpperCase() === 'ASR') value += 20;
      if (snippet.status === 'serving') value += 5;
      return value;
    };
    return score(b) - score(a);
  });
}

async function fetchYouTubeTranscript(videoId) {
  const [tracks, videoSnippet] = await Promise.all([
    listCaptionTracks(videoId),
    getVideoSnippet(videoId),
  ]);

  console.log('[YouTube API] caption/video metadata', {
    videoId,
    defaultLanguage: videoSnippet?.defaultLanguage || null,
    defaultAudioLanguage: videoSnippet?.defaultAudioLanguage || null,
    captionTrackCount: tracks.length,
    tracks: tracks.map((track) => ({
      id: track?.id,
      language: track?.snippet?.language,
      trackKind: track?.snippet?.trackKind,
      status: track?.snippet?.status,
      name: track?.snippet?.name,
    })),
  });

  if (!tracks.length) return { text: '', trackId: null };

  // Prefer the English/asr track the user identified, then the best matching
  // track. Every attempt includes the real Data API track ID when available.
  const preferredTrack = tracks.find((track) => track?.id === 'AUieDaY3gaVNun_-aB7zFQwZZB218MNGu0JUzE2JVE0oYt3fWLo')
    || tracks[0];

  const orderedTracks = [preferredTrack, ...tracks.filter((track) => track !== preferredTrack)];
  const first = orderedTracks[0];
  const trackLanguage = first?.snippet?.language || videoSnippet?.defaultLanguage || 'en';

  const attempts = [
    { format: 'srv3', language: 'en', track: first },
    { format: 'srv3', language: 'en-US', track: first },
    { format: 'json3', language: 'en', track: first },
    { format: 'srv3', language: null, track: first },
    { format: 'json3', language: null, track: first },
    // Additional direct-track attempts: use the actual track language and ASR kind.
    { format: 'json3', language: trackLanguage, track: first },
    { format: 'srv3', language: trackLanguage, track: first },
  ];

  let attemptNumber = 0;
  for (const attempt of attempts) {
    attemptNumber += 1;
    try {
      const text = await fetchTimedtextAttempt(videoId, attempt.track, attempt.format, attempt.language, attemptNumber);
      if (text) return { text, trackId: attempt.track?.id || null };
    } catch (error) {
      console.error(`[Timedtext] attempt ${attemptNumber} failed`, {
        message: error instanceof Error ? error.message : String(error || ''),
      });
    }
  }

  // Try each remaining caption track with its actual language and ID metadata.
  for (const track of orderedTracks.slice(1)) {
    const language = track?.snippet?.language || videoSnippet?.defaultLanguage || 'en';
    for (const format of ['srv3', 'json3']) {
      attemptNumber += 1;
      try {
        const text = await fetchTimedtextAttempt(videoId, track, format, language, attemptNumber);
        if (text) return { text, trackId: track?.id || null };
      } catch (error) {
        console.error(`[Timedtext] track fallback attempt ${attemptNumber} failed`, {
          trackId: track?.id || null,
          message: error instanceof Error ? error.message : String(error || ''),
        });
      }
    }
  }

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

  console.log(`[transcribe-video:${requestId}] configuration`, {
    hasApiKey: Boolean(API_KEY),
    apiKeyLength: API_KEY ? API_KEY.length : 0,
    videoId,
  });

  if (!videoId) return res.status(400).json({ error: 'Add a valid YouTube video URL.', requestId });

  if (!API_KEY) {
    return res.status(500).json({
      error: 'YOUTUBE_API_KEY is not available to this Vercel API route. Check the Vercel environment variable name and redeploy.',
      requestId,
      code: 'MISSING_YOUTUBE_API_KEY',
    });
  }

  try {
    const result = await fetchYouTubeTranscript(videoId);

    if (!result.text) {
      console.log(`[transcribe-video:${requestId}] No captions found after timedtext attempts`, { videoId });
      return res.status(422).json({ error: NO_CAPTIONS_MESSAGE, requestId, code: 'NO_CAPTIONS' });
    }

    console.log(`[transcribe-video:${requestId}] timedtext transcript success`, {
      videoId,
      trackId: result.trackId,
      textLength: result.text.length,
    });

    return res.status(200).json({ text: result.text, title: 'YouTube lecture transcript', requestId });
  } catch (error) {
    console.error(`[transcribe-video:${requestId}] YouTube transcription failed`, {
      videoId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error || ''),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.status(422).json({
      error: `${NO_CAPTIONS_MESSAGE}\n\nYouTube API diagnostic: ${error instanceof Error ? error.message : String(error || '')}`,
      requestId,
      code: 'CAPTIONS_UNAVAILABLE',
    });
  }
}
