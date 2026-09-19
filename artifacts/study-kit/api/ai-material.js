export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
  if (!topic) return res.status(400).json({ error: "Describe what you want to study." });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GROQ_API_KEY is not configured in Vercel." });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are an expert study material creator. The user will describe a topic they want to study. Generate comprehensive study material as a long detailed text covering: key concepts, important facts, definitions, examples, and common exam questions about this topic. Write it as detailed notes a teacher would give a student. Minimum 500 words.",
        },
        { role: "user", content: topic },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    return res.status(response.status).json({ error: `Groq HTTP ${response.status}: ${details.slice(0, 400)}` });
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) return res.status(502).json({ error: "Groq returned no study material." });

  return res.status(200).json({
    name: `${topic} - AI Generated`,
    kind: "notes",
    text,
  });
}
