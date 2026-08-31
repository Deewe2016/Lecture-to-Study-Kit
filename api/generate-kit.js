function cleanText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i.test(line))
    .filter((line) => !/^(published\s*:|global environmental assessment series|climate policy\s*&?\s*science division)$/i.test(line))
    .filter((line) => !/^page\s+\d+$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeKit(kit, title) {
  if (!kit || typeof kit !== "object") return null;
  const bad = /(published\s*:\s*\d{4}|global environmental assessment series|climate policy\s*&?\s*science division)/i;
  const chapters = Array.isArray(kit.chapters) ? kit.chapters : [];
  const cards = Array.isArray(kit.flashcards) ? kit.flashcards : [];

  const normalizedChapters = chapters
    .filter((c) => c && typeof c === "object")
    .slice(0, 6)
    .map((c, i) => ({
      id: String(c.id || `chapter-${i + 1}`),
      title: String(c.title || `Topic ${i + 1}`).replace(/\s+/g, " ").trim(),
      summary: String(c.summary || "").replace(/\s+/g, " ").trim().slice(0, 420),
      keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints.map((p) => String(p).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4) : [],
      objective: String(c.objective || "").replace(/\s+/g, " ").trim().slice(0, 220),
    }))
    .filter((c) => c.summary && c.keyPoints.length >= 2);

  const normalizedCards = cards
    .filter((c) => c && typeof c === "object")
    .map((c, i) => ({
      id: String(c.id || `f${i + 1}`),
      chapterId: String(c.chapterId || ""),
      front: String(c.front || "").replace(/\s+/g, " ").trim(),
      back: String(c.back || "").replace(/\s+/g, " ").trim(),
      hint: String(c.hint || "Recall the concept before revealing the answer.").replace(/\s+/g, " ").trim(),
    }))
    .filter((c) => {
      if (!c.chapterId || !c.front.endsWith("?") || c.front.length < 15 || c.front.length > 180) return false;
      if (!c.back || c.back.length < 15 || c.back.length > 350) return false;
      if (bad.test(c.front) || bad.test(c.back)) return false;
      if (/what is the main idea of/i.test(c.front)) return false;
      if (/^(what does (this|the) (lecture|chapter|document) say|what is this (lecture|chapter) about)/i.test(c.front)) return false;
      return true;
    })
    .slice(0, 24);

  const overview = String(kit.overview || "").replace(/\s+/g, " ").trim();
  const overviewSentences = overview.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(" ").slice(0, 500);
  if (normalizedChapters.length < 3 || normalizedCards.length < 6 || !overviewSentences || overviewSentences.split(/\s+/).length > 90) return null;

  const chapterIds = new Set(normalizedChapters.map((c) => c.id));
  const cardsForRealChapters = normalizedCards.filter((c) => chapterIds.has(c.chapterId));
  if (cardsForRealChapters.length < 6) return null;

  return {
    title: String(kit.title || title).replace(/\s+/g, " ").trim(),
    courseLabel: String(kit.courseLabel || "Personal study space").replace(/\s+/g, " ").trim(),
    overview: overviewSentences,
    chapters: normalizedChapters,
    reviewPlan: Array.isArray(kit.reviewPlan) ? kit.reviewPlan.slice(0, 30) : [],
    questions: Array.isArray(kit.questions) ? kit.questions.slice(0, 12) : [],
    flashcards: cardsForRealChapters,
  };
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

function buildReviewPlan(chapters, days) {
  return Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    label: i === 0 ? "Start here" : i === days - 1 ? "Ready check" : `Review ${i + 1}`,
    focus: chapters[i % chapters.length].title,
    tasks: i === 0
      ? ["Read the overview and chapter summaries", "Recall the three biggest ideas"]
      : i === days - 1
        ? ["Review your weak spots", "Take the practice exam"]
        : ["Review the key points", "Test yourself with flashcards"],
    minutes: i === days - 1 ? 35 : 25,
  }));
}

async function generateWithGroq(title, source, syllabus, planDays) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured in Vercel.");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert educational content designer. You must UNDERSTAND the source before creating the study kit. Never make the output by copying, concatenating, or rearranging source chunks.

Return ONLY valid JSON with these top-level keys: title, courseLabel, overview, chapters, reviewPlan, questions, flashcards.

HARD RULES:
- Ignore cover-page metadata, publication details, repeated headers/footers, page numbers, navigation text, and decorative text.
- Never create a flashcard about the document title, publication year, publisher, series, author, or "main idea of [document]".
- The overview must synthesize the whole lecture in exactly 1–2 concise sentences and at most 70 words.
- Identify 3–6 REAL concepts taught by the source. Chapter titles must name those concepts.
- Each chapter summary must explain the concept in your own words. Key points must be facts, mechanisms, relationships, causes/effects, examples, or distinctions supported by the source.
- Create 2–4 flashcards for EACH chapter. Every front must be a specific question that tests understanding of a concept, mechanism, relationship, comparison, cause/effect, or important fact.
- Good card: "Why does increased atmospheric CO2 affect ocean chemistry?"
- Bad card: "What is the main idea of Understanding Climate Change?"
- Bad card: "What does Chapter 1 cover?"
- Every back must directly answer its question in 1–3 concise sentences. Never paste slide headings, metadata, or unrelated source fragments.
- Do not use headings or labels as answers.
- Practice questions must test understanding, not document structure.
- If PDF extraction mixed columns, reconstruct meaning from context.
- Use ONLY information supported by the source. Do not invent facts.

Schemas:
chapter={id,title,summary,keyPoints,objective}
reviewPlan item={day,label,focus,tasks,minutes}
question={id,chapterId,prompt,options,answer,explanation,difficulty}
flashcard={id,chapterId,front,back,hint}`,
        },
        {
          role: "user",
          content: `Create the study kit now.
Student title: ${title}
Plan length: ${planDays} days
Syllabus: ${syllabus || "Not provided"}

SOURCE MATERIAL START
${source.slice(0, 50000)}
SOURCE MATERIAL END

First identify the concepts mentally. Then write original teaching-oriented content. The final flashcards must test knowledge from those concepts, not the file itself.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no content.");
  return JSON.parse(content);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const input = req.body || {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const source = cleanText(materials.map((m) => m?.text || "").join("\n\n")).slice(0, 50000);
  const planDays = Math.max(1, Math.min(30, Number(input.planDays) || 7));
  const syllabus = typeof input.syllabus === "string" ? input.syllabus : "";

  if (!title || !source) return res.status(400).json({ error: "Add a title and at least one valid material." });

  try {
    const generated = await generateWithGroq(title, source, syllabus, planDays);
    const kit = normalizeKit(generated, title);
    if (!kit) return res.status(502).json({ error: "Groq returned a study kit that did not pass the quality checks. Please try again." });

    kit.reviewPlan = buildReviewPlan(kit.chapters, planDays);
    return res.status(200).json(shuffleAnswers(kit));
  } catch (error) {
    console.error("Study kit generation failed:", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not generate a study kit." });
  }
}
