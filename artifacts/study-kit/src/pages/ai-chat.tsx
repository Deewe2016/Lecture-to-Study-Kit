import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, Plus, Send, Sparkles, Trash2, User } from 'lucide-react';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type Conversation = {
  id: string;
  messages: Message[];
  createdAt: number;
};

const STORAGE_KEY = 'lecture-study-ai-conversations';
const LEGACY_STORAGE_KEY = 'lecture-study-ai-chat';

function makeId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (message): message is Message =>
      message?.role === 'user' || message?.role === 'assistant',
  ).map((message) => ({
    id: String(message.id || makeId()),
    role: message.role,
    content: String(message.content || ''),
  })).filter((message) => message.content.trim());
}

function readConversations(): Conversation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.map((conversation) => ({
          id: String(conversation.id || makeId()),
          messages: normalizeMessages(conversation.messages),
          createdAt: Number(conversation.createdAt) || Date.now(),
        })).filter((conversation) => conversation.messages.length > 0);
      }
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const messages = normalizeMessages(JSON.parse(legacy));
      if (messages.length) {
        return [{ id: makeId(), messages, createdAt: Date.now() }];
      }
    }
  } catch {
    // Ignore malformed local storage and start clean.
  }
  return [];
}

function conversationTitle(conversation: Conversation) {
  const firstUserMessage = conversation.messages.find((message) => message.role === 'user');
  const text = firstUserMessage?.content.trim() || 'New conversation';
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

function renderInlineMarkdown(text: string) {
  const tokens = text.split(/(\*\*[^*]+\*\*|(?<!\*)\*[^*]+\*(?!\*))/g);
  return tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    return <span key={index}>{token}</span>;
  });
}

function isTableSeparator(line: string) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderMarkdown(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (line.includes('|') && nextLine && isTableSeparator(nextLine)) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      blocks.push(
        <div key={`table-${index}`} className="my-3 w-full overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-secondary/80">
                {headers.map((header, cellIndex) => (
                  <th key={cellIndex} className="border-b border-r border-border px-3 py-2.5 font-semibold text-foreground last:border-r-0">
                    {renderInlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-card' : 'bg-secondary/35'}>
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex} className="border-b border-r border-border px-3 py-2.5 align-top text-card-foreground last:border-r-0 last:border-b-0">
                      {renderInlineMarkdown(row[cellIndex] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (!line.trim()) {
      blocks.push(<div key={`space-${index}`} className="h-2" />);
      index += 1;
      continue;
    }

    blocks.push(
      <div key={`line-${index}`}>
        {renderInlineMarkdown(line)}
      </div>,
    );
    index += 1;
  }

  return <>{blocks}</>;
}

export default function AIChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [selectedId, setSelectedId] = useState<string | null>(() => readConversations()[0]?.id || null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;
  const messages = selected?.messages || [];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [conversations]);

  useEffect(() => {
    if (!selectedId && conversations.length) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const pending = localStorage.getItem('dive-deeper-message');
    if (!pending) return;
    localStorage.removeItem('dive-deeper-message');
    const newConversation = { id: makeId(), messages: [], createdAt: Date.now() };
    setConversations(prev => [newConversation, ...prev]);
    setSelectedId(newConversation.id);
    setTimeout(() => sendMessage(undefined, pending), 300);
  }, []);

  const newConversation = () => {
    abortRef.current?.abort();
    const conversation: Conversation = { id: makeId(), messages: [], createdAt: Date.now() };
    setConversations((current) => [conversation, ...current]);
    setSelectedId(conversation.id);
    setInput('');
    setError('');
    setThinking(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const deleteConversation = (id: string) => {
    if (id === selectedId) abortRef.current?.abort();
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (id === selectedId) {
      const remaining = conversations.filter((conversation) => conversation.id !== id);
      setSelectedId(remaining[0]?.id || null);
      setInput('');
      setError('');
      setThinking(false);
    }
  };

  const selectConversation = (id: string) => {
    if (id === selectedId) return;
    abortRef.current?.abort();
    setSelectedId(id);
    setInput('');
    setError('');
    setThinking(false);
  };

  const updateMessages = (conversationId: string, updater: (current: Message[]) => Message[]) => {
    setConversations((current) => current.map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, messages: updater(conversation.messages) }
        : conversation,
    ));
  };

  const sendMessage = async (event?: FormEvent, overrideContent?: string) => {
    event?.preventDefault();
    const content = overrideContent ?? input.trim();
    if (!content || thinking) return;

    let conversationId = selectedId;
    if (!conversationId) {
      const conversation: Conversation = { id: makeId(), messages: [], createdAt: Date.now() };
      conversationId = conversation.id;
      setConversations((current) => [conversation, ...current]);
      setSelectedId(conversation.id);
    }

    const currentConversation = conversations.find((conversation) => conversation.id === conversationId);
    const history = [...(currentConversation?.messages || []), { id: makeId(), role: 'user' as const, content }];
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '' };

    updateMessages(conversationId, () => [...history, assistantMessage]);
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
          messages: history.slice(-20).map(({ role, content: text }) => ({ role, content: text })),
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
                updateMessages(conversationId!, (current) => current.map((message) =>
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
      updateMessages(conversationId!, (current) => current.filter((item) => item.id !== assistantMessage.id));
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
    <div className="flex h-[calc(100dvh-72px)] min-h-0">
      <aside className="hidden w-[270px] shrink-0 flex-col border-r border-border/70 bg-sidebar/40 lg:flex">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
          <span className="text-sm font-medium text-foreground">AI conversations</span>
          <button
            onClick={newConversation}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground hover:text-foreground"
            title="New conversation"
            aria-label="New conversation"
            data-testid="button-new-ai-conversation-sidebar"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">No conversations yet.</div>
          ) : conversations.map((conversation) => (
            <div key={conversation.id} className={`group mb-1 flex items-center gap-1 rounded-lg ${conversation.id === selectedId ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}>
              <button
                onClick={() => selectConversation(conversation.id)}
                className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground"
                data-testid={`button-ai-conversation-${conversation.id}`}
              >
                <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{conversationTitle(conversation)}</span>
              </button>
              <button
                onClick={() => deleteConversation(conversation.id)}
                className="focus-ring mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                title="Delete conversation"
                aria-label={`Delete ${conversationTitle(conversation)}`}
                data-testid={`button-delete-ai-conversation-${conversation.id}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
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
                  {message.content ? renderMarkdown(message.content) : (thinking && message.role === 'assistant' ? (
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
    </div>
  );
}
