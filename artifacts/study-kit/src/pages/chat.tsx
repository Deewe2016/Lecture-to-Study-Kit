import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageCircle, Plus, Search, Send, Users, X } from 'lucide-react';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import {
  createSpace,
  getMessagesForDm,
  getMessagesForSpace,
  getRecentUserMessages,
  getSpaces,
  getUsersByIds,
  searchUsers,
  sendDmMessage,
  sendSpaceMessage,
  subscribeToMessages,
  type ChatSpace,
  type ChatUser,
  type DbMessage,
} from '@/lib/chat-api';

type UiMessage = { id: string; senderId: string; sender: string; text: string; createdAt: string };
type DmConversation = { id: string; kind: 'dm'; name: string; userId: string; messages: UiMessage[] };
type SpaceConversation = { id: string; kind: 'space'; name: string; spaceId: string; members: string[]; messages: UiMessage[] };
type ChatConversation = DmConversation | SpaceConversation;

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
    } catch { /* ignore non-JSON SSE lines */ }
  }
  return chunks.join('') || raw.trim();
}

function parseSuggestions(raw: string): string[] {
  const text = extractTutorText(raw).trim();
  const candidates = [text, text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        const suggestions = parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 3);
        if (suggestions.length === 3) return suggestions;
      }
    } catch { /* try another representation */ }
  }
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 3);
    } catch { /* fall through */ }
  }
  return [];
}

