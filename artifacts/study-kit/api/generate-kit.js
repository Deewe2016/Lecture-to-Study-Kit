function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i.test(line))
    .filter((line) => !/^(published\s*:|global environmental assessment series|climate policy\s*&?\s*science division)$/i.test(line))
    .filter((line) => !/^page\s+\d+$/i.test(line))
    .join("\n")
    .slice(0, 60000);
}

const badMetadata = /(published\s*:\s*\d{4}|global environmental assessment series|climate policy\s*&?\s*science division|comprehensive analysis\s*&?\s*insight|understanding climate change published)/i;

function cleanGeneratedKit(kit) {
  if (!kit || typeof kit !== "object") return null;
  const chapters = Array.isArray(kit.chapters) ? kit.chapters : [];
  const chapterIds = new Set(chapters.map((c) => String(c.id)));
  if (chapters.length < 3 || chapters.length > 6) return null;

  const cleanedChapters = chapters.map((chapter, i) => ({
    ...chapter,
    id: String(chapter.id || `chapter-${i + 1}`),
    title: String(chapter.title || "").replace(/\s+/g, " ").trim(),
    summary: String(chapter.summary || "").replace(/\s+/g, " ").trim(),
    keyPoints: Array.isArray(chapter.keyPoints)
      ? chapter.keyPoints.map((p) => String(p).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5)
      : [],
    objective: String(chapter.objective || "").replace(/\s+/g, " ").trim(),
  }));

  const flashcards = (Array.isArray(kit.flashcards) ? kit.flashcards : [])
    .map((card, i) => ({
      ...card,
      id: String(card.id || `f${i + 1}`),
      chapterId: String(card.chapterId || ""),
      front: String(card.front || "").replace(/\s+/g, " ").trim(),
      back: String(card.back || "").replace(/\s+/g, " ").trim(),
      hint: card.hint == null ? null : String(card.hint).replace(/\s+/g, " ").trim(),
    }))
    .filter((card) => {
      if (!chapterIds.has(card.chapterId)) return false;
      if (!card.front.endsWith("?")) return false;
      if (card.front.length < 15 || card.front.length > 180) return false;
      if (card.back.length < 20 || card.back.length > 450) return false;
      if (badMetadata.test(card.front) || badMetadata.test(card.back)) return false;
      if (/what (does|is) (this|the) (chapter|section|document) (cover|about)|main idea of .*(document|lecture|chapter)/i.test(card.front)) return false;
      if (/^(key fact|key point|topic|chapter|section)\s*[:#-]/i.test(card.front)) return false;
      if (/[•\n]/.test(card.back)) return false;
      return true;
    });

  if (flashcards.length < chapters.length * 2) return null;

  const overview = String(kit.overview || "").replace(/\s+/g, " ").trim();
  if (!overview || overview.length > 600 || badMetadata.test(overview)) return null;

  return {
    title: String(kit.title || "Study Kit").replace(/\s+/g, " ").trim(),
    courseLabel: String(kit.courseLabel || "Personal study space").replace(/\s+/g, " ").trim(),
    overview,
    chapters: cleanedChapters,
    reviewPlan: Array.isArray(kit.reviewPlan) ? kit.reviewPlan : [],
    questions: Array.isArray(kit.questions) ? kit.questions : [],
    flashcards: flashcards.slice(0, 30),
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
    chapters: {
      type: "array", minItems: 3, maxItems: 6,
      items: { type: "object", additionalProperties: false, required: ["id", "title", "summary", "keyPoints", "objective"], properties: {
        id: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
        keyPoints: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } }, objective: { type: "string" }
      }}
    },
    reviewPlan: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "label", "focus", "tasks", "minutes"], properties: {
      day: { type: "number" }, label: { type: "string" }, focus: { type: "string" }, tasks: { type: "array", items: { type: "string" } }, minutes: { type: "number" }
    }}},
    questions: { type: "array", minItems: 3, items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "prompt", "options", "answer", "explanation", "difficulty"], properties: {
      id: { type: "string" }, chapterId: { type: "string" }, prompt: { type: "string" }, options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } }, answer: { type: "number" }, explanation: { type: "string" }, difficulty: { type: "string" }
    }}},
    flashcards: { type: "array", minItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "front", "back", "hint"], properties: {
      id: { type: "string" }, chapterId: { type: "string" }, front: { type: "string" }, back: { type: "string" }, hint: { type: ["string", "null"] }
    }}},
  },
};

