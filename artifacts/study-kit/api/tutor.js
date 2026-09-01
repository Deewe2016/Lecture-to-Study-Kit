function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 30000);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "GROQ_API_KEY is not configured in Vercel." });

  const prompt = clean(req.body?.prompt);
  const context = clean(req.body?.context);
  if (!prompt) return res.status(400).json({ error: "Ask a question first." });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GROQ_TUTOR_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0.2,
        stream: true,
        messages: [
          { role: "system", content: "You are a concise study tutor. Answer using ONLY the supplied study-kit context. Explain clearly in your own words. Define unfamiliar academic terms when useful. Do not invent information. If the context is insufficient, say so. Keep the answer focused and useful for studying." },
          { role: "user", content: `STUDY KIT CONTEXT:\n${context}\n\nSTUDENT QUESTION:\n${prompt}` }
        ]
      })
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("Groq tutor HTTP error:", response.status, details);
      return res.status(502).json({ error: `Groq HTTP ${response.status}: ${details.slice(0, 500)}` });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const reader = response.body?.getReader();
    if (!reader) return res.end();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch (parseError) {
          console.error("Tutor stream parse error:", parseError);
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
