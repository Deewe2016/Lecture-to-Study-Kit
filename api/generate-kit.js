function cleanText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sentences(source) {
  return source.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
}

function starterKit(title, source, planDays) {
  const facts = sentences(source).slice(0, 18);
  const topic = title || "Your Lecture";
  const chapters = [{
    id: "source",
    title: topic,
    summary: facts[0] || `This material introduces the main ideas in ${topic}.`,
    keyPoints: [
      facts[0] || `The material defines the main ideas used in ${topic}.`,
      facts[1] || "Related ideas explain different parts of the subject.",
      facts[2] || "The material connects its ideas to explanations and examples."
    ],
    objective: `Explain the central ideas presented in ${topic}.`
  }];

  const days = Math.max(1, Math.min(30, Number(planDays) || 7));
  const reviewPlan = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    label: i === 0 ? "Start here" : i === days - 1 ? "Ready check" : `Review ${i + 1}`,
    focus: topic,
    tasks: i === 0 ? ["Read the material", "Write the main idea from memory"] : ["Review the key points", i === days - 1 ? "Take the practice exam" : "Review the flashcards"],
    minutes: i === days - 1 ? 35 : 25
  }));

  return {
    title: topic,
    courseLabel: "Personal study space",
    overview: facts.slice(0, 2).join(" ") || `A study map based on the material you provided about ${topic}.`,
    chapters,
    reviewPlan,
    questions: chapters.map((chapter, i) => ({
      id: `q${i + 1}`,
      chapterId: chapter.id,
      prompt: `Which statement is supported by the material about ${chapter.title}?`,
      options: [chapter.keyPoints[0], chapter.keyPoints[1], "The material does not discuss this topic.", "It is unrelated to the other concepts."],
      answer: 0,
      explanation: chapter.keyPoints[0],
      difficulty: "Core"
    })),
    flashcards: chapters.flatMap((chapter, i) => [
      { id: `f${i * 2 + 1}`, chapterId: chapter.id, front: `What does ${chapter.title} cover?`, back: chapter.summary, hint: "Recall the summary." },
      { id: `f${i * 2 + 2}`, chapterId: chapter.id, front: `${chapter.title}: key fact`, back: chapter.keyPoints[1], hint: "Recall the second key point." }
    ])
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
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a careful study coach. Create a complete study kit using only information supported by the supplied lecture material. Return ONLY valid JSON with exactly these top-level keys: title, courseLabel, overview, chapters, reviewPlan, questions, flashcards. Each chapter must have id,title,summary,keyPoints,objective. Each reviewPlan item must have day,label,focus,tasks,minutes. Each question must have id,chapterId,prompt,options,answer,explanation,difficulty. Each flashcard must have id,chapterId,front,back,hint. Do not invent facts."
        },
        {
          role: "user",
          content: `Title: ${title}\nPlan length: ${planDays} days\nSyllabus: ${syllabus || "Not provided"}\n\nLecture material:\n${source.slice(0, 50000)}`
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
      kit = await generateWithOpenAI(title, source, syllabus, planDays);
    } catch (error) {
      console.warn("AI generation failed; using local fallback.", error?.message || error);
    }
    if (!kit) kit = starterKit(title, source, planDays);
    res.status(200).json(shuffleAnswers(kit));
  } catch (error) {
    console.error("Study kit generation failed", error);
    res.status(500).json({ error: "Could not generate a study kit." });
  }
}
