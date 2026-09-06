const SUPABASE_HOST_SUFFIX = '.supabase.co';
const SUPABASE_BUCKET_PATH = '/storage/v1/object/public/video-uploads/';

function isAllowedSupabaseVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname.endsWith(SUPABASE_HOST_SUFFIX) &&
      url.pathname.includes(SUPABASE_BUCKET_PATH);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured in Vercel environment variables.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'lecture.mp4';

    if (!url) return res.status(400).json({ error: 'No uploaded video URL was provided.' });
    if (!isAllowedSupabaseVideoUrl(url)) {
      return res.status(400).json({ error: 'The uploaded video URL is not a valid public video-uploads Supabase URL.' });
    }

    const form = new FormData();
    form.append('url', url);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const responseText = await groqResponse.text();
    if (!groqResponse.ok) {
      let message = responseText.slice(0, 500);
      try {
        const parsed = JSON.parse(responseText);
        message = parsed?.error?.message || message;
      } catch {}
      console.error('Groq transcription failed:', groqResponse.status, message);
      return res.status(groqResponse.status).json({ error: `Groq transcription failed: ${message}` });
    }

    const data = JSON.parse(responseText);
    if (!data?.text?.trim()) {
      return res.status(422).json({ error: 'No speech was detected in this upload.' });
    }

    return res.status(200).json({ text: data.text.trim(), title: fileName });
  } catch (error) {
    console.error('Video transcription failed:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not transcribe this upload.',
    });
  }
}
