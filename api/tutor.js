function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY is not configured in Vercel." });

  const prompt = clean(req.body?.prompt);
  let context = clean(req.body?.context);
  if (!prompt) return res.status(400).json({ error: "Ask a question first." });

  // Keep the tutor focused on the generated kit rather than allowing an enormous request.
  context = context.slice(0, 30000);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.2,
        stream: true,
        messages: [
          {
            role: "system",
            content: "You are a concise study tutor. Answer the student's question using ONLY the supplied study-kit context. Explain ideas clearly in your own words. Do not invent information. If the context does not contain enough information, say so. Keep the answer focused and suitable for studying.",
          },
          {
            role: "user",
            content: `STUDY KIT CONTEXT:\n${context}\n\nSTUDENT QUESTION:\n${prompt}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return res.status(502).json({ error: `Groq HTTP ${response.status}: ${body.slice(0, 300)}` });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const reader = response.body?.getReader();
    if (!reader) return res.end();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch {
          // Ignore incomplete SSE frames; Groq sends the next frame with the remainder.
        }
      }
    }
    res.end();
  } catch (error) {
    console.error("Tutor request failed:", error);
    if (!res.headersSent) return res.status(502).json({ error: error instanceof Error ? error.message : "Tutor unavailable." });
    res.end();
  }
}
