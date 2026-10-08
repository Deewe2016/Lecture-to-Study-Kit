import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { saveKit } from '@/lib/kit-store';
import { useToast } from '@/hooks/use-toast';

type Flashcard = { front: string; back: string };
type QuizQuestion = { prompt: string; options: string[]; answer: number; explanation: string };
type ChatMessage = { role: 'user' | 'assistant'; content: string };

const FLASHCARD_PROMPT =
  'Generate ONLY flashcards from this text. Return a study kit JSON with only the flashcards array filled in. Leave chapters, questions, and reviewPlan as empty arrays.';
const QUIZ_PROMPT =
  'Generate ONLY multiple choice quiz questions from this text. Return a study kit JSON with only the questions array filled in. Leave chapters, flashcards, and reviewPlan as empty arrays.';

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

async function askGroq(messages: Array<{ role: string; content: string }>) {
  const response = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
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

function flashcardKit(cards: Flashcard[]) {
  return {
    id: id('kit-flashcards'),
    title: 'AI Flashcards',
    courseLabel: 'Generated from selected text',
    overview: '',
    chapters: [],
    reviewPlan: [],
    questions: [],
    flashcards: cards.map((c, i) => ({ id: `f${i + 1}`, chapterId: '', front: c.front, back: c.back, hint: null })),
    materials: [],
    createdAt: new Date().toISOString(),
  };
}

function quizKit(questions: QuizQuestion[]) {
  return {
    id: id('kit-quiz'),
    title: 'AI Quiz',
    courseLabel: 'Generated from selected text',
    overview: '',
    chapters: [],
    reviewPlan: [],
    questions: questions.map((q, i) => ({ id: `q${i + 1}`, chapterId: '', ...q, difficulty: 'Core' })),
    flashcards: [],
    materials: [],
    createdAt: new Date().toISOString(),
  };
}

function parseStudyKit(raw: string) {
  const value = JSON.parse(clean(raw));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI did not return a study kit JSON object.');
  return value as Record<string, unknown>;
}

export default function SelectionAIToolbar() {
  const { toast } = useToast();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const selectionRef = useRef('');
  const [text, setText] = useState('');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);

  const hide = useCallback(() => {
    selectionRef.current = '';
    setText('');
    setPosition(null);
    setOpen(false);
    setBusy(false);
    setChatOpen(false);
    setChatInput('');
    setChatMessages([]);
    setChatBusy(false);
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
      if (toolbarRef.current?.contains(document.activeElement)) return;
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

  useEffect(() => {
    if (chatOpen) requestAnimationFrame(() => chatInputRef.current?.focus());
  }, [chatOpen]);

  const generateFlashcards = async () => {
    if (!selectionRef.current || busy) return;
    setBusy(true);
    try {
      const selected = selectionRef.current;
      const raw = await askGroq([
        { role: 'system', content: 'You generate study kit JSON.' },
        { role: 'user', content: `${FLASHCARD_PROMPT}\n\nSelected text:\n${selected}` },
      ]);
      const value = parseStudyKit(raw);
      const cardsValue = value.flashcards;
      if (!Array.isArray(cardsValue) || cardsValue.length !== 5) throw new Error('AI did not return 5 flashcards.');
      const cards = cardsValue.map((x: any) => ({ front: String(x?.front || '').trim(), back: String(x?.back || '').trim() }));
      if (cards.some((x: Flashcard) => !x.front || !x.back)) throw new Error('AI returned an invalid flashcard.');
      const kit = flashcardKit(cards);
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
      const selected = selectionRef.current;
      const raw = await askGroq([
        { role: 'system', content: 'You generate study kit JSON.' },
        { role: 'user', content: `${QUIZ_PROMPT}\n\nSelected text:\n${selected}` },
      ]);
      const value = parseStudyKit(raw);
      const questionsValue = value.questions;
      if (!Array.isArray(questionsValue) || questionsValue.length !== 5) throw new Error('AI did not return 5 quiz questions.');
      const questions = questionsValue.map((x: any) => ({
        prompt: String(x?.prompt || '').trim(),
        options: Array.isArray(x?.options) ? x.options.map((o: unknown) => String(o).trim()).filter(Boolean) : [],
        answer: Number(x?.answer),
        explanation: String(x?.explanation || '').trim(),
      }));
      if (questions.some((q: QuizQuestion) => !q.prompt || q.options.length < 2 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length || !q.explanation)) {
        throw new Error('AI returned an invalid quiz question.');
      }
      const kit = quizKit(questions);
      storeKit(kit);
      await saveKit(kit);
      toast({ title: 'Quiz saved to Files!' });
      hide();
    } catch (error) {
      toast({ title: 'Could not generate quiz', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
      setBusy(false);
    }
  };

  const askAI = async () => {
    const question = chatInput.trim();
    const selected = selectionRef.current;
    if (!question || !selected || chatBusy) return;

    const history = [...chatMessages, { role: 'user' as const, content: question }];
    setChatMessages(history);
    setChatInput('');
    setChatBusy(true);

    try {
      const answer = await askGroq([
        { role: 'system', content: `The user has selected this text: ${selected}` },
        ...history,
      ]);
      setChatMessages(current => [...current, { role: 'assistant', content: answer }]);
    } catch (error) {
      setChatMessages(current => [...current, {
        role: 'assistant',
        content: `Sorry, I couldn't answer that: ${error instanceof Error ? error.message : 'Please try again.'}`,
      }]);
    } finally {
      setChatBusy(false);
    }
  };

  const diveDeeper = () => {
    const selected = selectionRef.current;
    if (!selected) return;
    const messages = [
      { role: 'user', content: `Selected text context:\n${selected}` },
      ...chatMessages,
    ];
    sessionStorage.setItem('selection-ai-open', JSON.stringify({ context: selected, messages }));
    window.location.assign('/ai-chat');
  };

  if (!position || !text) return null;

  const contextPreview = text.length > 50 ? `${text.slice(0, 50)}…` : text;

  return (
    <div ref={toolbarRef} data-selection-ai-toolbar className="fixed z-[10000]" style={position} onMouseDown={(e) => e.stopPropagation()}>
      {!open && !chatOpen ? (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-lg hover:bg-secondary">
          <Sparkles size={14} />
          AI
        </button>
      ) : chatOpen ? (
        <div className="absolute left-[calc(100%+8px)] top-0 flex h-[330px] w-[330px] flex-col rounded-lg border border-border bg-card p-3 text-foreground shadow-2xl">
          <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Selected text</p>
              <p className="mt-1 line-clamp-2 text-xs" title={text}>{contextPreview}</p>
            </div>
            <button type="button" onClick={() => setChatOpen(false)} className="shrink-0 rounded-md p-1 hover:bg-secondary" aria-label="Close Ask AI">
              <X size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-2">
            {!chatMessages.length && <p className="py-5 text-center text-xs text-muted-foreground">Ask a question about the selected text.</p>}
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`rounded-md px-2.5 py-2 text-xs ${message.role === 'user' ? 'bg-secondary' : 'bg-background/60'}`}>
                <span className="font-semibold">{message.role === 'user' ? 'You' : 'AI'}:</span>{' '}
                <span className="whitespace-pre-wrap">{message.content}</span>
              </div>
            ))}
            {chatBusy && <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Thinking…</div>}
          </div>
          <div className="border-t border-border pt-2">
            <div className="flex gap-2">
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void askAI(); } }}
                placeholder="Ask about this text…"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-xs outline-none"
              />
              <button type="button" disabled={chatBusy || !chatInput.trim()} onClick={() => void askAI()} className="rounded-md bg-primary px-2.5 text-primary-foreground disabled:opacity-50" aria-label="Send question">
                <Send size={14} />
              </button>
            </div>
            <button type="button" onClick={diveDeeper} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-secondary">
              Dive Deeper
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 w-[220px] rounded-lg border border-border bg-card p-1.5 text-foreground shadow-2xl">
          {busy ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />Generating…</div>
          ) : (
            <>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void generateFlashcards()} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs hover:bg-secondary">🧠 Generate Flashcards</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void generateQuiz()} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs hover:bg-secondary">❓ Generate Quiz</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); setChatOpen(true); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs hover:bg-secondary">💬 Ask AI</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
