const SYSTEM_PROMPT = `You are a calendar assistant. The user will describe events in plain English. Extract all events and return ONLY a JSON array like this:
[{
  "title": "Math Class",
  "startTime": "15:00",
  "endTime": "16:00",
  "recurrence": "weekly",
  "daysOfWeek": ["monday", "wednesday"],
  "color": "blue",
  "startDate": "today"
}]
No other text, just the JSON array.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!description) {
    return res.status(400).json({ error: "Describe the events you want to create." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("Calendar AI: GROQ_API_KEY is not configured.");
    return res.status(500).json({ error: "AI event creation is not configured. Please try again later." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        temperature: 0.1,
        max_tokens: 3000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: description },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Calendar AI Groq error:", response.status, detail.slice(0, 1000));
      return res.status(502).json({ error: "Could not generate events. Please try again." });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      console.error("Calendar AI: Groq returned no message content.");
      return res.status(502).json({ error: "The AI returned an empty response. Please try again." });
    }

    return res.status(200).json({ content });
  } catch (error) {
    console.error("Calendar AI request failed:", error);
    return res.status(502).json({ error: "Could not generate events. Please try again." });
  }
}
