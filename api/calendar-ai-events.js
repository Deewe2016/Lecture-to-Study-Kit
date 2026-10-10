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
No other text, just the JSON array. Interpret 'today' as the current local date. For recurring weekly events, include the requested weekdays. If the description gives a duration such as 'for 2 hours' or 'for 30 minutes', calculate endTime from startTime. If the description says 'for the next N weeks', include an endDate covering that recurrence period.`;

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
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: description },
    ];
    console.log("[Calendar AI] Exact Groq prompt:", JSON.stringify(messages, null, 2));

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
        messages,
      }),
    });

    const rawResponse = await response.text().catch((error) => {
      console.error("[Calendar AI] Failed to read Groq response body:", error);
      return "";
    });
    console.log("[Calendar AI] Groq HTTP status:", response.status, response.ok);
    console.log("[Calendar AI] Raw Groq API response:", rawResponse);

    if (!response.ok) {
      console.error("[Calendar AI] Groq API returned an error status:", response.status, rawResponse);
      return res.status(502).json({ error: "Could not generate events. Please try again." });
    }

    let data;
    try {
      data = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error("[Calendar AI] Groq API response JSON parse error:", parseError);
      return res.status(502).json({ error: "Could not generate events. Please try again." });
    }

    const content = data?.choices?.[0]?.message?.content;
    console.log("[Calendar AI] Extracted model content:", content);
    if (typeof content !== "string" || !content.trim()) {
      console.error("[Calendar AI] Groq returned no message content:", data);
      return res.status(502).json({ error: "Could not generate events. Please try again." });
    }

    let cleaned = content
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);

    let events;
    try {
      events = JSON.parse(cleaned);
      if (!Array.isArray(events)) throw new Error("AI response was not a JSON array.");
    } catch (parseError) {
      console.error("[Calendar AI] Event array JSON parse error:", parseError, {
        rawContent: content,
        cleanedContent: cleaned,
      });
      return res.status(502).json({ error: "Could not generate events. Please try again." });
    }

    console.log("[Calendar AI] Final parsed events array:", events);
    return res.status(200).json({ content: JSON.stringify(events) });
  } catch (error) {
    console.error("[Calendar AI] Request failed:", error);
    return res.status(502).json({ error: "Could not generate events. Please try again." });
  }
}
