function clean(value) {
  return String(value || "").trim();
}

const MAX_ATTACHMENT_CHARS = 3000;

function attachmentContext(attachments) {
  return attachments
    .filter((item) => item && typeof item.name === "string")
    .map((item) => {
      const kind = item.kind === "image" ? "Image note" : "File content";
      const content = item.kind === "image"
        ? `The user attached an image called ${item.name}. Describe what this image might contain based on the filename.`
        : clean(item.content).slice(0, MAX_ATTACHMENT_CHARS);
      return `\n--- ${item.name} (${kind}) ---\n${content}\n--- End ${item.name} ---`;
    })
    .join("\n");
}

export default async function handler(req, res) {
  console.log("AI chat called with " + (Array.isArray(req.body?.messages) ? req.body.messages.length : 0) + " messages");
  console.log("AI chat request body:", req.body);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GROQ_API_KEY is not configured in Vercel." });
  }

  const body = req.body || {};
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const messages = rawMessages
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : String(message.content || ""),
    }));
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [];

  console.log("AI chat normalized request:", {
    messageCount: messages.length,
    attachmentCount: attachments.length,
    hasUserMessage: messages.some((message) => message.role === "user"),
  });

  if (!messages.length) {
    return res.status(400).json({ error: "Send a message first." });
  }

  try {
    let context = "";
    try {
      context = attachmentContext(attachments);
    } catch (attachmentError) {
      console.error("AI Chat attachment context error:", attachmentError);
      context = "";
    }

    const system = [
      "You are a helpful math and science tutor. When a user shares problems or questions, you ALWAYS help them work through the solutions step by step. You explain your reasoning clearly. You never refuse to help with math, science, or academic problems. When given a file with questions, answer every single question with full working shown. You are a study assistant — helping students learn by working through problems is your entire purpose.",
    ].filter(Boolean).join("\n\n");

    const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    console.log("AI Chat calling Groq with model:", model);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });

    console.log("Groq API response status:", response.status);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const errorMessage = `Groq HTTP ${response.status}: ${bodyText.slice(0, 500) || "No error details returned."}`;
      console.error("Groq API error:", errorMessage);
      return res.status(502).json({ error: errorMessage });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = response.body?.getReader();
    if (!reader) {
      const errorMessage = "Groq returned no readable response stream.";
      console.error(errorMessage);
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      return res.end();
    }

    const decoder = new TextDecoder();
    let buffer = "";

    const sendError = (message) => {
      console.error("AI Chat stream error:", message);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    };

    let sentContent = false;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const eventText of events) {
        for (const line of eventText.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            res.write("data: [DONE]\n\n");
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
              sendError(`Groq stream error: ${parsed.error?.message || JSON.stringify(parsed.error)}`);
              continue;
            }

            const content = parsed?.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content) {
              sentContent = true;
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (parseError) {
            console.error("Could not parse Groq SSE event:", parseError);
          }
        }
      }

      if (done) break;
    }

    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch (parseError) {
          console.error("Could not parse final Groq SSE event:", parseError);
        }
      }
    }

    if (!sentContent) {
      const errorMessage = "Groq returned an empty response.";
      console.error(errorMessage);
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("AI Chat request catch error:", error);
    const message = error instanceof Error ? error.message : "AI Chat unavailable.";
    console.error("AI Chat request failed:", error);

    if (!res.headersSent) {
      return res.status(502).json({ error: message });
    }

    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}
