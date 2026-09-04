const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;

export const config = {
  api: {
    bodyParser: false,
  },
};

function getContentType(req) {
  const value = req.headers["content-type"];
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "application/octet-stream";
}

function getFileName(req, contentType) {
  const header = req.headers["x-file-name"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const extension = contentType.startsWith("video/") ? ".mp4" : contentType === "audio/mpeg" ? ".mp3" : contentType === "audio/mp4" ? ".m4a" : ".audio";
  return `lecture${extension}`;
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error("This upload is too large for the current Vercel upload route. Please use a video under 4.5 MB."), { statusCode: 413 });
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY is not configured in Vercel environment variables." });

  const contentType = getContentType(req);
  const supported = new Set([
    "video/mp4",
    "video/webm",
    "video/mpeg",
    "video/ogg",
    "audio/flac",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "audio/x-wav",
  ]);
  if (!supported.has(contentType)) {
    return res.status(415).json({ error: `Unsupported upload type: ${contentType}. Groq supports MP4, WebM, MPEG, FLAC, MP3, M4A, OGG, and WAV.` });
  }

  try {
    const buffer = await readRequestBody(req);
    if (buffer.length === 0) return res.status(400).json({ error: "The uploaded file is empty." });

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: contentType }), getFileName(req, contentType));
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "json");

    const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!groqResponse.ok) {
      const body = await groqResponse.text().catch(() => "");
      let message = body.slice(0, 500);
      try {
        const parsed = JSON.parse(body);
        message = parsed?.error?.message || message;
      } catch {}
      return res.status(groqResponse.status).json({ error: `Groq transcription failed: ${message}` });
    }

    const data = await groqResponse.json();
    if (!data?.text?.trim()) return res.status(422).json({ error: "No speech was detected in this upload." });

    return res.status(200).json({
      text: data.text.trim(),
      title: getFileName(req, contentType),
    });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    console.error("Video transcription failed:", error);
    return res.status(status).json({ error: error instanceof Error ? error.message : "Could not transcribe this upload." });
  }
}
