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
  if (!kit || typeof kit !== "object" || Array.isArray(kit)) return null;
  const clean = (value, fallback = "") => String(value ?? fallback).replace(/\s+/g, " ").trim();
  const asArray = (value) => Array.isArray(value) ? value : [];

  const chapters = asArray(kit.chapters)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 6)
    .map((chapter, index) => ({
      id: clean(chapter.id, `chapter-${index + 1}`) || `chapter-${index + 1}`,
      title: clean(chapter.title, `Topic ${index + 1}`) || `Topic ${index + 1}`,
      summary: clean(chapter.summary).slice(0, 420),
      keyPoints: asArray(chapter.keyPoints).map((point) => clean(point)).filter(Boolean).slice(0, 4),
      objective: clean(chapter.objective).slice(0, 220),
    }));

  const normalizedCards = asArray(kit.flashcards)
    .filter((card) => card && typeof card === "object" && !Array.isArray(card))
    .slice(0, 100)
    .map((card, index) => ({
      id: clean(card.id, `f${index + 1}`) || `f${index + 1}`,
      chapterId: clean(card.chapterId, chapters[0]?.id || ""),
      front: clean(card.front ?? card.question ?? card.term),
      back: clean(card.back ?? card.answer ?? card.definition),
      hint: clean(card.hint, "Recall the concept before revealing the answer."),
    }))
    .filter((card) => card.front || card.back);

  const normalizedQuestions = asArray(kit.questions)
    .filter((question) => question && typeof question === "object" && !Array.isArray(question))
    .slice(0, 50)
    .map((question, index) => {
      const options = asArray(question.options ?? question.choices)
        .map((option) => clean(typeof option === "object" ? option?.text ?? option?.label : option))
        .filter(Boolean);
      const rawAnswer = question.answer ?? question.correctAnswer ?? question.correctOption ?? 0;
      let answer = typeof rawAnswer === "number" ? rawAnswer : options.indexOf(clean(rawAnswer));
      if (!Number.isInteger(answer) || answer < 0 || answer >= Math.max(options.length, 1)) answer = 0;
      return {
        id: clean(question.id, `q${index + 1}`) || `q${index + 1}`,
        chapterId: clean(question.chapterId, chapters[0]?.id || ""),
        prompt: clean(question.prompt ?? question.question ?? question.text),
        options,
        answer,
        explanation: clean(question.explanation ?? question.rationale),
        difficulty: clean(question.difficulty, "standard") || "standard",
      };
    })
    .filter((question) => question.prompt || question.options.length || question.explanation);

  const normalizedPlan = asArray(kit.reviewPlan ?? kit.studyPlan)
    .filter((day) => day && typeof day === "object" && !Array.isArray(day))
    .slice(0, 30)
    .map((day, index) => ({
      day: Number.isFinite(Number(day.day)) && Number(day.day) > 0 ? Number(day.day) : index + 1,
      label: clean(day.label, `Day ${index + 1}`) || `Day ${index + 1}`,
      focus: clean(day.focus ?? day.title ?? day.topic),
      tasks: asArray(day.tasks ?? day.activities).map((task) => clean(typeof task === "object" ? task?.text ?? task?.title : task)).filter(Boolean),
      minutes: Number.isFinite(Number(day.minutes ?? day.duration)) && Number(day.minutes ?? day.duration) >= 0
        ? Number(day.minutes ?? day.duration)
        : 0,
    }))
    .filter((day) => day.focus || day.tasks.length || day.label);

  const overview = clean(kit.overview ?? kit.description).slice(0, 500);
  const hasUsableContent =
    normalizedCards.some((card) => card.front || card.back) ||
    normalizedQuestions.some((question) => question.prompt || question.options.length) ||
    normalizedPlan.some((day) => day.focus || day.tasks.length) ||
    chapters.some((chapter) => chapter.title || chapter.summary || chapter.keyPoints.length);
  if (!hasUsableContent) return null;

  return {
    title: clean(kit.title, title) || title,
    courseLabel: clean(kit.courseLabel, "Personal study space") || "Personal study space",
    overview,
    chapters,
    reviewPlan: normalizedPlan,
    questions: normalizedQuestions,
    flashcards: normalizedCards,
  };
}

function parseGroqJson(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("Groq returned no content.");
  const stripped = content.replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const firstObject = stripped.indexOf("{");
    const lastObject = stripped.lastIndexOf("}");
    if (firstObject < 0 || lastObject <= firstObject) throw new Error("Groq returned content that could not be parsed as JSON.");
    try {
      return JSON.parse(stripped.slice(firstObject, lastObject + 1));
    } catch {
      throw new Error("Groq returned content that could not be parsed as JSON.");
    }
  }
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

async function generateWithGroq(title, source, syllabus, planDays, overviewLevel = "standard") {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured in Vercel.");

  const level = ["beginner", "standard", "advanced"].includes(overviewLevel) ? overviewLevel : "standard";
  const levelInstructions = {
    beginner: `Use beginner-friendly language. Assume the student may not know specialized vocabulary. When a necessary academic term appears, explain it in plain language the first time. Prefer concrete wording and short sentences. Do not remove important concepts just because they are difficult.`,
    standard: `Use normal academic language appropriate for a student studying the subject. Explain uncommon or specialized terms briefly when needed.`,
    advanced: `Use precise subject-specific terminology and include useful nuance, relationships, and distinctions. Assume the student already understands the basic vocabulary.`,
  }[level];

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert educational content designer. You must UNDERSTAND the source before creating the study kit. Never make the output by copying, concatenating, or rearranging source chunks.

The requested explanation level is: ${level.toUpperCase()}.
${levelInstructions}

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
- Do not output Markdown, HTML, SVG, XML, code fences, or UI markup inside any field. All fields must contain plain text only.

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
Requested explanation level: ${level}
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
  return parseGroqJson(content);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const input = req.body || {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const source = cleanText(materials.map((m) => m?.text || "").join("\n\n")).slice(0, 50000);
  const planDays = Math.max(1, Math.min(30, Number(input.planDays) || 7));
  const syllabus = typeof input.syllabus === "string" ? input.syllabus : "";
  const overviewLevel = typeof input.overviewLevel === "string" ? input.overviewLevel.toLowerCase() : "standard";

  if (!title || !source) return res.status(400).json({ error: "Add a title and at least one valid material." });

  try {
    let kit = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const generated = await generateWithGroq(title, source, syllabus, planDays, overviewLevel);
        kit = normalizeKit(generated, title);
        if (kit) break;
        lastError = new Error("Groq returned no usable study content.");
      } catch (error) {
        lastError = error;
      }
    }

    if (!kit) {
      throw lastError || new Error("Groq could not generate usable study content after 3 attempts.");
    }

    if (kit.chapters.length && !kit.reviewPlan.length) {
      kit.reviewPlan = buildReviewPlan(kit.chapters, planDays);
    }
    return res.status(200).json(shuffleAnswers(kit));
  } catch (error) {
    console.error("Study kit generation failed:", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not generate a study kit." });
  }
}
