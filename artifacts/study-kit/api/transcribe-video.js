function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] || null;
    }
  } catch {}
  return null;
}

async function getYouTubeAudioUrl(videoId) {
  const pageResponse = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    },
  });
  if (!pageResponse.ok) throw new Error(`YouTube returned HTTP ${pageResponse.status}.`);
  const html = await pageResponse.text();

  const keyMatch = html.match(/(?:INNERTUBE_API_KEY|\"INNERTUBE_API_KEY\")\s*[:=]\s*[\"']([^\"']+)[\"']/);
  const apiKey = keyMatch?.[1];
  if (!apiKey) throw new Error('Could not initialize the YouTube player API.');

  const clients = [
    { name: 'WEB', version: '2.20260909.01.00' },
    { name: 'WEB_EMBEDDED_PLAYER', version: '1.20260909.01.00' },
    { name: 'VISIONOS', version: '1.0' },
  ];

  for (const client of clients) {
    try {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        },
        body: JSON.stringify({
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          context: {
            client: {
              clientName: client.name,
              clientVersion: client.version,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const formats = [
        ...(data.streamingData?.adaptiveFormats || []),
        ...(data.streamingData?.formats || []),
      ];
      const audio = formats
        .filter((format) => typeof format.url === 'string' && /^audio\//.test(format.mimeType || ''))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (audio?.url) return audio.url;
    } catch {
      // Try the next YouTube player client.
    }
  }

  throw new Error('YouTube did not provide a directly fetchable audio stream for this video.');
}

async function transcribeWithGroq(audioUrl) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured in Vercel.');

  const form = new FormData();
  form.append('url', audioUrl);
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
    const audioUrl = await getYouTubeAudioUrl(videoId);
    const text = await transcribeWithGroq(audioUrl);
    return res.status(200).json({ text, title: 'YouTube lecture transcript' });
  } catch (error) {
    console.error('YouTube transcription failed:', error);
    return res.status(502).json({
      error: error instanceof Error ? error.message : 'Could not transcribe this YouTube video.',
    });
  }
}
