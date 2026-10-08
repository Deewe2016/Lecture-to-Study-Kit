import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { saveKit } from '@/lib/kit-store';
import { useToast } from '@/hooks/use-toast';

type Flashcard = { front: string; back: string };
type QuizQuestion = { prompt: string; options: string[]; answer: number; explanation: string };

const clean = (s: string) => {
  const m = s.trim().match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  return (m ? m[1] : s).trim();
};

async function readStream(response: Response) {
  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '');
    let message = details;
    try { message = JSON.parse(details)?.error || details; } catch {}
    throw new Error(message || `AI request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(parsed.error);
        if (typeof parsed.content === 'string') output += parsed.content;
      }
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const parsed = JSON.parse(data);
      if (parsed.error) throw new Error(parsed.error);
      if (typeof parsed.content === 'string') output += parsed.content;
    }
  }
  if (!output.trim()) throw new Error('AI returned an empty response.');
  return output.trim();
}

async function askGroq(prompt: string, selectedText: string) {
  const response = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: `${prompt}\n\nSelected text:\n${selectedText.slice(0, 12000)}` }],
    }),
  });
  return readStream(response);
}

function storeKit(kit: any) {
  const raw = localStorage.getItem('lecture-study-kits');
  const current = raw ? JSON.parse(raw) : [];
  const list = Array.isArray(current) ? current : [];
  localStorage.setItem('lecture-study-kits', JSON.stringify([kit, ...list.filter((item: any) => item?.id !== kit.id)]));
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function flashcardKit(cards: Flashcard[], text: string) {
  const chapterId = 'selected-text';
  return {
    id: id('kit-flashcards'),
    title: 'AI Flashcards',
    courseLabel: 'Generated from selected text',
    overview: 'Five flashcards generated from selected text.',
    chapters: [{ id: chapterId, title: 'Selected Text', summary: text.slice(0, 420), keyPoints: [text.slice(0, 300)], objective: 'Review the selected material with generated flashcards.' }],
    reviewPlan: [],
    questions: [],
    flashcards: cards.map((c, i) => ({ id: `f${i + 1}`, chapterId, front: c.front, back: c.back, hint: null })),
    materials: [{ name: 'Selected text', kind: 'selection', text }],
    createdAt: new Date().toISOString(),
  };
}

function quizKit(questions: QuizQuestion[], text: string) {
  const chapterId = 'selected-text';
  return {
    id: id('kit-quiz'),
    title: 'AI Quiz',
    courseLabel: 'Generated from selected text',
    overview: 'Five multiple-choice questions generated from selected text.',
    chapters: [{ id: chapterId, title: 'Selected Text', summary: text.slice(0, 420), keyPoints: [text.slice(0, 300)], objective: 'Practice the selected material with generated questions.' }],
    reviewPlan: [],
    questions: questions.map((q, i) => ({ id: `q${i + 1}`, chapterId, ...q, difficulty: 'Core' })),
    flashcards: [],
    materials: [{ name: 'Selected text', kind: 'selection', text }],
    createdAt: new Date().toISOString(),
  };
}

export default function SelectionAIToolbar() {
  const { toast } = useToast();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef('');
  const [text, setText] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const hide = useCallback(() => {
    selectionRef.current = '';
    setText('');
    setPosition(null);
    setOpen(false);
    setBusy(false);
  }, []);

  const detectSelection = useCallback(() => {
    const selection = window.getSelection();
    const value = selection?.toString().trim() || '';
    if (!selection || selection.isCollapsed || !value || !selection.rangeCount) {
      hide();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const selected = value.slice(0, 12000);
    selectionRef.current = selected;
    setText(selected);
    setPosition({
      left: Math.max(8, Math.min(window.innerWidth - 80, rect.left + rect.width / 2 - 36)),
      top: rect.top >= 58 ? rect.top - 48 : Math.min(window.innerHeight - 50, rect.bottom + 8),
    });
  }, [hide]);

  useEffect(() => {
    const mouseup = () => window.setTimeout(detectSelection, 0);
    const mousedown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-selection-ai-toolbar]')) hide();
    };
    const selectionchange = () => {
      if (!window.getSelection()?.toString().trim()) hide();
    };
    document.addEventListener('mouseup', mouseup);
    document.addEventListener('mousedown', mousedown);
    document.addEventListener('selectionchange', selectionchange);
    return () => {
      document.removeEventListener('mouseup', mouseup);
      document.removeEventListener('mousedown', mousedown);
      document.removeEventListener('selectionchange', selectionchange);
    };
  }, [detectSelection, hide]);

  const generateFlashcards = async () => {
    if (!selectionRef.current || busy) return;
    setBusy(true);
    try {
      const raw = await askGroq('Generate 5 flashcards from this text. Return ONLY a JSON array like: [{front: string, back: string}]. No other text.', selectionRef.current);
      const value = JSON.parse(clean(raw));
      if (!Array.isArray(value) || value.length !== 5) throw new Error('AI did not return 5 flashcards.');
      const cards = value.map((x: any) => ({ front: String(x?.front || '').trim(), back: String(x?.back || '').trim() }));
      if (cards.some((x: Flashcard) => !x.front || !x.back)) throw new Error('AI returned an invalid flashcard.');
      const kit = flashcardKit(cards, selectionRef.current);
      storeKit(kit);
      await saveKit(kit);
      toast({ title: 'Flashcards saved to Files!' });
      hide();
    } catch (error) {
      toast({ title: 'Could not generate flashcards', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
      setBusy(false);
    }
  };

  const generateQuiz = async () => {
    if (!selectionRef.current || busy) return;
    setBusy(true);
    try {
      const raw = await askGroq('Generate 5 multiple choice questions from this text. Return ONLY a JSON array like: [{prompt: string, options: string[], answer: number, explanation: string}]. No other text.', selectionRef.current);
      const value = JSON.parse(clean(raw));
      if (!Array.isArray(value) || value.length !== 5) throw new Error('AI did not return 5 quiz questions.');
      const questions = value.map((x: any) => ({
        prompt: String(x?.prompt || '').trim(),
        options: Array.isArray(x?.options) ? x.options.map((o: unknown) => String(o).trim()).filter(Boolean) : [],
        answer: Number(x?.answer),
        explanation: String(x?.explanation || '').trim(),
      }));
      if (questions.some((q: QuizQuestion) => !q.prompt || q.options.length < 2 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length || !q.explanation)) {
        throw new Error('AI returned an invalid quiz question.');
      }
      const kit = quizKit(questions, selectionRef.current);
      storeKit(kit);
      await saveKit(kit);
      toast({ title: 'Quiz saved to Files!' });
      hide();
    } catch (error) {
      toast({ title: 'Could not generate quiz', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
      setBusy(false);
    }
  };

  if (!position || !text) return null;

  return (
    <div ref={toolbarRef} data-selection-ai-toolbar className="fixed z-[10000]" style={position} onMouseDown={(e) => e.stopPropagation()}>
      {!open ? (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-lg hover:bg-secondary">
          <Sparkles size={14} />
          AI
        </button>
      ) : (
        <div className="mt-1 w-[220px] rounded-lg bg-card border border-border p-1.5 text-foreground shadow-2xl">
          {busy ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />Generating…</div>
          ) : (
            <>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void generateFlashcards()} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs hover:bg-secondary">🧠 Generate Flashcards</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void generateQuiz()} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs hover:bg-secondary">❓ Generate Quiz</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
