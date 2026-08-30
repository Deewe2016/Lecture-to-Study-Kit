function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 60000);
}

function sentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
}

function sourceSections(source) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = null;
  const numbered = /^(?:chapter\s+)?\d+[.)]\s+(.+)$/i;
  const heading = /^[A-Z][A-Za-z0-9 &'()/,:—–-]{1,100}$/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const numberedMatch = line.match(numbered);
    const isHeading = heading.test(line) && line.split(/\s+/).length <= 12 && !/[.!?]$/.test(line) && lines[i + 1];
    const title = numberedMatch ? numberedMatch[1].trim() : isHeading ? line : null;
    if (title) {
      if (current && current.text.length > 40) sections.push(current);
      current = { title, text: "" };
    } else if (current) {
      current.text += `${current.text ? " " : ""}${line}`;
    }
  }
  if (current && current.text.length > 40) sections.push(current);
  return sections.slice(0, 8);
}

function cleanGeneratedKit(kit) {
  if (!kit || typeof kit !== "object") return null;
  const chapters = Array.isArray(kit.chapters) ? kit.chapters : [];
  const chapterIds = new Set(chapters.map((c) => c.id));
  const flashcards = (Array.isArray(kit.flashcards) ? kit.flashcards : []).filter((card) => {
    const front = String(card.front || "").trim();
    const back = String(card.back || "").trim();
    const looksLikeLabel = /^(chapter|topic|section|key fact|key points?)\s*[:#-]?/i.test(front) || front.length < 12;
    return chapterIds.has(card.chapterId) && front.endsWith("?") && !looksLikeLabel && back.length > 15 && !/[•\n]/.test(back);
  }).map((card, i) => ({ ...card, id: card.id || `f${i + 1}`, hint: card.hint ? String(card.hint).replace(/\s+/g, " ").trim() : null, back: String(card.back).replace(/\s+/g, " ").trim() }));

  if (chapters.length < 3 || flashcards.length < Math.min(6, chapters.length * 2)) return null;
  return { ...kit, flashcards };
}

function fallbackKit(title, source, days) {
  const sections = sourceSections(source);
  const allFacts = sentences(source);
  const usable = sections.length ? sections : [{ title: title || "Study Material", text: allFacts.slice(0, 15).join(" ") }];
  const chapters = usable.map((section, index) => {
    const facts = sentences(section.text).slice(0, 5);
    const keyPoints = facts.slice(0, 3);
    while (keyPoints.length < 3) keyPoints.push(`The supplied material develops the ideas presented in ${section.title}.`);
    return {
      id: `chapter-${index + 1}`,
      title: section.title,
      summary: facts.slice(0, 2).join(" ") || `This section explains ${section.title}.`,
      keyPoints,
      objective: `Explain the main ideas, evidence, and relationships presented in ${section.title}.`,
    };
  });

  const overviewParts = chapters.slice(0, 4).map((chapter) => `${chapter.title}: ${chapter.summary}`).join(" ");
  const overview = overviewParts || `This document presents the main ideas and relationships in ${title || "the supplied material"}.`;
  const reviewDays = Math.max(1, Math.min(30, Number(days) || 7));
  const reviewPlan = Array.from({ length: reviewDays }, (_, i) => ({
    day: i + 1,
    label: i === 0 ? "Start here" : i === reviewDays - 1 ? "Ready check" : `Review ${i + 1}`,
    focus: chapters[i % chapters.length].title,
    tasks: i === 0 ? ["Read the overview and chapter summaries", "Recall the main ideas without looking"] : ["Review the chapter key points", i === reviewDays - 1 ? "Take the practice exam" : "Review the flashcards"],
    minutes: i === reviewDays - 1 ? 35 : 25,
  }));
  const questions = chapters.map((chapter, i) => ({
    id: `q${i + 1}`,
    chapterId: chapter.id,
    prompt: `Which statement accurately describes ${chapter.title}?`,
    options: [chapter.keyPoints[0], chapter.keyPoints[1], "The material does not address this topic.", "The material says this topic is unrelated to the others."],
    answer: 0,
    explanation: chapter.keyPoints[0],
    difficulty: i >= 2 ? "Stretch" : "Core",
  }));
  const flashcards = chapters.flatMap((chapter, i) => [
    { id: `f${i * 2 + 1}`, chapterId: chapter.id, front: `What is the main idea of ${chapter.title}?`, back: chapter.summary, hint: "Recall the central idea." },
    { id: `f${i * 2 + 2}`, chapterId: chapter.id, front: `What is one important fact about ${chapter.title}?`, back: chapter.keyPoints[1], hint: "Recall a supporting detail." },
  ]);
  return { title: title || "Study Kit", courseLabel: "Personal study space", overview, chapters, reviewPlan, questions, flashcards };
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "courseLabel", "overview", "chapters", "reviewPlan", "questions", "flashcards"],
  properties: {
    title: { type: "string" },
    courseLabel: { type: "string" },
    overview: { type: "string" },
    chapters: { type: "array", minItems: 3, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "title", "summary", "keyPoints", "objective"], properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, keyPoints: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } }, objective: { type: "string" } } } },
    reviewPlan: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "label", "focus", "tasks", "minutes"], properties: { day: { type: "number" }, label: { type: "string" }, focus: { type: "string" }, tasks: { type: "array", items: { type: "string" } }, minutes: { type: "number" } } } },
    questions: { type: "array", minItems: 3, items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "prompt", "options", "answer", "explanation", "difficulty"], properties: { id: { type: "string" }, chapterId: { type: "string" }, prompt: { type: "string" }, options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } }, answer: { type: "number" }, explanation: { type: "string" }, difficulty: { type: "string" } } } },
    flashcards: { type: "array", minItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "front", "back", "hint"], properties: { id: { type: "string" }, chapterId: { type: "string" }, front: { type: "string" }, back: { type: "string" }, hint: { type: ["string", "null"] } } } },
  },
};

