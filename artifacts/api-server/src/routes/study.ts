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

function starterKit(title: string, source: string) {
  const topic = title.replace(/^week\s*\d+\s*[·:-]?\s*/i, "").trim() || "your lecture";
  const firstLine = source.split(/\n+/).map((line) => line.trim()).find(Boolean);
  const chapters = [
    {
      id: "core-ideas", title: "Core ideas",
      summary: `The central argument of ${topic} is easier to hold when you connect each definition to an example and a consequence.`,
      keyPoints: [firstLine || "Name the main concept in your own words.", "Notice the relationship between the key terms.", "Test the idea with a concrete example."],
      objective: "Explain the lecture's main ideas and how they relate.",
    },
    {
      id: "evidence", title: "Evidence & examples",
      summary: "The examples and evidence make the abstract material usable. Ask what each example proves and where it stops being useful.",
      keyPoints: ["Separate claims from supporting evidence.", "Compare examples rather than memorizing them in isolation.", "Look for exceptions and boundary cases."],
      objective: "Use examples to distinguish related concepts.",
    },
    {
      id: "application", title: "Application & recall",
      summary: "Strong exam answers move from recall to application: identify the concept, justify the choice, and explain the result.",
      keyPoints: ["Start with a retrieval cue.", "Explain why an answer is right, not only what it is.", "Practice with unfamiliar scenarios."],
      objective: "Apply the material to a new scenario.",
    },
  ];
  const reviewPlan = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    label: ["Start here", "Connect", "Deepen", "Practice", "Repair", "Mix it up", "Ready check"][index],
    focus: chapters[index % chapters.length].title,
    tasks: index === 0 ? ["Read the overview and chapter summaries", "Write the main idea from memory"] : ["Review the key points", index === 3 ? "Take the practice exam" : "Review yesterday's flashcards"],
    minutes: [25, 30, 25, 35, 25, 30, 15][index],
  }));
  const questions = chapters.map((chapter, index) => ({
    id: `q${index + 1}`, chapterId: chapter.id,
    prompt: `Which approach best demonstrates understanding of ${chapter.title.toLowerCase()}?`,
    options: ["Repeat the definition without context", "Connect the idea to evidence or a new example", "Skip the difficult part", "Memorize the heading only"],
    answer: 1,
    explanation: "Connecting a concept to evidence or a new example shows that you can retrieve and apply it.",
    difficulty: index === 2 ? "Stretch" : "Core",
  }));
  return {
    title, courseLabel: "Personal study space",
    overview: `A focused starting map for ${topic}, shaped from the material you provided.`,
    chapters, reviewPlan, questions,
    flashcards: chapters.flatMap((chapter, index) => [
      { id: `f${index * 2 + 1}`, chapterId: chapter.id, front: `What is the central question in ${chapter.title}?`, back: chapter.summary, hint: "Start with the chapter objective." },
      { id: `f${index * 2 + 2}`, chapterId: chapter.id, front: `How would you apply ${chapter.title.toLowerCase()}?`, back: chapter.keyPoints[1], hint: "Think of a fresh scenario." },
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
    if (!apiKey) return res.json(GenerateKitResponse.parse(starterKit(input.title, source)));
    const openai = createOpenAI(baseUrl ? { baseURL: baseUrl, apiKey } : { apiKey });
    const { object } = await generateObject({
      model: openai("gpt-5.6-terra"),
      schema: kitSchema,
      prompt: `You are a careful college study coach and document analyst. Build a complete study kit from the supplied lecture material.

First, understand what this specific document is actually about. The overview must be a direct, concrete 2-3 sentence description of the document's thesis, subject, mechanism, evidence, or implications. It must name the real topic and claims from the source, not give study advice or describe the act of studying. For example: "This presentation argues that Maglev trains could replace some air travel by using magnetic levitation for zero-contact travel, zero direct carbon emissions, and lower energy consumption." Do not write generic text such as "This document covers core ideas" or "This material provides evidence and examples."

Then return 3-6 chapters with specific, source-grounded titles that describe the actual topics (never generic titles like "Core ideas", "Evidence & examples", or "Application & recall"), plus a 7-day plan, 10-15 multiple-choice questions, and 20-30 flashcards. Map questions and cards to chapter ids. Use syllabus objectives when present. Do not invent facts beyond the source. Questions and flashcards should test the document's actual claims, terms, examples, and relationships.

Title: ${input.title}\\nSyllabus: ${input.syllabus || "Not provided"}\\nMaterial:\\n${source}`,
    });
    return res.json(GenerateKitResponse.parse(object));
  } catch (error) {
    req.log.error({ err: error }, "study kit generation failed");
    return res.json(GenerateKitResponse.parse(starterKit(input.title, source)));
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