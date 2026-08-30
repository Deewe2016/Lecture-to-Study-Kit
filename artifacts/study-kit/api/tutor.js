function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 12000);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(503).json({ error: "The AI tutor is not configured on this deployment yet." });
  }

  const body = req.body || {};
  const prompt = clean(body.prompt);
  const context = clean(body.context);
  if (!prompt) return res.status(400).json({ error: "Ask a question first." });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        stream: true,
        messages: [
          {
            role: "system",
            content: "You are the tutor inside a study-kit app. Answer the student's question using the supplied study-kit context. Explain clearly and simply, but do not oversimplify scientific or academic concepts. Stay grounded in the material; if the answer is not in the material, say so and distinguish that from outside knowledge. Do not talk about being an AI. Keep answers focused and reasonably short.",
          },
          {
            role: "user",
            content: `STUDY KIT CONTEXT:\n${context}\n\nSTUDENT QUESTION:\n${prompt}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      return res.status(502).json({ error: `Tutor service returned HTTP ${response.status}${details ? `: ${details.slice(0, 250)}` : ""}` });
    }

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
      const events = buffer.split("\n");
      buffer = events.pop() || "";
      for (const line of events) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch {
          // Ignore incomplete/non-JSON SSE lines.
        }
      }
    }
    res.end();
  } catch (error) {
    console.error("Tutor request failed", error);
    if (!res.headersSent) return res.status(500).json({ error: "The tutor could not answer right now." });
    res.end();
  }
}
