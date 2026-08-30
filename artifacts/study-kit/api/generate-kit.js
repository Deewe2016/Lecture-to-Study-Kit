function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 50000);
}

function fallbackKit(title, source, days) {
  const sentences = source.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
  const points = sentences.slice(0, 6);
  const chapter = {
    id: "source",
    title: title || "Study Material",
    summary: points[0] || "Review the material you provided.",
    keyPoints: [points[0], points[1], points[2]].filter(Boolean),
    objective: "Explain the main ideas in the supplied material."
  };
  while (chapter.keyPoints.length < 3) chapter.keyPoints.push("Review this material and explain it in your own words.");

  return {
    title: title || "Study Kit",
    courseLabel: "Personal study space",
    overview: sentences.slice(0, 2).join(" ") || "A study kit based on your supplied material.",
    chapters: [chapter],
    reviewPlan: Array.from({ length: Math.max(1, Math.min(30, days)) }, (_, i) => ({
      day: i + 1,
      label: i === 0 ? "Start here" : i === days - 1 ? "Ready check" : `Review ${i + 1}`,
      focus: chapter.title,
      tasks: ["Review the key points", i === days - 1 ? "Take the practice exam" : "Review the flashcards"],
      minutes: i === days - 1 ? 35 : 25
    })),
    questions: [{
      id: "q1",
      chapterId: "source",
      prompt: `Which statement is supported by the material about ${chapter.title.toLowerCase()}?`,
      options: [chapter.keyPoints[0], chapter.keyPoints[1], "The material does not discuss this topic.", "None of the above."],
      answer: 0,
      explanation: chapter.keyPoints[0],
      difficulty: "Core"
    }],
    flashcards: [
      { id: "f1", chapterId: "source", front: `What does ${chapter.title} cover?`, back: chapter.summary, hint: "Recall the chapter summary." },
      { id: "f2", chapterId: "source", front: `${chapter.title}: key fact`, back: chapter.keyPoints[1], hint: "Recall a key point." }
    ]
  };
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "courseLabel", "overview", "chapters", "reviewPlan", "questions", "flashcards"],
  properties: {
    title: { type: "string" },
    courseLabel: { type: "string" },
    overview: { type: "string" },
    chapters: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "title", "summary", "keyPoints", "objective"], properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, keyPoints: { type: "array", items: { type: "string" } }, objective: { type: "string" } } } },
    reviewPlan: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "label", "focus", "tasks", "minutes"], properties: { day: { type: "number" }, label: { type: "string" }, focus: { type: "string" }, tasks: { type: "array", items: { type: "string" } }, minutes: { type: "number" } } } },
    questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "prompt", "options", "answer", "explanation", "difficulty"], properties: { id: { type: "string" }, chapterId: { type: "string" }, prompt: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer: { type: "number" }, explanation: { type: "string" }, difficulty: { type: "string" } } } },
    flashcards: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "front", "back", "hint"], properties: { id: { type: "string" }, chapterId: { type: "string" }, front: { type: "string" }, back: { type: "string" }, hint: { type: ["string", "null"] } } } }
  }
};

async function generateWithOpenAI(title, source, syllabus, days) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: "study_kit", strict: true, schema } },
      messages: [
        { role: "system", content: "Create a complete study kit using only information supported by the supplied lecture material. Do not invent facts. Include useful chapters, a multi-day review plan, practice questions, and flashcards." },
        { role: "user", content: `Title: ${title}\nPlan length: ${days} days\nSyllabus: ${syllabus || "Not provided"}\n\nLecture material:\n${source}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return JSON.parse(content);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const body = req.body || {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const source = cleanText(materials.map((m) => m && m.text ? m.text : "").join("\n\n"));
  const days = Math.max(1, Math.min(30, Number(body.planDays) || 7));
  if (!title || !source) return res.status(400).json({ error: "Add a title and at least one valid material." });

  try {
    let kit = null;
    try {
      kit = await generateWithOpenAI(title, source, typeof body.syllabus === "string" ? body.syllabus : "", days);
    } catch (error) {
      console.warn("AI generation failed; using fallback generator.", error);
    }
    return res.status(200).json(kit || fallbackKit(title, source, days));
  } catch (error) {
    console.error("Study kit generation failed", error);
    return res.status(500).json({ error: "Could not generate a study kit." });
  }
}
