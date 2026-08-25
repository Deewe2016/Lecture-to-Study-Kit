import { Router, type IRouter } from "express";
import { experimental_transcribe, generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { GenerateKitBody, GenerateKitResponse } from "@workspace/api-zod";
import { db, studyKits } from "@workspace/db";
import { eq } from "drizzle-orm";
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

const metadataHeaderPattern = /^\s*(Subject|Level|Target Use|Testing Tip)\s*:/i;
const sectionHeadingPattern = /^\s*(\d+)\.\s+(.+?)\s*$/;
const plainHeadingPattern = /^[A-Z][A-Za-z0-9 &'()/,-]{1,79}$/;
const videoTranscriptBody = z.object({
  url: z.string().url().nullable(),
  fileName: z.string().nullable(),
  fileData: z.string().nullable(),
  mimeType: z.string().nullable(),
});

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
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const numberedHeading = line.match(sectionHeadingPattern);
    const isPlainHeading = plainHeadingPattern.test(line) &&
      line.split(/\s+/).length <= 8 &&
      !/[.!?;:]$/.test(line) &&
      Boolean(lines[lineIndex + 1]);
    const heading = numberedHeading || (isPlainHeading ? ["", `${sections.length + 1}`, line] : null);
    if (heading) {
      if (current) sections.push({ number: current.number, title: current.title, text: current.lines.join(" ").trim() });
      current = { number: heading[1], title: heading[2], lines: [] };
    } else if (current) {
      current.lines.push(line.trim());
    }
  }
  if (current) sections.push({ number: current.number, title: current.title, text: current.lines.join(" ").trim() });
  return sections.filter((section) => section.text.length > 0);
}

function starterKit(title: string, source: string, planDays: number) {
  const topic = title.replace(/^week\s*\d+\s*[·:-]?\s*/i, "").trim() || "your lecture";
  const cleanSource = cleanDocumentText(source);
  const sections = documentSections(cleanSource);
  const facts = cleanSource.split(/[.!?]\s+/).map((line) => line.trim()).filter((line) => line.length > 12).slice(0, 8);
  const firstLine = facts[0];
  const chapters = (sections.length >= 1 ? sections.slice(0, 6).map((section) => {
    const sectionFacts = section.text.split(/[.!?]\s+/).map((line) => line.trim()).filter((line) => line.length > 12).slice(0, 3);
    return {
      id: `section-${section.number}`, title: section.title,
      summary: sectionFacts[0] || section.text,
      keyPoints: sectionFacts.length ? sectionFacts : [section.text, `This section defines and develops ${section.title}.`, `The document applies ${section.title} to the examples that follow.`],
      objective: `Explain the definitions and relationships presented in ${section.title}.`,
    };
  }) : [
    {
      id: "source", title: topic,
      summary: firstLine || `This material introduces the main terms and definitions used to explain ${topic}.`,
      keyPoints: facts.slice(0, 3).length ? facts.slice(0, 3) : [`The material defines the main terms used in ${topic}.`, "Related terms describe different parts of the subject.", "Definitions become useful when applied to an example."],
      objective: `Define the central terms used in ${topic}.`,
    },
  ]);
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
      { id: `f${index * 2 + 1}`, chapterId: chapter.id, front: chapter.title, back: chapter.summary, hint: "Recall the sentence from the source." },
      { id: `f${index * 2 + 2}`, chapterId: chapter.id, front: `${chapter.title}: key fact`, back: chapter.keyPoints[1], hint: "Use the key point from this section." },
    ]),
  };
}

function randomizeQuestionAnswers(kit: z.infer<typeof kitSchema>) {
  return {
    ...kit,
    questions: kit.questions.map((question) => {
      const correctOption = question.options[question.answer] ?? question.options[0];
      const options = [...question.options];
      for (let index = options.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
      }
      return { ...question, options, answer: Math.max(0, options.indexOf(correctOption)) };
    }),
  };
}

async function persistKit(id: string | undefined, kit: z.infer<typeof kitSchema>, req: { log: { warn: (data: unknown, message: string) => void } }) {
  if (!id) return;
  try {
    await db.insert(studyKits).values({ id, payload: kit }).onConflictDoUpdate({ target: studyKits.id, set: { payload: kit } });
  } catch (error) {
    req.log.warn({ err: error }, "study kit persistence failed");
  }
}

