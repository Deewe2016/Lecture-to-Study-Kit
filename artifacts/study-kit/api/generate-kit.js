function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 50000);
}

function sentenceList(source) {
  return source.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
}

function sourceSections(source) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = null;
  const numbered = /^\d+\.\s+(.+)$/;
  const heading = /^[A-Z][A-Za-z0-9 &'()/,-]{1,79}$/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const numberedMatch = line.match(numbered);
    const plainHeading = heading.test(line) && line.split(/\s+/).length <= 8 && !/[.!?;:]$/.test(line) && lines[i + 1];
    const title = numberedMatch ? numberedMatch[1].trim() : plainHeading ? line : null;
    if (title) {
      if (current && current.text.length > 20) sections.push(current);
      current = { title, text: "" };
    } else if (current) {
      current.text += `${current.text ? " " : ""}${line}`;
    }
  }
  if (current && current.text.length > 20) sections.push(current);
  return sections.slice(0, 6);
}

function fallbackKit(title, source, days) {
  const facts = sentenceList(source);
  const sections = sourceSections(source);
  const chapters = (sections.length ? sections : [{ title: title || "Study Material", text: facts.slice(0, 8).join(" ") }]).map((section, index) => {
    const points = sentenceList(section.text).slice(0, 3);
    const keyPoints = [points[0], points[1], points[2]].filter(Boolean);
    while (keyPoints.length < 3) keyPoints.push("This section develops the concepts described in the supplied material.");
    return {
      id: `chapter-${index + 1}`,
      title: section.title,
      summary: points[0] || section.text,
      keyPoints,
      objective: `Explain the concepts and relationships presented in ${section.title}.`
    };
  });
  const reviewDays = Math.max(1, Math.min(30, Number(days) || 7));
  return {
    title: title || "Study Kit",
    courseLabel: "Personal study space",
    overview: facts.slice(0, 2).join(" ") || `A study guide based on ${title || "the supplied material"}.`,
    chapters,
    reviewPlan: Array.from({ length: reviewDays }, (_, i) => ({
      day: i + 1,
      label: i === 0 ? "Start here" : i === reviewDays - 1 ? "Ready check" : `Review ${i + 1}`,
      focus: chapters[i % chapters.length].title,
      tasks: i === 0 ? ["Read the overview and chapter summaries", "Recall the main ideas without looking"] : ["Review the key points", i === reviewDays - 1 ? "Take the practice exam" : "Review the flashcards"],
      minutes: i === reviewDays - 1 ? 35 : 25
    })),
    questions: chapters.map((chapter, i) => ({
      id: `q${i + 1}`,
      chapterId: chapter.id,
      prompt: `Which statement is supported by the material about ${chapter.title}?`,
      options: [chapter.keyPoints[0], chapter.keyPoints[1], "The material does not discuss this topic.", "It is unrelated to the other concepts."],
      answer: 0,
      explanation: chapter.keyPoints[0],
      difficulty: i === 2 ? "Stretch" : "Core"
    })),
    flashcards: chapters.flatMap((chapter, i) => [
      { id: `f${i * 2 + 1}`, chapterId: chapter.id, front: `What is the main idea of ${chapter.title}?`, back: chapter.summary, hint: "Recall the main idea." },
      { id: `f${i * 2 + 2}`, chapterId: chapter.id, front: `What is one important point about ${chapter.title}?`, back: chapter.keyPoints[1], hint: "Recall the supporting detail." }
    ])
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
    chapters: { type: "array", minItems: 3, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "title", "summary", "keyPoints", "objective"], properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, keyPoints: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } }, objective: { type: "string" } } } },
    reviewPlan: { type: "array", items: { type: "object", additionalProperties: false, required: ["day", "label", "focus", "tasks", "minutes"], properties: { day: { type: "number" }, label: { type: "string" }, focus: { type: "string" }, tasks: { type: "array", items: { type: "string" } }, minutes: { type: "number" } } } },
    questions: { type: "array", minItems: 3, items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "prompt", "options", "answer", "explanation", "difficulty"], properties: { id: { type: "string" }, chapterId: { type: "string" }, prompt: { type: "string" }, options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } }, answer: { type: "number" }, explanation: { type: "string" }, difficulty: { type: "string" } } } },
    flashcards: { type: "array", minItems: 6, items: { type: "object", additionalProperties: false, required: ["id", "chapterId", "front", "back", "hint"], properties: { id: { type: "string" }, chapterId: { type: "string" }, front: { type: "string" }, back: { type: "string" }, hint: { type: ["string", "null"] } } } }
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
        {
          role: "system",
          content: `You are a careful document analyst and study coach. Build the study kit from the supplied lecture material itself. The quality target is a concise, source-grounded chapter map like a well-designed textbook outline, NOT a generic summary.

IMPORTANT CHAPTER RULES:
- Identify 3-6 major topics/sections actually taught by the source.
- Use the document's real section, chapter, slide, or topic headings when they exist. Preserve meaningful wording from those headings.
- Do NOT use the uploaded document title as the chapter title unless the entire document is genuinely one topic.
- Do NOT invent generic headings such as "Key Definitions", "How the Parts Connect", "Examples and Implications", or "Core Concepts" when the source provides more specific topics.
- A chapter title should describe the actual content: for climate change, examples could be "Key Drivers of Global Climate Change", "Environmental & Socioeconomic Impacts", "The Paris Agreement Target", and "Mitigation & Adaptation Strategies" if those are the topics in the source.

OVERVIEW RULES:
- Write a concise 2-3 sentence overview of what THIS document teaches, argues, defines, or demonstrates.
- Use concrete nouns, facts, concepts, and relationships from the source.
- Never fill the overview with study advice, memory advice, or generic phrases such as "this material helps students understand".

CHAPTER RULES:
- For every chapter, write a short 1-3 sentence summary explaining what that specific section teaches.
- Give 3-5 concrete key points drawn from that section.
- Do not copy large blocks of source text. Synthesize it.
- Never repeat metadata such as Subject, Level, Target Use, or Testing Tip.
- Never invent facts that are absent from the source.

FLASHCARD RULES — VERY IMPORTANT:
- Create at least 2 useful flashcards per major chapter/topic, with each card testing ONE concept, fact, relationship, definition, target, or cause/effect idea.
- The FRONT must be a clear, answerable question. Examples: "What are the main human activities that intensify the greenhouse effect?", "Why does glacial melting contribute to sea-level rise?", "What temperature target does the Paris Agreement seek to keep warming below?"
- Never use a chapter title, section heading, category label, or fragment as the front by itself. NEVER make fronts like "Physical Climate Systems Human & Ecological Systems", "Key Drivers", "Chapter 1", or "Topic: Climate Change".
- Avoid vague fronts such as "What is this chapter about?" when a specific factual question can be asked.
- The BACK must directly answer the question in 1-3 clear sentences. It must be self-contained, concise, and source-grounded.
- Never put multiple bullet points, slide fragments, separate headings, or unrelated concepts on the back. Do not use bullet characters (•, -, *) or newline-separated lists in a flashcard back.
- If the source contains a list, turn that list into a focused question and answer in normal prose rather than dumping the list onto the card.
- Do not copy presentation layout artifacts or text-column headings into flashcards.
- Keep wording natural for studying: a student should be able to look only at the front and know exactly what they are expected to recall.
- Hints should be short and useful, not a restatement of the answer.

STUDY-ITEM RULES:
- Questions, answers, explanations, flashcards, and review-plan focuses must be based on the actual source content.
- Correct quiz answers must be factual statements from the source, not meta-study advice.
- Keep chapter IDs stable and use the matching chapter ID in questions and flashcards.
- The review plan may contain study actions, but its focus must be a real chapter/topic from the source.

Return only the JSON required by the schema.`
        },
        {
          role: "user",
          content: `Document title: ${title}\nRequested review-plan length: ${days} days\nSyllabus/objectives: ${syllabus || "Not provided"}\n\nSOURCE MATERIAL:\n${source}`
        }
      ]
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`OpenAI returned HTTP ${response.status}${details ? `: ${details.slice(0, 300)}` : ""}`);
  }
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
  const syllabus = typeof body.syllabus === "string" ? body.syllabus : "";
  if (!title || !source) return res.status(400).json({ error: "Add a title and at least one valid material." });

  try {
    let kit = null;
    try {
      kit = await generateWithOpenAI(title, source, syllabus, days);
    } catch (error) {
      console.warn("AI generation failed; using source-based fallback.", error?.message || error);
    }
    return res.status(200).json(kit || fallbackKit(title, source, days));
  } catch (error) {
    console.error("Study kit generation failed", error);
    return res.status(500).json({ error: "Could not generate a study kit." });
  }
}
