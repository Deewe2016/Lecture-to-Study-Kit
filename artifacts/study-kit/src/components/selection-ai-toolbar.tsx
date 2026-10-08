import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Brain, Check, Loader2, MessageCircle, X } from 'lucide-react';
import { saveKit } from '@/lib/kit-store';
import { useToast } from '@/hooks/use-toast';

type SelectionPosition = {
  left: number;
  top: number;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type GeneratedFlashcard = {
  front: string;
  back: string;
};

type GeneratedQuestion = {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

const MAX_SELECTION_LENGTH = 12000;
const TOOLBAR_WIDTH = 250;

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanJsonResponse(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function normalizeFlashcards(value: unknown): GeneratedFlashcard[] {
  if (!Array.isArray(value)) throw new Error('AI did not return a flashcard array.');

  const cards = value
    .map((item) => ({
      front: String((item as any)?.front || '').trim(),
      back: String((item as any)?.back || '').trim(),
    }))
    .filter((item) => item.front && item.back)
    .slice(0, 5);

  if (cards.length !== 5) throw new Error('AI did not return 5 valid flashcards.');
  return cards;
}

function normalizeQuiz(value: unknown): GeneratedQuestion[] {
  if (!Array.isArray(value)) throw new Error('AI did not return a quiz array.');

  const questions = value
    .map((item) => ({
      prompt: String((item as any)?.prompt || '').trim(),
      options: Array.isArray((item as any)?.options)
        ? (item as any).options.map((option: unknown) => String(option).trim()).filter(Boolean).slice(0, 4)
        : [],
      answer: Number((item as any)?.answer),
      explanation: String((item as any)?.explanation || '').trim(),
    }))
    .filter((item) =>
      item.prompt &&
      item.options.length >= 2 &&
      Number.isInteger(item.answer) &&
      item.answer >= 0 &&
      item.answer < item.options.length &&
      item.explanation,
    )
    .slice(0, 5);

  if (questions.length !== 5) throw new Error('AI did not return 5 valid quiz questions.');
  return questions;
}

async function readAiResponse(response: Response) {
  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '');
    let message = details;
    try {
      const parsed = JSON.parse(details);
      message = parsed?.error || details;
    } catch {}
    throw new Error(message || `AI request failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';

  while (true) {
    const result = await reader.read();
    if (result.done) break;

    buffer += decoder.decode(result.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';

    for (const eventText of events) {
      for (const line of eventText.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (typeof parsed.content === 'string') output += parsed.content;
        } catch (error) {
          if (error instanceof Error && error.message !== 'Unexpected end of JSON input') {
            throw error;
          }
        }
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

async function askGroq(messages: ChatMessage[], selectionAITool = true) {
  const response = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      selectionAITool,
    }),
  });
  return readAiResponse(response);
}

function writeKitToLocalStorage(kit: any) {
  try {
    const raw = localStorage.getItem('lecture-study-kits');
    const current = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(current) ? current : [];
    localStorage.setItem(
      'lecture-study-kits',
      JSON.stringify([kit, ...list.filter((item: any) => item?.id !== kit.id)]),
    );
  } catch {
    localStorage.setItem('lecture-study-kits', JSON.stringify([kit]));
  }
}

function buildFlashcardKit(cards: GeneratedFlashcard[], selectedText: string) {
  const chapterId = 'selected-text';
  return {
    id: makeId('kit-flashcards'),
    title: 'AI Flashcards',
    courseLabel: 'Generated from selected text',
    overview: 'Five flashcards generated from the text you selected.',
    chapters: [{
      id: chapterId,
      title: 'Selected Text',
      summary: selectedText.slice(0, 420),
      keyPoints: [selectedText.slice(0, 300)],
      objective: 'Review the selected material with generated flashcards.',
    }],
    reviewPlan: [],
    questions: [],
    flashcards: cards.map((card, index) => ({
      id: `f${index + 1}`,
      chapterId,
      front: card.front,
      back: card.back,
      hint: null,
    })),
    materials: [{
      name: 'Selected text',
      kind: 'selection',
      text: selectedText,
    }],
    createdAt: new Date().toISOString(),
  };
}

function buildQuizKit(questions: GeneratedQuestion[], selectedText: string) {
  const chapterId = 'selected-text';
  return {
    id: makeId('kit-quiz'),
    title: 'AI Quiz',
    courseLabel: 'Generated from selected text',
    overview: 'Five multiple-choice questions generated from the text you selected.',
    chapters: [{
      id: chapterId,
      title: 'Selected Text',
      summary: selectedText.slice(0, 420),
      keyPoints: [selectedText.slice(0, 300)],
      objective: 'Practice the selected material with generated questions.',
    }],
    reviewPlan: [],
    questions: questions.map((question, index) => ({
      id: `q${index + 1}`,
      chapterId,
      prompt: question.prompt,
      options: question.options,
      answer: question.answer,
      explanation: question.explanation,
      difficulty: 'Core',
    })),
    flashcards: [],
    materials: [{
      name: 'Selected text',
      kind: 'selection',
      text: selectedText,
    }],
    createdAt: new Date().toISOString(),
  };
}

export default function SelectionAIToolbar() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef('');
  const suppressSelectionRef = useRef(false);

  const [selectedText, setSelectedText] = useState('');
  const [position, setPosition] = useState<SelectionPosition | null>(null);
  const [mode, setMode] = useState<'toolbar' | 'chat'>('toolbar');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatThinking, setChatThinking] = useState(false);

  const hide = useCallback(() => {
    setSelectedText('');
    selectionRef.current = '';
    setPosition(null);
    setMode('toolbar');
    setBusy(false);
    setQuestion('');
    setChatMessages([]);
    setChatThinking(false);
  }, []);

  const positionFromSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (!selection || selection.rangeCount === 0 || !text || selection.isCollapsed) {
      hide();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      hide();
      return;
    }

    const nextText = text.slice(0, MAX_SELECTION_LENGTH);
    selectionRef.current = nextText;
    setSelectedText(nextText);

    const preferredTop = rect.top - 54;
    const top = preferredTop >= 8 ? preferredTop : Math.min(window.innerHeight - 58, rect.bottom + 10);
    const left = Math.max(8, Math.min(window.innerWidth - TOOLBAR_WIDTH - 8, rect.left + rect.width / 2 - TOOLBAR_WIDTH / 2));
    setPosition({ left, top });
    setMode('toolbar');
  }, [hide]);

  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-selection-ai-toolbar]')) return;
      if (suppressSelectionRef.current) {
        suppressSelectionRef.current = false;
        return;
      }
      window.setTimeout(positionFromSelection, 0);
    };

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-selection-ai-toolbar]')) return;
      if (selectedText) hide();
    };

    const handleSelectionChange = () => {
      if (!window.getSelection()?.toString().trim() && selectedText) hide();
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [hide, positionFromSelection, selectedText]);

  useEffect(() => {
    const reposition = () => {
      if (!selectedText || mode !== 'toolbar') return;
      positionFromSelection();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [mode, positionFromSelection, selectedText]);

  const generateFlashcards = async () => {
    const text = selectionRef.current;
    if (!text || busy) return;

    setBusy(true);
    try {
      const raw = await askGroq([
        {
          role: 'user',
          content: `Generate 5 flashcards from this text. Return ONLY a JSON array like: [{front: string, back: string}]\n\nTEXT:\n${text}`,
        },
      ]);
      const cards = normalizeFlashcards(JSON.parse(cleanJsonResponse(raw)));
      const kit = buildFlashcardKit(cards, text);
      writeKitToLocalStorage(kit);
      await saveKit(kit);
      toast({ title: 'Flashcards saved to Files!' });
      hide();
      setLocation(`/kit/${kit.id}`);
    } catch (error) {
      toast({
        title: 'Could not generate flashcards',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setBusy(false);
    }
  };

  const generateQuiz = async () => {
    const text = selectionRef.current;
    if (!text || busy) return;

    setBusy(true);
    try {
      const raw = await askGroq([
        {
          role: 'user',
          content: `Generate 5 multiple choice questions from this text. Return ONLY a JSON array like: [{prompt: string, options: string[], answer: number, explanation: string}]\n\nTEXT:\n${text}`,
        },
      ]);
      const questions = normalizeQuiz(JSON.parse(cleanJsonResponse(raw)));
      const kit = buildQuizKit(questions, text);
      writeKitToLocalStorage(kit);
      await saveKit(kit);
      toast({ title: 'Quiz saved to Files!' });
      hide();
      setLocation(`/kit/${kit.id}`);
    } catch (error) {
      toast({
        title: 'Could not generate quiz',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setBusy(false);
    }
  };

  const openAskAi = () => {
    const text = selectionRef.current;
    if (!text || busy) return;
    setMode('chat');
    setChatMessages([]);
    setQuestion('');
  };

  const sendChatQuestion = async () => {
    const text = selectionRef.current;
    const typed = question.trim();
    if (!text || !typed || chatThinking) return;

    const nextMessages: ChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: chatMessages.length
        ? typed
        : `Selected text context:\n${text}\n\nStudent question:\n${typed}` },
    ];

    setChatMessages(nextMessages);
    setQuestion('');
    setChatThinking(true);

    try {
      const answer = await askGroq(nextMessages);
      setChatMessages((current) => [...current, { role: 'assistant', content: answer }]);
    } catch (error) {
      toast({
        title: 'AI could not answer',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setChatThinking(false);
    }
  };

  const openInAiChat = () => {
    const text = selectionRef.current;
    if (!text) return;
    sessionStorage.setItem('selection-ai-open', JSON.stringify({
      context: text,
      messages: chatMessages,
    }));
    hide();
    setLocation('/ai-chat');
  };

  if (!position || !selectedText) return null;

  const button = (label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-secondary disabled:cursor-wait disabled:opacity-50"
    >
      {label}
    </button>
  );

  return (
    <div
      ref={toolbarRef}
      data-selection-ai-toolbar
      className="fixed z-[10000] w-[250px] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {mode === 'toolbar' ? (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
            AI tools
          </div>
          {busy ? (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Generating…
            </div>
          ) : (
            <>
              {button('🧠 Generate Flashcards', generateFlashcards)}
              {button('❓ Generate Quiz', generateQuiz)}
              {button('💬 Ask AI', openAskAi)}
              {button('✕ Dismiss', hide)}
            </>
          )}
        </>
      ) : (
        <div className="w-[340px] max-w-[calc(100vw-16px)] p-2">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Brain size={16} className="text-primary" />
              Ask AI
            </div>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={hide} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Dismiss AI popup">
              <X size={15} />
            </button>
          </div>

          <div className="max-h-24 overflow-y-auto rounded-lg border border-border bg-secondary/50 p-2 text-[11px] leading-4 text-muted-foreground">
            {selectedText}
          </div>

          <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`rounded-lg p-2 text-xs leading-5 ${message.role === 'user' ? 'bg-primary/10' : 'bg-secondary'}`}>
                <span className="font-semibold">{message.role === 'user' ? 'You' : 'AI'}:</span>{' '}
                {message.content}
              </div>
            ))}
            {chatThinking && (
              <div className="flex items-center gap-2 rounded-lg bg-secondary p-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>

          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void sendChatQuestion();
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about this text…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs outline-none focus:border-primary"
              autoFocus
            />
            <button
              type="submit"
              disabled={!question.trim() || chatThinking}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="Ask AI"
            >
              <MessageCircle size={15} />
            </button>
          </form>

          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openInAiChat}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
          >
            <Check size={14} />
            Open in AI Chat
          </button>
        </div>
      )}
    </div>
  );
}
