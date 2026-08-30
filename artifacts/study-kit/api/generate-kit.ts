type Material = { name?: string; kind?: string; text?: string };

type RequestLike = {
  method?: string;
  body?: {
    id?: string;
    title?: string;
    planDays?: number;
    syllabus?: string | null;
    materials?: Material[];
  };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  end: () => void;
};

const metadataHeaderPattern = /^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i;
const sectionHeadingPattern = /^\s*(\d+)\.\s+(.+?)\s*$/;
const plainHeadingPattern = /^[A-Z][A-Za-z0-9 &'()/,-]{1,79}$/;

function cleanDocumentText(source: string) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !metadataHeaderPattern.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function documentSections(source: string) {
  const sections: Array<{ number: string; title: string; text: string }> = [];
  let current: { number: string; title: string; lines: string[] } | null = null;
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const numbered = line.match(sectionHeadingPattern);
    const plain = plainHeadingPattern.test(line) &&
      line.split(/\s+/).length <= 8 &&
      !/[.!?;:]$/.test(line) &&
      Boolean(lines[i + 1]);
    const heading = numbered || (plain ? ["", `${sections.length + 1}`, line] : null);

    if (heading) {
      if (current) {
        sections.push({ number: current.number, title: current.title, text: current.lines.join(" ").trim() });
      }
      current = { number: heading[1], title: heading[2], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push({ number: current.number, title: current.title, text: current.lines.join(" ").trim() });
  }

  return sections.filter((section) => section.text.length > 0);
}

function sentences(source: string) {
  return source
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);
}

function starterKit(title: string, source: string, planDays: number) {
  const topic = title.replace(/^week\s*\d+\s*[·:-]?\s*/i, "").trim() || "your lecture";
  const cleanSource = cleanDocumentText(source);
  const sections = documentSections(cleanSource);
  const facts = sentences(cleanSource).slice(0, 18);

  const chapters = (sections.length >= 1
    ? sections.slice(0, 6).map((section, index) => {
        const sectionFacts = sentences(section.text).slice(0, 4);
        const keyPoints = sectionFacts.length
          ? sectionFacts.slice(0, 3)
          : [section.text, `This section develops ${section.title}.`, `The material applies ${section.title} to the examples that follow.`];
        return {
          id: `section-${section.number}`,
          title: section.title,
          summary: sectionFacts[0] || section.text,
          keyPoints,
          objective: `Explain the definitions and relationships presented in ${section.title}.`,
        };
      })
    : [{
        id: "source",
        title: topic,
        summary: facts[0] || `This material introduces the main terms and ideas used to explain ${topic}.`,
        keyPoints: facts.slice(0, 3).length >= 3 ? facts.slice(0, 3) : [
          facts[0] || `The material defines the main terms used in ${topic}.`,
          facts[1] || "Related terms describe different parts of the subject.",
          facts[2] || "The material connects its definitions to examples and explanations.",
        ],
        objective: `Define and explain the central ideas used in ${topic}.`,
      }]);

  const reviewPlan = Array.from({ length: Math.max(1, Math.min(30, planDays || 7)) }, (_, index) => ({
    day: index + 1,
    label: index === 0 ? "Start here" : index === planDays - 1 ? "Ready check" : `Review ${index + 1}`,
    focus: chapters[index % chapters.length].title,
    tasks: index === 0
      ? ["Read the chapter summaries", "Write the main idea from memory"]
      : ["Review the key points", index === planDays - 1 ? "Take the practice exam" : "Review the flashcards"],
    minutes: index === planDays - 1 ? 35 : 25,
  }));

  const questions = chapters.map((chapter, index) => {
    const correct = chapter.keyPoints[0];
    return {
      id: `q${index + 1}`,
      chapterId: chapter.id,
      prompt: `Which statement is supported by the material about ${chapter.title.toLowerCase()}?`,
      options: [correct, chapter.keyPoints[1], "The material does not discuss this topic.", "It is unrelated to the other concepts in the material."],
      answer: 0,
      explanation: correct,
      difficulty: index === 2 ? "Stretch" : "Core",
    };
  });

  return {
    title,
    courseLabel: "Personal study space",
    overview: facts.length
      ? facts.slice(0, 2).join(" ")
      : `A focused starting map for ${topic}, shaped from the material you provided.`,
    chapters,
    reviewPlan,
    questions,
    flashcards: chapters.flatMap((chapter, index) => [
      { id: `f${index * 2 + 1}`, chapterId: chapter.id, front: `What does ${chapter.title} cover?`, back: chapter.summary, hint: "Recall the chapter summary." },
      { id: `f${index * 2 + 2}`, chapterId: chapter.id, front: `${chapter.title}: key fact`, back: chapter.keyPoints[1], hint: "Recall the second key point." },
    ]),
  };
}

function randomizeAnswers<T extends { questions: Array<{ options: string[]; answer: number }> }>(kit: T) {
  return {
    ...kit,
    questions: kit.questions.map((question) => {
      const correct = question.options[question.answer] ?? question.options[0];
      const options = [...question.options];
      for (let i = options.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
      }
      return { ...question, options, answer: Math.max(0, options.indexOf(correct)) };
    }),
  };
}

const kitJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "courseLabel", "overview", "chapters", "reviewPlan", "questions", "flashcards"],
  properties: {
    title: { type: "string" },
    courseLabel: { type: "string" },
    overview: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "keyPoints", "objective"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
          objective: { type: ["string", "null"] },
        },
      },
    },
    reviewPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day", "label", "focus", "tasks", "minutes"],
        properties: {
          day: { type: "number" },
          label: { type: "string" },
          focus: { type: "string" },
          tasks: { type: "array", items: { type: "string" } },
          minutes: { type: "number" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "chapterId", "prompt", "options", "answer", "explanation", "difficulty"],
        properties: {
          id: { type: "string" },
          chapterId: { type: "string" },
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "number" },
          explanation: { type: "string" },
          difficulty: { type: "string" },
        },
      },
    },
    flashcards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "chapterId", "front", "back", "hint"],
        properties: {
          id: { type: "string" },
          chapterId: { type: "string" },
          front: { type: "string" },
          back: { type: "string" },
          hint: { type: ["string", "null"] },
        },
      },
    },
  },
};

