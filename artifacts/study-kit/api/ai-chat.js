const MODEL = "llama-3.1-8b-instant";

function cleanMessage(message) {
  if (!message || (message.role !== "user" && message.role !== "assistant")) return null;
  const content = String(message.content || "").trim().slice(0, 12000);
  return content ? { role: message.role, content } : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "GROQ_API_KEY is not configured in Vercel." });

  const messages = Array.isArray(req.body?.messages)
    ? req.body.messages.map(cleanMessage).filter(Boolean).slice(-50)
    : [];

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "Send a message first." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        stream: true,
        messages: [
          {
            role: "system",
            content: "You are the AI assistant inside a student study workspace. Be helpful, clear, accurate, and age-appropriate. Explain things simply when useful. Do not claim to have access to information you were not given. Keep responses reasonably concise unless the user asks for detail.",
          },
          ...messages,
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error("Groq AI Chat HTTP error:", response.status, details);
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
          console.error("AI Chat stream parse error:", parseError);
        }
      }
    }

    res.end();
  } catch (error) {
    console.error("AI Chat request failed:", error);
    if (!res.headersSent) {
      return res.status(502).json({ error: error instanceof Error ? error.message : "AI Chat is unavailable." });
    }
    res.end();
  }
}