router.post("/generate-kit", async (req, res) => {
  const parsed = GenerateKitBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Add a title and at least one valid material." });
  const input = parsed.data;
  const source = cleanDocumentText(input.materials.map((material) => material.text).join("\n\n")).slice(0, 50000);
  try {
    const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const kit = randomizeQuestionAnswers(GenerateKitResponse.parse(starterKit(input.title, source, input.planDays)));
      await persistKit(input.id, kit, req);
      return res.json(kit);
    }
    const isOpenRouterKey = apiKey.startsWith("sk-or-");
    const openai = createOpenAI({
      baseURL: baseUrl || (isOpenRouterKey ? "https://openrouter.ai/api/v1" : undefined),
      apiKey,
    });
    const { object } = await generateObject({
      model: openai(isOpenRouterKey ? "openai/gpt-4o-mini" : "gpt-5.6-terra"),
      schema: kitSchema,
      prompt: `You are a careful college study coach and document analyst. Build a complete study kit from the supplied lecture material.

First, understand what this specific document is actually about. The overview must be a direct, concrete 2-3 sentence description of the material itself. State what the document teaches, defines, argues, or demonstrates using its actual nouns, terms, facts, examples, and relationships. For a geometry document, say things like "A line is a straight path extending in both directions" if that is what the source says. For example: "This presentation argues that Maglev trains could replace some air travel by using magnetic levitation for zero-contact travel, zero direct carbon emissions, and lower energy consumption." Do not write generic advice such as "connect each definition to an example", "the material becomes easier to remember", or "study the core ideas."

Then return 3-6 chapters with specific, source-grounded titles taken from the document itself. Use actual slide or section headings exactly when available, including short headings such as "Vocabulary", "Science", and "Environment" or numbered headings such as "1. Fundamental Definitions & Postulates"; never prepend a subject name or replace them with labels like "key definitions", "how the parts connect", or "examples and implications". Build flashcard headers/fronts and quiz questions from the content under the matching heading, and use that heading as the card's organizing label. Never display or repeat metadata headers such as "Subject:", "Level:", "Target Use:", or "Testing Tip:". Use syllabus objectives when present. Do not invent facts beyond the source. Every chapter summary, flashcard answer, flashcard question, exam prompt, answer option, and explanation must contain facts or definitions from the material. Never turn these into generic learning advice. Make the correct exam answer the source-grounded statement, not a meta-study behavior.

Title: ${input.title}\\nRequested plan length: ${input.planDays} days\\nSyllabus: ${input.syllabus || "Not provided"}\\nMaterial:\\n${source}`,
    });
    const kit = randomizeQuestionAnswers(GenerateKitResponse.parse(object));
    await persistKit(input.id, kit, req);
    return res.json(kit);
  } catch (error) {
    req.log.error({ err: error }, "study kit generation failed");
    const kit = randomizeQuestionAnswers(GenerateKitResponse.parse(starterKit(input.title, source, input.planDays)));
    await persistKit(input.id, kit, req);
    return res.json(kit);
  }
});