async function tryAiGeneration(title: string, source: string, syllabus: string, planDays: number) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "study_kit",
          strict: true,
          schema: kitJsonSchema,
        },
      },
      messages: [
        {
          role: "system",
          content: "You are a careful study coach. Build a complete study kit using only facts, definitions, examples, and relationships supported by the supplied lecture material. Use real section headings from the source when possible. Do not invent facts. Do not turn content into generic study advice inside chapter summaries, flashcards, quiz answers, or explanations.",
        },
        {
          role: "user",
          content: `Title: ${title}\nRequested plan length: ${planDays} days\nSyllabus: ${syllabus || "Not provided"}\n\nLecture material:\n${source.slice(0, 50000)}`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed with HTTP ${response.status}.`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no study kit.");
  return JSON.parse(content);
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const input = req.body || {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const source = cleanDocumentText(materials.map((material) => material.text || "").join("\n\n")).slice(0, 50000);
  const planDays = Math.max(1, Math.min(30, Number(input.planDays) || 7));

  if (!title || !source) {
    res.status(400).json({ error: "Add a title and at least one valid material." });
    return;
  }

  try {
    let kit;
    try {
      kit = await tryAiGeneration(title, source, typeof input.syllabus === "string" ? input.syllabus : "", planDays);
    } catch (error) {
      console.warn("AI generation unavailable; using local source-based generator.", error);
      kit = null;
    }

    if (!kit) kit = starterKit(title, source, planDays);
    res.status(200).json(randomizeAnswers(kit));
  } catch (error) {
    console.error("Study kit generation failed", error);
    res.status(500).json({ error: "Could not generate a study kit." });
  }
}