async function generateWithOpenAI(title, source, syllabus, days) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.15,
      response_format: { type: "json_schema", json_schema: { name: "study_kit", strict: true, schema } },
      messages: [
        {
          role: "system",
          content: `You are a document analyst creating a study kit from a lecture, textbook chapter, slide deck, or notes. You MUST synthesize the source rather than mechanically copying or concatenating its sentences.

FIRST mentally analyze the entire source: identify the major topics, what each topic is saying, the relationships between ideas, important causes/effects, definitions, targets, evidence, and examples. THEN write the output from that understanding.

OVERVIEW: Write 2-4 polished sentences explaining the document as a whole. It should answer: what is this material about, what are its major ideas, and how do those ideas relate? Do not merely place the first few source sentences next to each other. Do not mention studying or the study kit.

CHAPTERS: Identify 3-6 genuine major topics. Use the source's meaningful headings when available, but synthesize the content underneath them. Each summary should explain the topic rather than quote it. Key points should be concrete facts or relationships, not fragments.

FLASHCARDS: Create at least 2 cards per major topic. Every front MUST be a natural, specific question ending in '?'. Each card must test exactly one useful idea. Never use a heading, category, title, fragment, or phrase as a front. The back must directly answer the question in 1-3 sentences of normal prose. NEVER use bullets, newline lists, slide-column fragments, or multiple unrelated facts in a back. If the source contains a list, turn the list into a focused question and answer rather than copying the list. Avoid questions like 'What is the main idea of this chapter?' unless the chapter genuinely has no more specific testable content.

IMPORTANT: The uploaded source may contain slide-layout artifacts where two columns were extracted beside each other. Reconstruct the intended meaning from the surrounding material; do not reproduce those artifacts.

Never invent information absent from the source. Never copy metadata such as Subject, Level, Target Use, or Testing Tip. The review plan may contain study actions, but its focuses must be actual source topics.

Return only the JSON matching the schema.`
        },
        {
          role: "user",
          content: `Document title: ${title}\nReview-plan length: ${days} days\nSyllabus/objectives: ${syllabus || "Not provided"}\n\nFULL SOURCE MATERIAL:\n${source}`
        }
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`OpenAI returned HTTP ${response.status}${details ? `: ${details.slice(0, 300)}` : ""}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  const parsed = JSON.parse(content);
  return cleanGeneratedKit(parsed);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const body = req.body || {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const source = cleanText(materials.map((m) => m && m.text ? m.text : "").join("\n\n"));
  const days = Math.max(1, Math.min(30, Number(body.planDays) || 7));
  const syllabus = typeof body.syllabus === "string" ? body.syllabus : "";
  if (!title || !source) return res.status(400).json({ error: "Add a title and at least one valid material." });

  try {
    try {
      const kit = await generateWithOpenAI(title, source, syllabus, days);
      if (kit) return res.status(200).json(kit);
    } catch (error) {
      console.warn("AI generation failed; using source-aware fallback:", error?.message || error);
    }
    return res.status(200).json(fallbackKit(title, source, days));
  } catch (error) {
    console.error("Study kit generation failed", error);
    return res.status(500).json({ error: "Could not generate a study kit." });
  }
}
