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

  // YouTube caption downloads are commonly returned as WebVTT or SRT.
  if (/^WEBVTT(?:\s|$)/i.test(raw)) {
    return normalizeText(
      raw
        .replace(/^WEBVTT[^\n]*\n?/i, '')
        .replace(/\n?\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}[^\n]*\n?/g, '\n')
        .replace(/\n?\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}[^\n]*\n?/g, '\n')
    );
  }

  // SRT: remove cue numbers and timestamp lines, leaving caption text.
  const withoutSrtMetadata = raw
    .split('\n')
    .filter((line) => !/^\s*\d+\s*$/.test(line))
    .filter((line) => !/^\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(line));

  return normalizeText(withoutSrtMetadata.join('\n'));
}

async function listCaptionTracks(videoId) {
  if (!API_KEY) {
    throw new Error('YOUTUBE_API_KEY is missing from the Vercel environment variables');
  }

  const params = new URLSearchParams({
    part: 'snippet',
    videoId,
    key: API_KEY,
  });

  const response = await fetch(`https://www.googleapis.com/youtube/v3/captions?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || `YouTube Data API returned HTTP ${response.status}`;
    throw new Error(apiMessage);
  }

  return Array.isArray(data?.items) ? data.items : [];
}

async function downloadCaptionTrack(trackId) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY is missing from the Vercel environment variables');

  const params = new URLSearchParams({
    id: trackId,
    key: API_KEY,
    tfmt: 'vtt',
  });

  const response = await fetch(`https://www.googleapis.com/youtube/v3/captions/download?${params.toString()}`, {
    headers: { Accept: 'text/vtt, text/plain, */*' },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Caption download failed with HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  return parseCaptionTrack(body);
}

function chooseCaptionTracks(items) {
  return [...items].sort((a, b) => {
    const aSnippet = a?.snippet || {};
    const bSnippet = b?.snippet || {};

    // Prefer English, then auto-generated English, then any available language.
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

  console.log(`[transcribe-video:${requestId}] YouTube Data API request`, {
    hasUrl: Boolean(url),
    videoId,
    hasApiKey: Boolean(API_KEY),
  });

  if (!videoId) {
    return res.status(400).json({ error: 'Add a valid YouTube video URL.', requestId });
  }

  try {
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

    return res.status(422).json({
      error: NO_CAPTIONS_MESSAGE,
      requestId,
      code: 'CAPTIONS_UNAVAILABLE',
    });
  }
}
