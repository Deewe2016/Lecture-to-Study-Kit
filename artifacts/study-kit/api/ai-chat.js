const MODEL = "openai/gpt-oss-20b";

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
    const modelsResponse = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    const modelsBody = await modelsResponse.text().catch(() => "");
    console.log("Groq models API response:", {
      status: modelsResponse.status,
      ok: modelsResponse.ok,
      body: modelsBody,
    });

    if (!modelsResponse.ok) {
      return res.status(502).json({
        error: `Groq models API HTTP ${modelsResponse.status}: ${modelsBody}`,
      });
    }

    let modelsData;
    try {
      modelsData = JSON.parse(modelsBody);
    } catch (parseError) {
      console.error("Groq models API returned invalid JSON:", parseError);
      return res.status(502).json({ error: `Invalid Groq models response: ${modelsBody}` });
    }

    const availableModelIds = Array.isArray(modelsData?.data)
      ? modelsData.data.map((model) => model?.id).filter(Boolean)
      : [];
    console.log("Groq available model IDs:", availableModelIds);

    if (!availableModelIds.includes(MODEL)) {
      return res.status(502).json({
        error: `Configured chat model ${MODEL} was not returned by Groq /models. Full response: ${modelsBody}`,
      });
    }

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
      console.error("Groq AI Chat HTTP error — full response:", {
        status: response.status,
        statusText: response.statusText,
        body: details,
      });
      return res.status(502).json({ error: `Groq HTTP ${response.status}: ${details}` });
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