router.delete("/study-kits/:id", async (req, res) => {
  const id = req.params.id?.trim();
  if (!id) return res.status(400).json({ error: "A study kit id is required." });
  try {
    await db.delete(studyKits).where(eq(studyKits.id, id));
    return res.status(204).send();
  } catch (error) {
    req.log.error({ err: error, kitId: id }, "study kit deletion failed");
    return res.status(500).json({ error: "Could not delete the study kit." });
  }
});

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function youtubeTranscript(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("YouTube video could not be loaded.");
  const html = await response.text();
  const match = html.match(/"captionTracks":(\[.*?\]),"audioTracks"/s);
  if (match) {
    try {
      const tracks = JSON.parse(match[1].replace(/\\"/g, '"'));
      const track = tracks.find((item: { baseUrl?: string; languageCode?: string }) => item.languageCode?.startsWith("en")) || tracks[0];
      if (track?.baseUrl) {
        const captionResponse = await fetch(track.baseUrl);
        const xml = await captionResponse.text();
        const parts: string[] = [];
        const captionPattern = /<text[^>]*>([\s\S]*?)<\/text>/g;
        let captionMatch: RegExpExecArray | null;
        while ((captionMatch = captionPattern.exec(xml)) !== null) {
          parts.push(decodeHtml(captionMatch[1].replace(/<[^>]+>/g, " ")));
        }
        const text = parts.join(" ").replace(/\s+/g, " ").trim();
        if (text) return text;
      }
    } catch (error) {
      // A malformed or inaccessible caption track should use the audio fallback.
    }
  }
  return youtubeAudioFallback(html);
}

async function transcribeAudioBuffer(buffer: Buffer, mimeType: string) {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) throw new Error("Speech-to-text is not configured.");
  const isOpenRouterKey = apiKey.startsWith("sk-or-");
  if (isOpenRouterKey && !baseUrl) throw new Error("Speech-to-text requires an OpenAI-compatible AI connection.");
  const openai = createOpenAI({ baseURL: baseUrl || undefined, apiKey });
  const result = await experimental_transcribe({ model: openai.transcription("gpt-4o-mini-transcribe"), audio: buffer, providerOptions: { openai: { mimeType } } });
  if (!result.text?.trim()) throw new Error("No speech was detected in this media.");
  return result.text.trim();
}

async function uploadedMediaTranscript(fileData: string, _fileName: string, mimeType: string) {
  return transcribeAudioBuffer(Buffer.from(fileData, "base64"), mimeType || "application/octet-stream");
}

async function youtubeAudioFallback(html: string) {
  const match = html.match(/"adaptiveFormats":(\[.*?\])/s);
  if (!match) throw new Error("This YouTube video has no captions or downloadable audio track.");
  let formats: Array<{ mimeType?: string; url?: string; audioQuality?: string }> = [];
  try { formats = JSON.parse(match[1].replace(/\\"/g, '"')); } catch { throw new Error("YouTube audio metadata could not be read."); }
  const audio = formats.find((format) => format.mimeType?.startsWith("audio/") && format.url) || formats.find((format) => format.mimeType?.startsWith("audio/"));
  if (!audio?.url) throw new Error("This YouTube video has no captions or accessible audio track.");
  const audioResponse = await fetch(audio.url);
  if (!audioResponse.ok) throw new Error("YouTube audio could not be downloaded for transcription.");
  return transcribeAudioBuffer(Buffer.from(await audioResponse.arrayBuffer()), audio.mimeType || "audio/mp4");
}

router.post("/transcribe-video", async (req, res) => {
  const parsed = videoTranscriptBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.url && !parsed.data.fileData)) return res.status(400).json({ error: "Add a YouTube URL or upload an audio/video file." });
  try {
    const text = parsed.data.url
      ? await youtubeTranscript(parsed.data.url)
      : await uploadedMediaTranscript(parsed.data.fileData!, parsed.data.fileName || "lecture-media", parsed.data.mimeType || "application/octet-stream");
    return res.json({ text, title: parsed.data.url ? "YouTube lecture transcript" : parsed.data.fileName || "Uploaded lecture transcript" });
  } catch (error) {
    req.log.error({ err: error }, "video transcription failed");
    return res.status(500).json({ error: error instanceof Error ? error.message : "Could not transcribe this source." });
  }
});

router.post("/tutor", async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) return res.status(400).json({ error: "Ask for a different explanation." });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const context = typeof req.body?.context === "string" ? req.body.context.slice(0, 30000) : "";
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  try {
    let answer = "";
    if (apiKey) {
      const isOpenRouterKey = apiKey.startsWith("sk-or-");
      const openai = createOpenAI({ baseURL: baseUrl || (isOpenRouterKey ? "https://openrouter.ai/api/v1" : undefined), apiKey });
      const result = await generateText({
        model: openai(isOpenRouterKey ? "openai/gpt-4o-mini" : "gpt-5.6-terra"),
        prompt: `You are the tutor inside a college study app. Answer the student's question directly using only the study-kit context below. Define the relevant idea, connect it to a source-grounded example, and correct likely confusion. Do not talk about prompts, angles, studying strategies, or what the student should try. If the context lacks the answer, say so plainly.

Student question: ${prompt}

Study-kit context:
${context}`,
      });
      answer = result.text.trim();
    } else {
      answer = `The study kit does not have an AI tutor connection configured, so I cannot answer “${prompt}” from the lecture context yet.`;
    }
    res.write(`data: ${JSON.stringify({ content: answer })}\n\n`);
  } catch (error) {
    req.log.error({ err: error }, "tutor generation failed");
    res.write(`data: ${JSON.stringify({ content: "I couldn't generate an answer from this study kit right now. Please try the question again." })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  return res.end();
});

export default router;