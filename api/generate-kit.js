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

function sentences(source) {
  return source.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30);
}

function meaningfulSentences(source) {
  return sentences(source).filter((s) => {
    const lower = s.toLowerCase();
    return !lower.includes("global environmental assessment series") &&
      !lower.includes("climate policy & science division") &&
      !/^published\s*:/i.test(s) &&
      !/^understanding climate change$/i.test(s);
  });
}

function starterKit(title, source, planDays) {
  const facts = meaningfulSentences(source).slice(0, 24);
  const topic = title || "Your Lecture";
  const topicSentences = facts.length ? facts : [`This material explains the main concepts in ${topic}.`];
  const chapters = [];
  const chapterCount = Math.min(5, Math.max(3, Math.ceil(topicSentences.length / 4)));
  for (let i = 0; i < chapterCount; i++) {
    const start = Math.floor(i * topicSentences.length / chapterCount);
    const end = Math.floor((i + 1) * topicSentences.length / chapterCount);
    const group = topicSentences.slice(start, Math.max(start + 1, end));
    const first = group[0];
    const heading = first.split(/[:.!?]/)[0].trim();
    chapters.push({
      id: `chapter-${i + 1}`,
      title: heading.length >= 8 && heading.length <= 70 ? heading : `${topic} · Topic ${i + 1}`,
      summary: group.slice(0, 2).join(" "),
      keyPoints: group.slice(0, 3),
      objective: `Explain the main ideas in this part of ${topic}.`
    });
  }

  const days = Math.max(1, Math.min(30, Number(planDays) || 7));
  const reviewPlan = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    label: i === 0 ? "Start here" : i === days - 1 ? "Ready check" : `Review ${i + 1}`,
    focus: chapters[i % chapters.length].title,
    tasks: i === 0 ? ["Read the overview and chapter summaries", "Recall the three biggest ideas"] : ["Review key points", i === days - 1 ? "Take the practice exam" : "Review the flashcards"],
    minutes: i === days - 1 ? 35 : 25
  }));

  const flashcards = chapters.flatMap((chapter, i) => chapter.keyPoints.slice(0, 2).map((point, j) => ({
    id: `f${i * 2 + j + 1}`,
    chapterId: chapter.id,
    front: `What is the key point about ${chapter.title}?`,
    back: point,
    hint: "Answer in your own words before revealing it."
  })));

  const questions = chapters.map((chapter, i) => ({
    id: `q${i + 1}`,
    chapterId: chapter.id,
    prompt: `Which statement best matches the material about ${chapter.title}?`,
    options: [chapter.keyPoints[0], chapter.keyPoints[1] || chapter.summary, "The material does not address this idea.", "The topic is unrelated to the lecture."],
    answer: 0,
    explanation: chapter.keyPoints[0],
    difficulty: "Core"
  }));

  return {
    title: topic,
    courseLabel: "Personal study space",
    overview: topicSentences.slice(0, 2).join(" ").slice(0, 420),
    chapters,
    reviewPlan,
    questions,
    flashcards
  };
}

function normalizeKit(kit, title, source, planDays) {
  if (!kit || typeof kit !== "object") return null;
  const chapters = Array.isArray(kit.chapters) ? kit.chapters : [];
  const cards = Array.isArray(kit.flashcards) ? kit.flashcards : [];
  const overview = String(kit.overview || "").replace(/\s+/g, " ").trim();

  // Reject the kind of output that caused the broken cards: title/metadata questions,
  // copied publication information, or answers that are essentially source dumps.
  const badMetadata = /(published\s*:\s*\d{4}|global environmental assessment series|climate policy\s*&?\s*science division|comprehensive analysis\s*&?\s*insight)/i;
  const validCards = cards.filter((card) => {
    const front = String(card?.front || "").replace(/\s+/g, " ").trim();
    const back = String(card?.back || "").replace(/\s+/g, " ").trim();
    if (!front || !back || front.length < 10 || back.length < 8) return false;
    if (!/[?]$/.test(front)) return false;
    if (badMetadata.test(front) || badMetadata.test(back)) return false;
    if (/what is the main idea of\s+[^?]+\?/i.test(front)) return false;
    if (back.length > 450) return false;
    if (front.length > 180) return false;
    return true;
  }).map((card, i) => ({
    ...card,
    id: String(card.id || `f${i + 1}`),
    front: String(card.front).replace(/\s+/g, " ").trim(),
    back: String(card.back).replace(/\s+/g, " ").trim(),
    hint: String(card.hint || "Recall the concept before revealing the answer.").replace(/\s+/g, " ").trim()
  }));

  if (chapters.length < 3 || validCards.length < Math.min(6, chapters.length * 2) || overview.length > 500) return null;

  return {
    ...kit,
    title: String(kit.title || title).trim(),
    overview: overview.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 500),
    chapters: chapters.slice(0, 6).map((chapter, i) => ({
      ...chapter,
      id: String(chapter.id || `chapter-${i + 1}`),
      title: String(chapter.title || `Topic ${i + 1}`).replace(/\s+/g, " ").trim(),
      summary: String(chapter.summary || "").replace(/\s+/g, " ").trim().slice(0, 500),
      keyPoints: Array.isArray(chapter.keyPoints) ? chapter.keyPoints.map((p) => String(p).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4) : [],
      objective: String(chapter.objective || "").replace(/\s+/g, " ").trim()
    })),
    flashcards: validCards.slice(0, 24)
  };
}

