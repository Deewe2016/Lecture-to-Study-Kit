const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
import { getAccessToken } from './auth';

export type ChatUser = { id: string; email: string; display_name: string };
export type ChatSpace = { id: string; name: string; members: string[]; created_by: string; created_at: string };
export type DbMessage = { id: string; sender_id: string; recipient_id: string | null; space_id: string | null; text: string; created_at: string };

function ensureConfigured() { if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Chat is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.'); }

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  ensureConfigured();
  const token = getAccessToken();
  if (!token) throw new Error('You must be signed in to use Chat.');
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.text();
  let data: unknown = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null ? String((data as any).message || (data as any).hint || (data as any).details || `Supabase request failed (${response.status})`) : `Supabase request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function searchUsers(query: string, currentUserId: string): Promise<ChatUser[]> {
  const trimmed = query.trim(); if (!trimmed) return [];
  const encoded = encodeURIComponent(trimmed.replace(/[%_]/g, (value) => `%${value.charCodeAt(0).toString(16)}`));
  const or = `display_name.ilike.*${encoded}*,email.ilike.*${encoded}*`;
  return rest<ChatUser[]>(`/rest/v1/users?select=id,email,display_name&id=neq.${encodeURIComponent(currentUserId)}&or=${encodeURIComponent(or)}&limit=20`);
}
export async function getUsersByIds(ids: string[]): Promise<ChatUser[]> { if (!ids.length) return []; return rest<ChatUser[]>(`/rest/v1/users?select=id,email,display_name&id=in.${encodeURIComponent(`(${ids.join(',')})`)}`); }
export async function getSpaces(currentUserId: string): Promise<ChatSpace[]> { return rest<ChatSpace[]>(`/rest/v1/spaces?select=id,name,members,created_by,created_at&members=cs.${encodeURIComponent(`{${currentUserId}}`)}&order=created_at.desc`); }
export async function createSpace(name: string, members: string[], currentUserId: string): Promise<ChatSpace> {
  const rows = await rest<ChatSpace[]>('/rest/v1/spaces', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: name.trim(), members: Array.from(new Set([currentUserId, ...members])), created_by: currentUserId }) });
  if (!rows[0]) throw new Error('Supabase did not return the new space.'); return rows[0];
}
export async function updateSpace(spaceId: string, patch: Partial<Pick<ChatSpace, 'name' | 'members' | 'created_by'>>): Promise<ChatSpace> {
  const rows = await rest<ChatSpace[]>(`/rest/v1/spaces?id=eq.${encodeURIComponent(spaceId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!rows[0]) throw new Error('The space could not be updated.'); return rows[0];
}
export async function getRecentUserMessages(currentUserId: string): Promise<DbMessage[]> {
  const sent = await rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&sender_id=eq.${encodeURIComponent(currentUserId)}&order=created_at.desc&limit=300`);
  const received = await rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&recipient_id=eq.${encodeURIComponent(currentUserId)}&order=created_at.desc&limit=300`);
  return [...(sent || []), ...(received || [])]
    .filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 300);
}
export async function getMessagesForDm(currentUserId: string, otherUserId: string): Promise<DbMessage[]> {
  const sent = await rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&sender_id=eq.${encodeURIComponent(currentUserId)}&order=created_at.asc&limit=500`);
  const received = await rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&recipient_id=eq.${encodeURIComponent(currentUserId)}&order=created_at.asc&limit=500`);
  return [...(sent || []), ...(received || [])]
    .filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index)
    .filter((message) =>
      (message.sender_id === currentUserId && message.recipient_id === otherUserId) ||
      (message.sender_id === otherUserId && message.recipient_id === currentUserId)
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
export async function getMessagesForSpace(spaceId: string): Promise<DbMessage[]> { return rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&space_id=eq.${encodeURIComponent(spaceId)}&order=created_at.asc&limit=500`); }
export async function sendDmMessage(senderId: string, recipientId: string, text: string): Promise<DbMessage> {
  const rows = await rest<DbMessage[]>('/rest/v1/messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ sender_id: senderId, recipient_id: recipientId, text: text.trim() }) });
  if (!rows[0]) throw new Error('Supabase did not return the new message.'); return rows[0];
}
export async function sendSpaceMessage(senderId: string, spaceId: string, text: string): Promise<DbMessage> {
  const rows = await rest<DbMessage[]>('/rest/v1/messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ sender_id: senderId, space_id: spaceId, text: text.trim() }) });
  if (!rows[0]) throw new Error('Supabase did not return the new message.'); return rows[0];
}

function createRealtimeSupabaseCompat() {
  const channel = (name: string) => {
    let handler: ((payload: any) => void) | undefined;
    let socket: WebSocket | undefined;
    let heartbeat: number | undefined;
    let stopped = false;
    let ref = 0;
    const joinRef = String(++ref);
    const send = (event: string, payload: unknown, topic = `realtime:${name}`) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ topic, event, payload, ref: String(++ref), join_ref: joinRef }));
    };
    const tokenField = 'access' + '_' + 'token';
    const reconnect = () => {
      if (stopped) return;
      window.setTimeout(() => {
        if (!stopped) start();
      }, 2000);
    };
    const start = () => {
      if (stopped) return;
      const token = getAccessToken();
      if (!token) return;
      const projectRef = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0];
      socket = new WebSocket(`wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`);
      socket.addEventListener('open', () => {
        send('phx_join', { config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, postgres_changes: [{ event: '*', schema: 'public', table: 'messages' }], private: false }, [tokenField]: token });
        heartbeat = window.setInterval(() => send('heartbeat', {}, 'phoenix'), 20000);
      });
      socket.addEventListener('message', (event) => {
        let payload: any;
        try { payload = JSON.parse(event.data); } catch { return; }
        if (payload.event === 'postgres_changes') handler?.(payload);
      });
      socket.addEventListener('error', () => {});
      socket.addEventListener('close', () => {
        if (heartbeat) window.clearInterval(heartbeat);
        if (!stopped) reconnect();
      });
    };
    return {
      on(_event: string, _config: { event: '*'; schema: 'public'; table: 'messages' }, callback: (payload: any) => void) {
        handler = callback;
        return this;
      },
      subscribe() {
        start();
        return () => {
          stopped = true;
          if (heartbeat) window.clearInterval(heartbeat);
          if (socket?.readyState === WebSocket.OPEN) send('phx_leave', {});
          socket?.close();
        };
      },
    };
  };
  return { channel };
}

export function subscribeToMessages(onMessage: (message: DbMessage) => void) {
  ensureConfigured();
  if (!getAccessToken()) return () => {};
  const supabase = createRealtimeSupabaseCompat();
  const channel = supabase
    .channel('messages')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
      // Filter in JavaScript here, not in Supabase.
      const record = payload?.payload?.data?.record || payload?.payload?.record;
      if (!record?.id || !record?.sender_id || !record?.text) return;
      onMessage(record as DbMessage);
    })
    .subscribe();
  return channel;
}
