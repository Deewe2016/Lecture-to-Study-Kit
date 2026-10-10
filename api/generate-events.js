export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const prompt = typeof req.body?.prompt === "string"
    ? req.body.prompt.trim()
    : typeof req.body?.description === "string"
      ? req.body.description.trim()
      : "";

  if (!prompt) {
    return res.status(400).json({ error: "Describe the events you want to create." });
  }

  const today = new Date().toISOString().slice(0, 10);
  const requestedWeeks = Number.parseInt(String(req.body?.weeks ?? "12"), 10);
  const weeks = [4, 8, 12, 24].includes(requestedWeeks) ? requestedWeeks : 12;
  const systemPrompt = `Return ONLY a JSON array in this format:
[{"title":"Art Class","date":"YYYY-MM-DD","startTime":"18:30","endTime":"20:30","color":"blue"}]
Today's date is: ${today}.
For recurring events, generate every occurrence within the next ${weeks} weeks, starting with the next matching date after today (unless the user specifies a date). For "every tuesday", include every Tuesday in that period. For "every day", include each day in that period. For "every monday and wednesday", include both Mondays and Wednesdays in that period. Return each occurrence as its own array item with its actual ISO date. For one-time events, return only the requested event(s). Use ISO dates (YYYY-MM-DD) and 24-hour times (HH:mm). Do not include markdown, recurrence fields, or any text outside the JSON array.`;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is not configured.");
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
        max_tokens: 6000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
    });

    const rawResponse = await response.text();
    let data;
    try {
      data = JSON.parse(rawResponse);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("Failed to parse Groq API response JSON:", message, rawResponse);
      return res.status(502).json({ error: `Failed to parse Groq API response JSON: ${message}` });
    }

    console.log('Groq raw response:', JSON.stringify(data));

    if (!response.ok) {
      const message = data?.error?.message || `Groq API returned HTTP ${response.status}`;
      console.error("Groq API request failed:", message);
      return res.status(502).json({ error: message });
    }

    const modelContent = data?.choices?.[0]?.message?.content;
    if (typeof modelContent !== "string" || !modelContent.trim()) {
      const message = "Groq returned an empty response.";
      console.error(message, JSON.stringify(data));
      return res.status(502).json({ error: message });
    }

    const cleaned = modelContent
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();

    let parsedEvents;
    try {
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      if (start === -1 || end < start) {
        throw new Error("Groq response did not contain a JSON array.");
      }
      parsedEvents = JSON.parse(cleaned.slice(start, end + 1));
      if (!Array.isArray(parsedEvents)) {
        throw new Error("Groq response JSON was not an array.");
      }
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("Failed to parse Groq event JSON:", message, {
        rawContent: modelContent,
        cleanedContent: cleaned,
      });
      return res.status(502).json({ error: `Failed to parse Groq event JSON: ${message}` });
    }

    // The calendar UI expects startDate; accept the simpler prompt's date field.
    const events = parsedEvents.map((event) => ({
      ...event,
      startDate: event?.startDate || event?.date || "today",
    }));

    console.log("Parsed events:", JSON.stringify(events));
    return res.status(200).json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Generate events request failed:", message, error);
    return res.status(502).json({ error: message });
  }
}
