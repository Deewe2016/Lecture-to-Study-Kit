const SUPABASE_HOST_SUFFIX = '.supabase.co';
const SUPABASE_BUCKET_PATH = '/storage/v1/object/public/video-uploads/';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

function isAllowedSupabaseVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith(SUPABASE_HOST_SUFFIX) && url.pathname.includes(SUPABASE_BUCKET_PATH);
  } catch {
    return false;
  }
}

async function groqError(response) {
  const text = await response.text().catch(() => '');
  let message = text.slice(0, 500);
  try { message = JSON.parse(text)?.error?.message || message; } catch {}
  return message || `Groq returned HTTP ${response.status}.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY is not configured in Vercel environment variables.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'lecture.mp4';
    if (!url) return res.status(400).json({ error: 'No uploaded video URL was provided.' });
    if (!isAllowedSupabaseVideoUrl(url)) return res.status(400).json({ error: 'The uploaded video URL is not a valid public video-uploads Supabase URL.' });

    const urlForm = new FormData();
    urlForm.append('url', url);
    urlForm.append('model', 'whisper-large-v3-turbo');
    urlForm.append('response_format', 'json');
    let groqResponse = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: urlForm });

    if (!groqResponse.ok) {
      const firstError = await groqError(groqResponse);
      console.warn('Groq URL transcription failed; trying server-side file fallback:', firstError);
      const fileResponse = await fetch(url);
      if (!fileResponse.ok) return res.status(502).json({ error: `Supabase video could not be fetched for transcription (HTTP ${fileResponse.status}). Groq URL attempt: ${firstError}` });
      const rawForm = new FormData();
      rawForm.append('file', await fileResponse.blob(), fileName);
      rawForm.append('model', 'whisper-large-v3-turbo');
      rawForm.append('response_format', 'json');
      groqResponse = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: rawForm });
    }

    if (!groqResponse.ok) return res.status(502).json({ error: `Groq transcription failed: ${await groqError(groqResponse)}` });
    const data = await groqResponse.json();
    if (!data?.text?.trim()) return res.status(422).json({ error: 'No speech was detected in this upload.' });
    return res.status(200).json({ text: data.text.trim(), title: fileName });
  } catch (error) {
    console.error('Video transcription failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not transcribe this upload.' });
  }
}
