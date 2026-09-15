import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, Plus, Send, Sparkles, User } from 'lucide-react';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

const STORAGE_KEY = 'lecture-study-ai-chat';

function makeId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readMessages(): Message[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (message): message is Message =>
        message?.role === 'user' || message?.role === 'assistant',
    ).map((message) => ({
      id: String(message.id || makeId()),
      role: message.role,
      content: String(message.content || ''),
    })).filter((message) => message.content.trim());
  } catch {
    return [];
  }
}

export default function AIChatPage() {
  const [messages, setMessages] = useState<Message[]>(readMessages);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const newConversation = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
    setError('');
    setThinking(false);
    localStorage.removeItem(STORAGE_KEY);
    textareaRef.current?.focus();
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || thinking) return;

    const userMessage: Message = { id: makeId(), role: 'user', content };
    const history = [...messages, userMessage];
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '' };

    setMessages([...history, assistantMessage]);
    setInput('');
    setError('');
    setThinking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content: text }) => ({ role, content: text })),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const details = await response.text().catch(() => '');
        throw new Error(details || `AI Chat request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneReading = false;

      while (!doneReading) {
        const result = await reader.read();
        doneReading = result.done;
        if (result.value) buffer += decoder.decode(result.value, { stream: !result.done });

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
              const delta = typeof parsed.content === 'string' ? parsed.content : '';
              if (delta) {
                setMessages((current) => current.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, content: message.content + delta }
                    : message,
                ));
              }
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message !== 'Unexpected end of JSON input') {
                throw parseError;
              }
            }
          }
        }
      }
    } catch (requestError) {
      if (controller.signal.aborted) return;
      const message = requestError instanceof Error ? requestError.message : 'AI Chat is unavailable.';
      setError(message);
      setMessages((current) => current.filter((item) => item.id !== assistantMessage.id));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setThinking(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100dvh-72px)] min-h-0 flex-col">
      <div className="flex items-center justify-between px-5 py-4 sm:px-8">
        <button
          onClick={newConversation}
          className="focus-ring inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-secondary/80"
          data-testid="button-new-ai-conversation"
        >
          <Plus size={16} />
          <span>New conversation</span>
        </button>

        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="label-powered-by-groq">
          <Sparkles size={14} />
          <span>Powered by Groq</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-8">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-end gap-5 py-6">
          {messages.length === 0 && !thinking && (
            <div className="m-auto flex max-w-lg flex-col items-center text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary text-primary">
                <Sparkles size={25} />
              </div>
              <h1 className="font-serif text-3xl tracking-[-.03em] text-foreground">AI Chat</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Ask anything and get a response from your AI study assistant.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`flex items-end gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'assistant' && (
                <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-primary sm:flex">
                  <Bot size={15} />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                  message.role === 'user'
                    ? 'rounded-br-md bg-primary text-primary-foreground'
                    : 'rounded-bl-md border border-border bg-card text-card-foreground'
                }`}
              >
                {message.content || (thinking && message.role === 'assistant' ? (
                  <span className="inline-flex items-center gap-1.5 py-1" aria-label="AI is thinking">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                  </span>
                ) : null)}
              </div>
              {message.role === 'user' && (
                <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground sm:flex">
                  <User size={15} />
                </div>
              )}
            </div>
          ))}

          {thinking && messages.length > 0 && messages[messages.length - 1]?.content && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-8 w-8 shrink-0 rounded-full border border-border bg-secondary" />
              <span>Thinking…</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border/70 bg-background/95 px-4 py-4 backdrop-blur sm:px-8">
        <form onSubmit={(event) => void sendMessage(event)} className="mx-auto flex w-full max-w-5xl items-end gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message AI Chat…"
            rows={1}
            disabled={thinking}
            className="focus-ring min-h-12 max-h-36 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
            data-testid="input-ai-chat"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Send message"
            data-testid="button-send-ai-chat"
          >
            <Send size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
