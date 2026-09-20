function clean(value) {
  return String(value || "").trim();
}

function attachmentContext(attachments) {
  return attachments
    .filter((item) => item && typeof item.name === "string")
    .map((item) => {
      const kind = item.kind === "image" ? "Image description" : "File content";
      return `\n--- ${item.name} (${kind}) ---\n${clean(item.content).slice(0, 50000)}\n--- End ${item.name} ---`;
    })
    .join("\n");
}

async function describeImage(apiKey, image) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.1,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this image accurately for a study assistant. Include visible text, diagrams, labels, charts, equations, objects, and important relationships. Do not guess details that are not visible.",
          },
          { type: "image_url", image_url: { url: image.content } },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq image description failed: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "No useful description could be generated for this image.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY is not configured in Vercel." });

  const body = req.body || {};
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!messages.length) return res.status(400).json({ error: "Send a message first." });

  try {
    const processedAttachments = [];
    for (const attachment of attachments.slice(0, 10)) {
      if (attachment?.kind === "image" && typeof attachment.content === "string") {
        const description = await describeImage(apiKey, attachment);
        processedAttachments.push({ ...attachment, content: description });
      } else {
        processedAttachments.push(attachment);
      }
    }

    const context = attachmentContext(processedAttachments).slice(0, 120000);
    const system = [
      "You are a helpful study tutor and general-purpose AI assistant.",
      "Answer the user's question directly.",
      "Use attached file content as context when it is relevant.",
      "If an attached file does not contain the answer, use your general knowledge rather than refusing.",
      "If you use information that comes from general knowledge rather than the attached files, briefly make that clear.",
      context
        ? "The user has attached the following file content: [file content]. Use this as context when answering.\n" + context
        : "",
    ].filter(Boolean).join("\n\n");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        temperature: 0.2,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return res.status(502).json({ error: `Groq HTTP ${response.status}: ${bodyText.slice(0, 300)}` });
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
        } catch {
          // Ignore incomplete SSE frames.
        }
      }
    }
    res.end();
  } catch (error) {
    console.error("AI Chat request failed:", error);
    if (!res.headersSent) return res.status(502).json({ error: error instanceof Error ? error.message : "AI Chat unavailable." });
    res.end();
  }
}