async function generateWithOpenAI(title, source, syllabus, days) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured on the deployed app");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: { name: "study_kit", strict: true, schema } },
      messages: [
        {
          role: "system",
          content: `You are an expert teacher and document analyst. You are given extracted text from a lecture or slide deck. Your job is to UNDERSTAND the material and teach it back, not to rearrange its text.

Do this internally before writing the JSON:
1. Ignore cover-page metadata, publication details, series names, page numbers, repeated headers/footers, and decorative text.
2. Reconstruct the intended meaning when PDF extraction has mixed columns, bullets, or slide fragments together.
3. Identify the 3-6 real concepts the lecture teaches and the relationships among them.
4. Only then write the study kit in your own words.

OVERVIEW: Exactly 1-2 polished sentences, ideally 35-70 words. Summarize the whole lecture, not the first slide. Never mention the document's publication information.

CHAPTERS: Use 3-6 genuine concepts. Chapter titles must be meaningful concepts such as 'Greenhouse Gases and Human Drivers', not 'Introduction', 'Overview', 'Chapter 1', or the document title. Summaries explain what the concept means and why it matters. Key points are concrete facts, mechanisms, cause/effect relationships, comparisons, targets, or examples.

FLASHCARDS: Create 2-4 cards for EACH chapter. Every front is a specific question that tests one useful idea and ends with '?'. Ask about definitions, mechanisms, causes/effects, comparisons, consequences, targets, or important relationships. Never ask about the document, its title, publication year, publisher, chapter structure, or 'the main idea of this chapter'. Never use a heading or fragment as a front.

Each flashcard back must directly answer its question in 1-3 concise sentences. It must be written as normal prose. NEVER paste a bullet list, slide text, column fragments, metadata, or several unrelated facts. If the source has a list, convert it into a focused question and explain the relevant relationship instead of copying the list.

Examples of GOOD cards:
- 'Why does ocean acidification threaten marine ecosystems?' -> a concise explanation of the chemical/ecological relationship supported by the source.
- 'What human activities are identified as major drivers of climate change?' -> a concise answer naming and explaining the activities.
- 'Why is the 1.5°C target important in the lecture?' -> a concise explanation of its significance.

Examples of BAD cards:
- 'What is the main idea of Understanding Climate Change?'
- 'What does Chapter 1 cover?'
- 'What is one important fact about Climate Change?'
- A front that is just a heading.
- A back containing copied slide fragments such as 'Published: 2026 Global Environmental Assessment Series'.

Use ONLY information supported by the source. Do not invent facts. The result should feel like a teacher made the cards after reading the entire lecture.`
        },
        {
          role: "user",
          content: `Student title: ${title}\nReview plan: ${days} days\nSyllabus: ${syllabus || "Not provided"}\n\nSOURCE MATERIAL START\n${source}\nSOURCE MATERIAL END\n\nNow synthesize the material and return only the requested JSON.`
        }
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`OpenAI returned HTTP ${response.status}${details ? `: ${details.slice(0, 400)}` : ""}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return cleanGeneratedKit(JSON.parse(content));
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
    const kit = await generateWithOpenAI(title, source, syllabus, days);
    if (!kit) return res.status(502).json({ error: "The AI returned a study kit that did not pass the content-quality checks. Please try again." });
    return res.status(200).json(kit);
  } catch (error) {
    console.error("Study kit generation failed:", error?.message || error);
    return res.status(502).json({ error: error?.message || "Could not generate a study kit." });
  }
}
