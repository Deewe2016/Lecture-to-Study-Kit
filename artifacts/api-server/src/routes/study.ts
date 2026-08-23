import { Router, type IRouter } from "express";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { GenerateKitBody, GenerateKitResponse } from "@workspace/api-zod";
import { z } from "zod";

const router: IRouter = Router();

const kitSchema = z.object({
  title: z.string(),
  courseLabel: z.string(),
  overview: z.string(),
  chapters: z.array(z.object({
    id: z.string(), title: z.string(), summary: z.string(),
    keyPoints: z.array(z.string()), objective: z.string().nullable(),
  })),
  reviewPlan: z.array(z.object({
    day: z.number(), label: z.string(), focus: z.string(),
    tasks: z.array(z.string()), minutes: z.number(),
  })),
  questions: z.array(z.object({
    id: z.string(), chapterId: z.string(), prompt: z.string(),
    options: z.array(z.string()), answer: z.number(),
    explanation: z.string(), difficulty: z.string(),
  })),
  flashcards: z.array(z.object({
    id: z.string(), chapterId: z.string(), front: z.string(),
    back: z.string(), hint: z.string().nullable(),
  })),
});

function starterKit(title: string, source: string, planDays: number) {
  const topic = title.replace(/^week\s*\d+\s*[·:-]?\s*/i, "").trim() || "your lecture";
  const facts = source.split(/[.!?]\s+/).map((line) => line.trim()).filter((line) => line.length > 12).slice(0, 8);
  const firstLine = facts[0];
  const chapters = [
    {
      id: "definitions", title: `${topic}: key definitions`,
      summary: firstLine || `This material introduces the main terms and definitions used to explain ${topic}.`,
      keyPoints: facts.slice(0, 3).length ? facts.slice(0, 3) : [`The material defines the main terms used in ${topic}.`, "Related terms describe different parts of the subject.", "Definitions become useful when applied to an example."],
      objective: `Define the central terms used in ${topic}.`,
    },
    {
      id: "relationships", title: `${topic}: how the parts connect`,
      summary: facts[1] || `The material explains how the main concepts in ${topic} relate to one another.`,
      keyPoints: facts.slice(3, 6).length ? facts.slice(3, 6) : ["One concept can change how another concept is understood.", "The order or relationship between terms matters.", "Examples show where the concepts overlap or differ."],
      objective: `Explain the relationships between the main concepts in ${topic}.`,
    },
    {
      id: "examples", title: `${topic}: examples and implications`,
      summary: facts[2] || `The material uses examples to show what ${topic} looks like in practice and why it matters.`,
      keyPoints: facts.slice(6, 8).length ? facts.slice(6, 8) : ["Concrete examples make the abstract idea observable.", "The same principle can appear in more than one situation.", "The implications follow from the definitions and relationships above."],
      objective: `Use a concrete example to explain an implication of ${topic}.`,
    },
  ];
  const reviewPlan = Array.from({ length: planDays }, (_, index) => ({
    day: index + 1,
    label: index === 0 ? "Start here" : index === planDays - 1 ? "Ready check" : `Review ${index + 1}`,
    focus: chapters[index % chapters.length].title,
    tasks: index === 0 ? ["Read the overview and chapter summaries", "Write the main idea from memory"] : ["Review the key points", index === planDays - 1 ? "Take the practice exam" : "Review yesterday's flashcards"],
    minutes: index === 0 ? 25 : index === planDays - 1 ? 35 : 25,
  }));
  const questions = chapters.map((chapter, index) => ({
    id: `q${index + 1}`, chapterId: chapter.id,
    prompt: `According to the material, which statement best describes ${chapter.title.toLowerCase()}?`,
    options: [chapter.keyPoints[0], chapter.keyPoints[1], "It is unrelated to the other concepts in the material.", "The material does not define or describe it."],
    answer: 0,
    explanation: `The material states: ${chapter.keyPoints[0]}`,
    difficulty: index === 2 ? "Stretch" : "Core",
  }));
  return {
    title, courseLabel: "Personal study space",
    overview: `A focused starting map for ${topic}, shaped from the material you provided.`,
    chapters, reviewPlan, questions,
    flashcards: chapters.flatMap((chapter, index) => [
      { id: `f${index * 2 + 1}`, chapterId: chapter.id, front: `What does the material say about ${chapter.title.toLowerCase()}?`, back: chapter.summary, hint: "Recall the sentence from the source." },
      { id: `f${index * 2 + 2}`, chapterId: chapter.id, front: `Which statement is true about ${chapter.title.toLowerCase()}?`, back: chapter.keyPoints[1], hint: "Use the key point, not a study tip." },
    ]),
  };
}

router.post("/generate-kit", async (req, res) => {
  const parsed = GenerateKitBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Add a title and at least one valid material." });
  const input = parsed.data;
  const source = input.materials.map((material) => `${material.name}\n${material.text}`).join("\n\n").slice(0, 50000);
  try {
    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return res.json(GenerateKitResponse.parse(starterKit(input.title, source, input.planDays)));
    const openai = createOpenAI(baseUrl ? { baseURL: baseUrl, apiKey } : { apiKey });
    const { object } = await generateObject({
      model: openai("gpt-5.6-terra"),
      schema: kitSchema,
      prompt: `You are a careful college study coach and document analyst. Build a complete study kit from the supplied lecture material.

First, understand what this specific document is actually about. The overview must be a direct, concrete 2-3 sentence description of the material itself. State what the document teaches, defines, argues, or demonstrates using its actual nouns, terms, facts, examples, and relationships. For a geometry document, say things like "A line is a straight path extending in both directions" if that is what the source says. For example: "This presentation argues that Maglev trains could replace some air travel by using magnetic levitation for zero-contact travel, zero direct carbon emissions, and lower energy consumption." Do not write generic advice such as "connect each definition to an example", "the material becomes easier to remember", or "study the core ideas."

Then return 3-6 chapters with specific, source-grounded titles that describe the actual topics (never generic titles like "Core ideas", "Evidence & examples", or "Application & recall"), plus a ${input.planDays}-day plan, 10-15 multiple-choice questions, and 20-30 flashcards. Map questions and cards to chapter ids. Use syllabus objectives when present. Do not invent facts beyond the source. Every chapter summary, flashcard answer, flashcard question, exam prompt, answer option, and explanation must contain facts or definitions from the material. Never turn these into generic learning advice. Make the correct exam answer the source-grounded statement, not a meta-study behavior.

Title: ${input.title}\\nRequested plan length: ${input.planDays} days\\nSyllabus: ${input.syllabus || "Not provided"}\\nMaterial:\\n${source}`,
    });
    return res.json(GenerateKitResponse.parse(object));
  } catch (error) {
    req.log.error({ err: error }, "study kit generation failed");
    return res.json(GenerateKitResponse.parse(starterKit(input.title, source, input.planDays)));
  }
});

router.post("/tutor", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "Ask for a different explanation." });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const answer = `Try this angle: ${prompt} Start with the simplest definition, connect it to one concrete example, then ask what would change if one part of the example changed.`;
  for (const word of answer.split(" ")) {
    res.write(`data: ${JSON.stringify({ content: `${word} ` })}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  return res.end();
});

export default router;