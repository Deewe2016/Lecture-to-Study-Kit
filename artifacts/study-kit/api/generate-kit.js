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
    .trim();
}

const bad = /(published\s*:\s*\d{4}|global environmental assessment series|climate policy\s*&?\s*science division)/i;

function normalizeKit(kit, title) {
  if (!kit || typeof kit !== "object") return null;
  const chapters = Array.isArray(kit.chapters) ? kit.chapters : [];
  const cards = Array.isArray(kit.flashcards) ? kit.flashcards : [];

  const normalizedChapters = chapters
    .filter((c) => c && typeof c === "object")
    .slice(0, 6)
    .map((c, i) => ({
      id: String(c.id || `chapter-${i + 1}`).replace(/\s+/g, "-").toLowerCase(),
      title: String(c.title || `Topic ${i + 1}`).replace(/\s+/g, " ").trim(),
      summary: String(c.summary || "").replace(/\s+/g, " ").trim().slice(0, 420),
      keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints.map((p) => String(p).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4) : [],
      objective: String(c.objective || "").replace(/\s+/g, " ").trim().slice(0, 220),
    }))
    .filter((c) => c.summary && c.keyPoints.length >= 2);

  const chapterIds = new Set(normalizedChapters.map((c) => c.id));
  const normalizedCards = cards
    .filter((c) => c && typeof c === "object")
    .map((c, i) => ({
      id: String(c.id || `f${i + 1}`),
      chapterId: String(c.chapterId || "").replace(/\s+/g, "-").toLowerCase(),
      front: String(c.front || "").replace(/\s+/g, " ").trim(),
      back: String(c.back || "").replace(/\s+/g, " ").trim(),
      hint: String(c.hint || "Recall the concept before revealing the answer.").replace(/\s+/g, " ").trim(),
    }))
    .filter((c) => {
      if (!chapterIds.has(c.chapterId)) return false;
      if (!c.front.endsWith("?") || c.front.length < 15 || c.front.length > 180) return false;
      if (!c.back || c.back.length < 15 || c.back.length > 350) return false;
      if (bad.test(c.front) || bad.test(c.back)) return false;
      if (/what is the main idea of/i.test(c.front)) return false;
      if (/what does (this|the) (lecture|chapter|document) (say|cover|about)/i.test(c.front)) return false;
      if (/^(key fact|key point|topic|chapter|section)\s*[:#-]/i.test(c.front)) return false;
      return true;
    });

  const overview = String(kit.overview || "").replace(/\s+/g, " ").trim();
  const overviewShort = overview.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(" ").slice(0, 500);
  const cardsForChapters = normalizedCards.filter((c) => chapterIds.has(c.chapterId));
  if (normalizedChapters.length < 3 || cardsForChapters.length < 6 || !overviewShort || overviewShort.split(/\s+/).length > 90) return null;

  return {
    title: String(kit.title || title).replace(/\s+/g, " ").trim(),
    courseLabel: String(kit.courseLabel || "Personal study space").replace(/\s+/g, " ").trim(),
    overview: overviewShort,
    chapters: normalizedChapters,
    reviewPlan: Array.isArray(kit.reviewPlan) ? kit.reviewPlan.slice(0, 30) : [],
    questions: Array.isArray(kit.questions) ? kit.questions.slice(0, 12) : [],
    flashcards: cardsForChapters.slice(0, 24),
  };
}

function buildReviewPlan(chapters, days) {
  return Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    label: i === 0 ? "Start here" : i === days - 1 ? "Ready check" : `Review ${i + 1}`,
    focus: chapters[i % chapters.length].title,
    tasks: i === 0 ? ["Read the overview and chapter summaries", "Recall the three biggest ideas"] : i === days - 1 ? ["Review your weak spots", "Take the practice exam"] : ["Review the key points", "Test yourself with flashcards"],
    minutes: i === days - 1 ? 35 : 25,
  }));
}

async function generateWithGroq(title, source, syllabus, days) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured in Vercel.");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You are an expert teacher and document analyst. Read the ENTIRE supplied lecture material and synthesize it. Never create the result by copying, concatenating, or rearranging source chunks.

Return ONLY JSON with: title, courseLabel, overview, chapters, reviewPlan, questions, flashcards.

Rules:
- Ignore cover metadata, publication details, repeated headers/footers, page numbers, navigation text, and decorative text.
- The overview must summarize the whole lecture in 1-2 concise sentences and under 70 words.
- Identify 3-6 genuine concepts taught by the material. Chapter titles must name concepts, not 'Introduction', 'Overview', 'Chapter 1', or the document title.
- Each chapter summary must explain the concept in your own words. Key points must be concrete facts, mechanisms, relationships, causes/effects, comparisons, targets, or examples supported by the source.
- Create 2-4 flashcards for EACH chapter.
- Every flashcard front must be a specific question testing a concept, mechanism, relationship, comparison, cause/effect, consequence, target, or important fact, and must end with '?'.
- NEVER ask about the document title, publication year, publisher, chapter structure, or the main idea of the document/chapter.
- Every back must directly answer its question in 1-3 concise sentences. Never paste slide headings, metadata, unrelated fragments, or bullet lists.
- Practice questions must test understanding, not document structure.
- Use ONLY information supported by the source. Do not invent facts.
- If PDF extraction mixed columns, reconstruct the intended meaning from context before writing.

Object shapes:
chapter: {id,title,summary,keyPoints,objective}
question: {id,chapterId,prompt,options,answer,explanation,difficulty}
flashcard: {id,chapterId,front,back,hint}` },
        { role: "user", content: `Student title: ${title}\nReview plan: ${days} days\nSyllabus: ${syllabus || "Not provided"}\n\nSOURCE MATERIAL START\n${source}\nSOURCE MATERIAL END\n\nFirst understand the concepts and relationships in the entire source. Then write original teaching-oriented content.` }
      ]
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Groq HTTP ${response.status}: ${details.slice(0, 400)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no content.");
  return JSON.parse(content);
}

function shuffleAnswers(kit) {
  return {
    ...kit,
    questions: (kit.questions || []).map((question) => {
      if (!Array.isArray(question.options) || question.options.length < 2) return question;
      const correct = question.options[question.answer] || question.options[0];
      const options = [...question.options];
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      return { ...question, options, answer: Math.max(0, options.indexOf(correct)) };
    }),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  const body = req.body || {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const source = cleanText(materials.map((m) => m?.text || "").join("\n\n")).slice(0, 50000);
  const days = Math.max(1, Math.min(30, Number(body.planDays) || 7));
  const syllabus = typeof body.syllabus === "string" ? body.syllabus : "";
  if (!title || !source) return res.status(400).json({ error: "Add a title and at least one valid material." });

  try {
    const generated = await generateWithGroq(title, source, syllabus, days);
    const kit = normalizeKit(generated, title);
    if (!kit) return res.status(502).json({ error: "Groq returned a study kit that did not pass the quality checks. Please try again." });
    kit.reviewPlan = buildReviewPlan(kit.chapters, days);
    return res.status(200).json(shuffleAnswers(kit));
  } catch (error) {
    console.error("Study kit generation failed:", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not generate a study kit." });
  }
}