async function getSuggestions(messages: UiMessage[]) {
  if (!messages.length) return [];
  const context = messages.slice(-5).map((message) => ({ sender: message.sender, text: message.text }));
  const prompt = [
    'You are generating reply suggestions for a study workspace chat.',
    'Use the last five real messages as context.',
    'Return exactly 3 short, natural reply suggestions as a JSON array of strings.',
    'Do not include markdown, explanations, numbering, or text outside the JSON array.',
    'Each suggestion should be concise enough to send as a chat message.',
    '', JSON.stringify(context),
  ].join('\n');
  const response = await fetch('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, context: JSON.stringify(context) }) });
  if (!response.ok) throw new Error(`Tutor returned HTTP ${response.status}`);
  return parseSuggestions(await response.text());
}

function toUiMessages(messages: DbMessage[], users: Record<string, ChatUser>, currentUser: AuthUser): UiMessage[] {
  return messages.map((message) => ({
    id: message.id,
    senderId: message.sender_id,
    sender: message.sender_id === currentUser.id ? currentUser.name : users[message.sender_id]?.display_name || 'Flexus user',
    text: message.text,
    createdAt: message.created_at,
  }));
}

function ConversationRow({ conversation, selected, onClick }: { conversation: ChatConversation; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${selected ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground'}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">{conversation.kind === 'space' ? <Users size={15} /> : <MessageCircle size={15} />}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{conversation.name}</span>
    </button>
  );
}

function UserSearchResults({ results, onSelect }: { results: ChatUser[]; onSelect: (user: ChatUser) => void }) {
  if (!results.length) return null;
  return (
    <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      {results.map((user) => (
        <button key={user.id} onClick={() => onSelect(user)} className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left last:border-0 hover:bg-secondary">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{user.display_name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{user.display_name}</span><span className="block truncate text-[11px] text-muted-foreground">{user.email}</span></span>
        </button>
      ))}
    </div>
  );
}

function NewSpaceDialog({ currentUserId, onClose, onCreated }: { currentUserId: string; onClose: () => void; onCreated: (space: ChatSpace) => void }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatUser[]>([]);
  const [members, setMembers] = useState<ChatUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      try {
        const next = await searchUsers(query, currentUserId);
        if (!cancelled) setResults(next);
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not search users.'); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, currentUserId]);

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true); setError('');
    try { onCreated(await createSpace(name, members.map((member) => member.id), currentUserId)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create the space.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">New space</p><h2 className="mt-2 font-serif text-2xl tracking-[-.03em]">Create a group chat</h2></div><button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close"><X size={17} /></button></div>
        <label className="mt-6 block"><span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Space name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Science Study Group" className="focus-ring h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none" /></label>
        <label className="mt-5 block"><span className="mb-2 block text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Add members</span><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" className="focus-ring h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none" />{results.length > 0 && <div className="absolute left-0 right-0 top-11 z-10 overflow-hidden rounded-lg border border-border bg-card shadow-xl">{results.map((user) => <button key={user.id} onClick={() => { setMembers((previous) => previous.some((item) => item.id === user.id) ? previous : [...previous, user]); setQuery(''); setResults([]); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{user.display_name.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{user.display_name}</span><span className="block truncate text-[10px] text-muted-foreground">{user.email}</span></span></button>)}</div>}</div></label>
        <div className="mt-3 flex flex-wrap gap-2">{members.map((member) => <button key={member.id} onClick={() => setMembers((previous) => previous.filter((item) => item.id !== member.id))} className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary">{member.display_name} ×</button>)}{members.length === 0 && <p className="text-xs text-muted-foreground">You are automatically included.</p>}</div>
        {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold hover:bg-secondary">Cancel</button><button onClick={submit} disabled={!name.trim() || saving} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}Create space</button></div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ChatUser[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING');
  const [showSpace, setShowSpace] = useState(false);
  const [users, setUsers] = useState<Record<string, ChatUser>>({});

  const selected = useMemo(() => conversations.find((conversation) => conversation.id === selectedId) || null, [conversations, selectedId]);

  const refreshConversations = async (user: AuthUser) => {
    const [recentMessages, spaces] = await Promise.all([getRecentUserMessages(user.id), getSpaces(user.id)]);
    const partnerIds = Array.from(new Set(recentMessages.map((message) => message.sender_id === user.id ? message.recipient_id : message.sender_id).filter((id): id is string => Boolean(id))));
    const partnerUsers = await getUsersByIds(partnerIds);
    const userMap: Record<string, ChatUser> = {};
    partnerUsers.forEach((item) => { userMap[item.id] = item; });
    setUsers((previous) => ({ ...previous, ...userMap }));
    const dms: DmConversation[] = partnerUsers.map((partner) => ({ id: `dm:${partner.id}`, kind: 'dm', name: partner.display_name, userId: partner.id, messages: [] }));
    const spaceChats: SpaceConversation[] = spaces.map((space) => ({ id: `space:${space.id}`, kind: 'space', name: space.name, spaceId: space.id, members: space.members, messages: [] }));
    setConversations((previous) => {
      const oldMessages = new Map(previous.map((conversation) => [conversation.id, conversation.messages]));
      return [...dms, ...spaceChats].map((conversation) => ({ ...conversation, messages: oldMessages.get(conversation.id) || [] }));
    });
  };

  const loadSuggestions = async (messages: UiMessage[]) => {
    if (!messages.length) { setSuggestions([]); return; }
    setLoadingSuggestions(true); setSuggestionError(false);
    try { const next = await getSuggestions(messages); setSuggestions(next); setSuggestionError(next.length !== 3); }
    catch { setSuggestions([]); setSuggestionError(true); }
    finally { setLoadingSuggestions(false); }
  };

  const loadConversationMessages = async (conversation: ChatConversation, user: AuthUser) => {
    setLoadingMessages(true); setError('');
    try {
      const messages = conversation.kind === 'dm' ? await getMessagesForDm(user.id, conversation.userId) : await getMessagesForSpace(conversation.spaceId);
      const senderIds = Array.from(new Set(messages.map((message) => message.sender_id).filter((id) => id !== user.id)));
      const senderUsers = await getUsersByIds(senderIds);
      const senderMap = { ...users } as Record<string, ChatUser>;
      senderUsers.forEach((item) => { senderMap[item.id] = item; });
      setUsers(senderMap);
      const uiMessages = toUiMessages(messages, senderMap, user);
      setConversations((previous) => previous.map((item) => item.id === conversation.id ? { ...item, messages: uiMessages } : item));
      await loadSuggestions(uiMessages);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load messages.'); }
    finally { setLoadingMessages(false); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) { if (!cancelled) setError('You must be signed in to use Chat.'); return; }
        if (cancelled) return;
        setCurrentUser(user);
        await refreshConversations(user);
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Chat.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const stop = subscribeToMessages((message) => {
      const partnerId = message.sender_id === currentUser.id ? message.recipient_id : message.sender_id;
      const matching = conversations.find((conversation) => conversation.kind === 'space' ? conversation.spaceId === message.space_id : Boolean(partnerId) && conversation.userId === partnerId);
      if (!matching) { refreshConversations(currentUser).catch(() => undefined); return; }
      const senderName = message.sender_id === currentUser.id ? currentUser.name : users[message.sender_id]?.display_name || 'Flexus user';
      const uiMessage: UiMessage = { id: message.id, senderId: message.sender_id, sender: senderName, text: message.text, createdAt: message.created_at };
      setConversations((previous) => previous.map((conversation) => conversation.id === matching.id && !conversation.messages.some((item) => item.id === message.id) ? { ...conversation, messages: [...conversation.messages, uiMessage] } : conversation));
      if (selectedId === matching.id) {
        const nextMessages = [...(matching.messages || []), uiMessage].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
        loadSuggestions(nextMessages).catch(() => undefined);
      }
    }, setRealtimeStatus);
    return stop;
  }, [currentUser, selectedId, conversations, users]);

  useEffect(() => {
    if (!currentUser || !search.trim()) { setSearchResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try { const results = await searchUsers(search, currentUser.id); if (!cancelled) setSearchResults(results); }
      catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not search users.'); }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search, currentUser]);

  useEffect(() => {
    if (!currentUser || !selected) return;
    loadConversationMessages(selected, currentUser).catch(() => undefined);
  }, [selectedId]);

  const startDm = (user: ChatUser) => {
    setUsers((previous) => ({ ...previous, [user.id]: user }));
    const existing = conversations.find((conversation) => conversation.kind === 'dm' && conversation.userId === user.id);
    if (existing) setSelectedId(existing.id);
    else {
      const conversation: DmConversation = { id: `dm:${user.id}`, kind: 'dm', name: user.display_name, userId: user.id, messages: [] };
      setConversations((previous) => [conversation, ...previous]);
      setSelectedId(conversation.id);
    }
    setSearch(''); setSearchResults([]);
  };

  const handleSpaceCreated = (space: ChatSpace) => {
    const conversation: SpaceConversation = { id: `space:${space.id}`, kind: 'space', name: space.name, spaceId: space.id, members: space.members, messages: [] };
    setConversations((previous) => [conversation, ...previous]); setSelectedId(conversation.id); setShowSpace(false);
  };

  const send = async () => {
    if (!currentUser || !selected || !input.trim()) return;
    const text = input.trim(); setInput(''); setError('');
    try { if (selected.kind === 'dm') await sendDmMessage(currentUser.id, selected.userId, text); else await sendSpaceMessage(currentUser.id, selected.spaceId, text); }
    catch (err) { setInput(text); setError(err instanceof Error ? err.message : 'Could not send message.'); }
  };

  if (loading) return <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" size={22} /></div>;

  return (
    <section className="h-[calc(100dvh-72px)] min-h-[520px] overflow-hidden">
      <div className="flex h-full border-b border-border">
        <aside className="relative flex w-[310px] shrink-0 flex-col border-r border-border bg-sidebar/70">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Messages</p><h1 className="mt-1 font-serif text-2xl tracking-[-.03em]">Chat</h1></div><button onClick={() => setShowSpace(true)} className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground hover:border-primary/60 hover:text-primary" aria-label="Create a space"><Plus size={16} /></button></div>
          <div className="border-b border-border px-3 py-3"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a Flexus user..." className="focus-ring h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none" /><UserSearchResults results={searchResults} onSelect={startDm} /></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Direct messages</div>
            <div className="space-y-1">{conversations.filter((conversation) => conversation.kind === 'dm').map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={selectedId === conversation.id} onClick={() => setSelectedId(conversation.id)} />)}{conversations.filter((conversation) => conversation.kind === 'dm').length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Search for someone to start a DM.</p>}</div>
            <div className="mt-7 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Spaces</div>
            <div className="space-y-1">{conversations.filter((conversation) => conversation.kind === 'space').map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={selectedId === conversation.id} onClick={() => setSelectedId(conversation.id)} />)}{conversations.filter((conversation) => conversation.kind === 'space').length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No spaces yet.</p>}</div>
          </div>
          <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">Realtime: <span className={realtimeStatus === 'SUBSCRIBED' ? 'text-primary' : 'text-muted-foreground'}>{realtimeStatus.toLowerCase()}</span></div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {selected ? <>
            <header className="flex items-center gap-3 border-b border-border px-6 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">{selected.kind === 'space' ? <Users size={17} /> : <MessageCircle size={17} />}</span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{selected.name}</h2><p className="text-[10px] text-muted-foreground">{selected.kind === 'space' ? `${selected.members.length} members` : 'Direct message'}</p></div></header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {loadingMessages ? <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div> : selected.messages.length === 0 ? <div className="flex h-full items-center justify-center text-center"><div className="max-w-sm"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><MessageCircle size={21} /></span><h3 className="mt-5 font-serif text-2xl tracking-[-.03em]">Start the conversation</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">Messages are stored in Supabase and delivered through Realtime.</p></div></div> : <div className="mx-auto max-w-3xl space-y-4">{selected.messages.map((message) => <div key={message.id} className={`flex ${message.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] rounded-2xl border px-4 py-3 text-sm leading-6 ${message.senderId === currentUser?.id ? 'border-primary/30 bg-primary/[.10]' : 'border-border bg-card'}`}><div className="mb-1 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{message.sender}</div>{message.text}</div></div>)}</div>}
            </div>
            <div className="border-t border-border px-6 pb-5 pt-4"><div className="mx-auto max-w-3xl"><div className="mb-3 min-h-8">{loadingSuggestions ? <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Generating reply suggestions...</div> : suggestions.length === 3 ? <div className="flex flex-wrap gap-2">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => setInput(suggestion)} className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary">{suggestion}</button>)}</div> : suggestionError ? <span className="text-[11px] text-muted-foreground">AI suggestions are temporarily unavailable.</span> : null}</div>{error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}<div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} placeholder="Write a message..." className="focus-ring min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm outline-none" /><button onClick={send} disabled={!input.trim()} className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40" aria-label="Send message"><Send size={16} /></button></div><p className="mt-2 text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p></div></div>
          </> : <div className="flex h-full items-center justify-center text-center"><div className="max-w-sm"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><MessageCircle size={21} /></span><h2 className="mt-5 font-serif text-2xl tracking-[-.03em]">Your Flexus chats</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Search for a real Flexus user or create a space to start messaging.</p></div></div>}
        </main>
      </div>
      {showSpace && currentUser && <NewSpaceDialog currentUserId={currentUser.id} onClose={() => setShowSpace(false)} onCreated={handleSpaceCreated} />}
    </section>
  );
}
