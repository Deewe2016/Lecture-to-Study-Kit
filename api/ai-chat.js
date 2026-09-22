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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GROQ_API_KEY is not configured in Vercel." });
  }

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [];

  if (!messages.length) {
    return res.status(400).json({ error: "Send a message first." });
  }

  try {
    const context = attachmentContext(attachments);
    const system = [
      "You are a helpful study tutor and general-purpose AI assistant.",
      "Answer the user's question directly.",
      "Use attached file content as context when it is relevant.",
      "If an attached file does not contain the answer, use your general knowledge rather than refusing.",
      "If you use information that comes from general knowledge rather than the attached files, briefly make that clear.",
      context
        ? "The user has attached the following file content. Use it as context when answering. Each attachment is limited to 3000 characters.\n" + context
        : "",
    ].filter(Boolean).join("\n\n");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0.2,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });

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

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI Chat unavailable.";
    console.error("AI Chat request failed:", error);

    if (!res.headersSent) {
      return res.status(502).json({ error: message });
    }

    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}