function shuffleAnswers(kit) {
  return {
    ...kit,
    questions: (kit.questions || []).map((question) => {
      const correct = question.options[question.answer] || question.options[0];
      const options = [...question.options];
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      return { ...question, options, answer: Math.max(0, options.indexOf(correct)) };
    })
  };
}

async function generateWithOpenAI(title, source, syllabus, planDays) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert educational content designer. Your job is to UNDERSTAND the lecture, identify its concepts, and then teach those concepts. Do NOT copy, concatenate, or rearrange chunks of the source.

Return ONLY valid JSON with exactly these top-level keys: title, courseLabel, overview, chapters, reviewPlan, questions, flashcards.

CRITICAL CONTENT RULES:
1. Ignore cover-page metadata, publication information, page numbers, repeated headers/footers, and decorative text. Never make a flashcard about the document title, publication year, publisher/series, or the phrase 'main idea of [document]'.
2. The overview must be a SYNTHESIS of the entire lecture in exactly 1–2 concise sentences and no more than 70 words.
3. Identify 3–6 distinct concepts/topics that are actually taught in the material. Chapter titles must name concepts, not generic labels like 'Introduction', 'Overview', or the document title.
4. Each chapter summary must explain the concept in your own words. Each key point must be a meaningful fact, relationship, mechanism, consequence, example, or distinction from the lecture.
5. Create 2–4 flashcards PER chapter. A flashcard front MUST be a specific study question about a concept, mechanism, relationship, cause/effect, comparison, or important fact. Good examples: 'Why does ocean acidification threaten marine ecosystems?' or 'How does methane differ from carbon dioxide as a climate driver?'. Bad examples: 'What is the main idea of Understanding Climate Change?', 'What does Chapter 1 cover?', 'key fact', or questions about the document itself.
6. Every flashcard back must directly answer its front in 1–3 concise sentences. NEVER paste slide headers, publication metadata, unrelated text, or a collection of source fragments. Do not answer a question with a heading followed by another heading.
7. Questions should test understanding, not document structure. Avoid asking 'What does the lecture say?' or 'What is this chapter about?'.
8. If PDF extraction has text from two columns mixed together, reconstruct the meaning from context rather than reproducing the mixed text.
9. Use ONLY information supported by the lecture. Do not invent facts.

Schema details:
- chapter: {id,title,summary,keyPoints,objective}
- reviewPlan item: {day,label,focus,tasks,minutes}
- question: {id,chapterId,prompt,options,answer,explanation,difficulty}
- flashcard: {id,chapterId,front,back,hint}`
        },
        {
          role: "user",
          content: `Create a study kit from this material.

Student title: ${title}
Plan length: ${planDays} days
Syllabus (optional): ${syllabus || "Not provided"}

SOURCE MATERIAL START
${source.slice(0, 50000)}
SOURCE MATERIAL END

Before producing the JSON, mentally separate the source into its real concepts and discard document metadata. The flashcards must teach the concepts, not the file.`
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return JSON.parse(content);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const input = req.body || {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const source = cleanText(materials.map((m) => m && m.text ? m.text : "").join("\n\n")).slice(0, 50000);
  const planDays = Math.max(1, Math.min(30, Number(input.planDays) || 7));
  const syllabus = typeof input.syllabus === "string" ? input.syllabus : "";

  if (!title || !source) {
    res.status(400).json({ error: "Add a title and at least one valid material." });
    return;
  }

  try {
    let kit = null;
    try {
      const generated = await generateWithOpenAI(title, source, syllabus, planDays);
      kit = normalizeKit(generated, title, source, planDays);
      if (!kit) console.warn("AI output failed quality checks; using structured fallback.");
    } catch (error) {
      console.warn("AI generation failed; using structured fallback.", error?.message || error);
    }
    if (!kit) kit = starterKit(title, source, planDays);
    res.status(200).json(shuffleAnswers(kit));
  } catch (error) {
    console.error("Study kit generation failed", error);
    res.status(500).json({ error: "Could not generate a study kit." });
  }
}
