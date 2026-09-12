import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  MessageCircle,
  Plus,
  Send,
  Users,
  X,
} from 'lucide-react';

type ChatMessage = {
  id: string;
  sender: string;
  text: string;
  createdAt: string;
};

type ChatConversation = {
  id: string;
  kind: 'dm' | 'space';
  name: string;
  messages: ChatMessage[];
};

const STORAGE_KEY = 'lecture-study-chat';

const starterConversations: ChatConversation[] = [];

function readConversations(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return starterConversations;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : starterConversations;
  } catch {
    return starterConversations;
  }
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractTutorText(raw: string) {
  const chunks: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(payload) as { content?: string; text?: string };
      if (parsed.content) chunks.push(parsed.content);
      else if (parsed.text) chunks.push(parsed.text);
    } catch {
      // Some responses may not be JSON SSE; ignore those lines.
    }
  }

  return chunks.join('') || raw.trim();
}

function parseSuggestions(raw: string): string[] {
  const text = extractTutorText(raw).trim();

  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        const suggestions = parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 3);
        if (suggestions.length === 3) return suggestions;
      }
    } catch {
      // Try extracting the first JSON array from a streamed response.
    }
  }

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        const suggestions = parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 3);
        if (suggestions.length === 3) return suggestions;
      }
    } catch {
      // Fall through to safe generic suggestions.
    }
  }

  return [];
}

async function getSuggestions(messages: ChatMessage[]): Promise<string[]> {
  if (messages.length === 0) return [];

  const context = messages.slice(-5).map((message) => ({
    sender: message.sender,
    text: message.text,
  }));

  const prompt = [
    'You are generating reply suggestions for a study workspace chat.',
    'Use the last five messages as context.',
    'Return exactly 3 short, natural reply suggestions as a JSON array of strings.',
    'Do not include markdown, explanations, numbering, or any text outside the JSON array.',
    'Each suggestion should be concise enough to send as a chat message.',
    '',
    JSON.stringify(context),
  ].join('\n');

  const response = await fetch('/api/tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      context: JSON.stringify(context),
    }),
  });

  if (!response.ok) {
    throw new Error(`Tutor returned HTTP ${response.status}`);
  }

  const raw = await response.text();
  return parseSuggestions(raw);
}

function NewConversationDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (kind: 'dm' | 'space', name: string) => void;
}) {
  const [kind, setKind] = useState<'dm' | 'space'>('dm');
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(kind, trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-5 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">
              New conversation
            </p>
            <h2 className="mt-2 font-serif text-2xl tracking-[-.03em]">
              Start a chat
            </h2>
          </div>
          <button
            onClick={onClose}
            className="focus-ring rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close dialog"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            onClick={() => setKind('dm')}
            className={`rounded-lg border px-3 py-2.5 text-xs font-semibold ${
              kind === 'dm'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
          >
            Direct message
          </button>
          <button
            onClick={() => setKind('space')}
            className={`rounded-lg border px-3 py-2.5 text-xs font-semibold ${
              kind === 'space'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
          >
            Space
          </button>
        </div>

        <label className="mt-5 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
            {kind === 'dm' ? 'Person' : 'Space name'}
          </span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            placeholder={kind === 'dm' ? 'e.g. Alex' : 'e.g. Science Study Group'}
            className="focus-ring h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
          />
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="focus-ring rounded-lg border border-border px-4 py-2.5 text-xs font-semibold hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="focus-ring rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>(readConversations);
  const [selectedId, setSelectedId] = useState<string | null>(() => readConversations()[0]?.id || null);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    setSuggestions([]);
    setSuggestionError(false);
  }, [selectedId]);

  const loadSuggestions = async (messages: ChatMessage[]) => {
    if (messages.length === 0) {
      setSuggestions([]);
      return;
    }

    setLoadingSuggestions(true);
    setSuggestionError(false);
    try {
      const next = await getSuggestions(messages);
      setSuggestions(next);
      setSuggestionError(next.length !== 3);
    } catch {
      setSuggestions([]);
      setSuggestionError(true);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const createConversation = (kind: 'dm' | 'space', name: string) => {
    const conversation: ChatConversation = {
      id: makeId(kind),
      kind,
      name,
      messages: [],
    };
    setConversations((previous) => [...previous, conversation]);
    setSelectedId(conversation.id);
    setShowNew(false);
    setSuggestions([]);
  };

  const send = async () => {
    if (!selected || !input.trim()) return;

    const message: ChatMessage = {
      id: makeId('message'),
      sender: 'You',
      text: input.trim(),
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...selected.messages, message];
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === selected.id
          ? { ...conversation, messages: nextMessages }
          : conversation,
      ),
    );
    setInput('');
    await loadSuggestions(nextMessages);
  };

  const deleteConversation = (id: string) => {
    setConversations((previous) => previous.filter((conversation) => conversation.id !== id));
    if (selectedId === id) {
      const next = conversations.find((conversation) => conversation.id !== id);
      setSelectedId(next?.id || null);
    }
  };

  return (
    <section className="h-[calc(100dvh-72px)] min-h-[520px] overflow-hidden">
      <div className="flex h-full border-b border-border">
        <aside className="flex w-[290px] shrink-0 flex-col border-r border-border bg-sidebar/70">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">
                Messages
              </p>
              <h1 className="mt-1 font-serif text-2xl tracking-[-.03em]">Chat</h1>
            </div>
            <button
              onClick={() => setShowNew(true)}
              className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground hover:border-primary/60 hover:text-primary"
              aria-label="New direct message or space"
              title="New conversation"
              data-testid="button-new-chat"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
              Direct messages
            </div>
            <div className="space-y-1">
              {conversations.filter((conversation) => conversation.kind === 'dm').map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={selectedId === conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  onDelete={() => deleteConversation(conversation.id)}
                />
              ))}
              {conversations.filter((conversation) => conversation.kind === 'dm').length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No direct messages yet.</p>
              )}
            </div>

            <div className="mt-7 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">
              Spaces
            </div>
            <div className="space-y-1">
              {conversations.filter((conversation) => conversation.kind === 'space').map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={selectedId === conversation.id}
                  onClick={() => setSelectedId(conversation.id)}
                  onDelete={() => deleteConversation(conversation.id)}
                />
              ))}
              {conversations.filter((conversation) => conversation.kind === 'space').length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No spaces yet.</p>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {selected ? (
            <>
              <header className="flex items-center gap-3 border-b border-border px-6 py-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {selected.kind === 'space' ? <Users size={17} /> : <MessageCircle size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{selected.name}</h2>
                  <p className="text-[10px] text-muted-foreground">
                    {selected.kind === 'space' ? 'Space' : 'Direct message'}
                  </p>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
                {selected.messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center">
                    <div className="max-w-sm">
                      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
                        <MessageCircle size={21} />
                      </span>
                      <h3 className="mt-5 font-serif text-2xl tracking-[-.03em]">Start the conversation</h3>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        Send a message below. AI reply suggestions will appear after there are messages to use as context.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-4">
                    {selected.messages.map((message) => (
                      <div key={message.id} className={`flex ${message.sender === 'You' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl border px-4 py-3 text-sm leading-6 ${message.sender === 'You' ? 'border-primary/30 bg-primary/[.10]' : 'border-border bg-card'}`}>
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                            {message.sender}
                          </div>
                          {message.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border px-6 pb-5 pt-4">
                <div className="mx-auto max-w-3xl">
                  <div className="mb-3 min-h-8">
                    {loadingSuggestions ? (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                        Generating reply suggestions…
                      </div>
                    ) : suggestions.length === 3 ? (
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => setInput(suggestion)}
                            className="focus-ring rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                            data-testid="button-chat-suggestion"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    ) : suggestionError ? (
                      <span className="text-[11px] text-muted-foreground">
                        Reply suggestions are unavailable right now.
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-2 shadow-sm">
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      placeholder="Write a message…"
                      rows={2}
                      className="focus-ring min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
                      data-testid="input-chat-message"
                    />
                    <button
                      onClick={() => void send()}
                      disabled={!input.trim()}
                      className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                      aria-label="Send message"
                      data-testid="button-send-chat"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Enter to send · Shift+Enter for a new line
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div className="max-w-sm">
                <MessageCircle size={28} className="mx-auto text-primary" />
                <h2 className="mt-5 font-serif text-3xl tracking-[-.03em]">Your conversations</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Create a direct message or a space with the + button to start chatting.
                </p>
                <button
                  onClick={() => setShowNew(true)}
                  className="focus-ring mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
                >
                  <Plus size={14} />
                  New conversation
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {showNew && (
        <NewConversationDialog onClose={() => setShowNew(false)} onCreate={createConversation} />
      )}
    </section>
  );
}

function ConversationRow({
  conversation,
  selected,
  onClick,
  onDelete,
}: {
  conversation: ChatConversation;
  selected: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const lastMessage = conversation.messages.at(-1)?.text;

  return (
    <div className={`group flex items-center rounded-lg transition-colors ${selected ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60'}`}>
      <button
        onClick={onClick}
        className="focus-ring flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          {conversation.kind === 'space' ? <Users size={15} /> : <MessageCircle size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{conversation.name}</span>
          {lastMessage && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{lastMessage}</span>}
        </span>
        <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="mr-2 hidden rounded p-1 text-muted-foreground hover:text-foreground group-hover:block"
        aria-label={`Delete ${conversation.name}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
