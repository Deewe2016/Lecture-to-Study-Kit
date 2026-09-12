const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
import { getAccessToken } from './auth';

export type ChatUser = {
  id: string;
  email: string;
  display_name: string;
};

export type ChatSpace = {
  id: string;
  name: string;
  members: string[];
  created_by: string;
  created_at: string;
};

export type DbMessage = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  space_id: string | null;
  text: string;
  created_at: string;
};

function ensureConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Chat is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.');
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  ensureConfigured();
  const token = getAccessToken();
  if (!token) throw new Error('You must be signed in to use Chat.');

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const body = await response.text();
  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null
      ? String((data as { message?: string; hint?: string; details?: string }).message || (data as { hint?: string }).hint || (data as { details?: string }).details || `Supabase request failed (${response.status})`)
      : `Supabase request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

export async function searchUsers(query: string, currentUserId: string): Promise<ChatUser[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const encoded = encodeURIComponent(trimmed.replace(/[%_]/g, (value) => `%${value.charCodeAt(0).toString(16)}`));
  const or = `display_name.ilike.*${encoded}*,email.ilike.*${encoded}*`;
  return rest<ChatUser[]>(`/rest/v1/users?select=id,email,display_name&id=neq.${encodeURIComponent(currentUserId)}&or=${encodeURIComponent(or)}&limit=20`);
}

export async function getUsersByIds(ids: string[]): Promise<ChatUser[]> {
  if (ids.length === 0) return [];
  const inList = `(${ids.join(',')})`;
  return rest<ChatUser[]>(`/rest/v1/users?select=id,email,display_name&id=in.${encodeURIComponent(inList)}`);
}

export async function getSpaces(currentUserId: string): Promise<ChatSpace[]> {
  const members = encodeURIComponent(`{${currentUserId}}`);
  return rest<ChatSpace[]>(`/rest/v1/spaces?select=id,name,members,created_by,created_at&members=cs.${members}&order=created_at.desc`);
}

export async function createSpace(name: string, members: string[], currentUserId: string): Promise<ChatSpace> {
  const uniqueMembers = Array.from(new Set([currentUserId, ...members]));
  const rows = await rest<ChatSpace[]>('/rest/v1/spaces', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: name.trim(), members: uniqueMembers, created_by: currentUserId }),
  });
  if (!rows[0]) throw new Error('Supabase did not return the new space.');
  return rows[0];
}

export async function getRecentUserMessages(currentUserId: string): Promise<DbMessage[]> {
  const or = `and(sender_id.eq.${currentUserId},recipient_id.not.is.null),and(recipient_id.eq.${currentUserId},sender_id.not.is.null)`;
  return rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&or=${encodeURIComponent(or)}&order=created_at.desc&limit=300`);
}

export async function getMessagesForDm(currentUserId: string, otherUserId: string): Promise<DbMessage[]> {
  const or = `and(sender_id.eq.${currentUserId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${currentUserId})`;
  return rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&or=${encodeURIComponent(or)}&order=created_at.asc&limit=500`);
}

export async function getMessagesForSpace(spaceId: string): Promise<DbMessage[]> {
  return rest<DbMessage[]>(`/rest/v1/messages?select=id,sender_id,recipient_id,space_id,text,created_at&space_id=eq.${encodeURIComponent(spaceId)}&order=created_at.asc&limit=500`);
}

export async function sendDmMessage(senderId: string, recipientId: string, text: string): Promise<DbMessage> {
  const rows = await rest<DbMessage[]>('/rest/v1/messages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ sender_id: senderId, recipient_id: recipientId, text: text.trim() }),
  });
  if (!rows[0]) throw new Error('Supabase did not return the new message.');
  return rows[0];
}

export async function sendSpaceMessage(senderId: string, spaceId: string, text: string): Promise<DbMessage> {
  const rows = await rest<DbMessage[]>('/rest/v1/messages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ sender_id: senderId, space_id: spaceId, text: text.trim() }),
  });
  if (!rows[0]) throw new Error('Supabase did not return the new message.');
  return rows[0];
}

export function subscribeToMessages(onMessage: (message: DbMessage) => void, onStatus?: (status: string) => void) {
  ensureConfigured();
  const token = getAccessToken();
  if (!token) throw new Error('You must be signed in to use Chat.');

  const projectRef = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0];
  const url = `wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
  const socket = new WebSocket(url);
  let ref = 0;
  const joinRef = String(++ref);
  let heartbeat: number | undefined;
  let reconnectTimer: number | undefined;
  let stopped = false;
  let joined = false;
  let reconnectAttempt = 0;

  const send = (event: string, payload: unknown, topic = 'realtime:chat') => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const currentRef = String(++ref);
    socket.send(JSON.stringify({ topic, event, payload, ref: currentRef, join_ref: joinRef }));
  };

  const connectChannel = () => {
    send('phx_join', {
      config: {
        broadcast: { ack: false, self: false },
        presence: { enabled: false },
        postgres_changes: [
          { event: 'INSERT', schema: 'public', table: 'messages' },
        ],
        private: false,
      },
      access_token: getAccessToken() || token,
    });
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = [1000, 2000, 5000, 10000][Math.min(reconnectAttempt, 3)];
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      if (!stopped) window.location.reload();
    }, delay);
  };

  socket.addEventListener('open', () => {
    reconnectAttempt = 0;
    joined = false;
    onStatus?.('CONNECTING');
    connectChannel();
    heartbeat = window.setInterval(() => send('heartbeat', {}, 'phoenix'), 20000);
  });

  socket.addEventListener('message', (event) => {
    let payload: any;
    try { payload = JSON.parse(event.data); } catch { return; }

    if (payload.event === 'phx_reply' && payload.topic === 'realtime:chat' && payload.payload?.status === 'ok') {
      joined = true;
      onStatus?.('SUBSCRIBED');
    } else if (payload.event === 'postgres_changes') {
      const record = payload.payload?.data?.record || payload.payload?.record;
      if (record?.id && record?.sender_id && record?.text) onMessage(record as DbMessage);
    } else if (payload.event === 'phx_error' || payload.event === 'phx_close') {
      joined = false;
      onStatus?.('RECONNECTING');
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', () => {
    joined = false;
    onStatus?.('ERROR');
    scheduleReconnect();
  });

  socket.addEventListener('close', () => {
    joined = false;
    if (heartbeat) window.clearInterval(heartbeat);
    if (!stopped) {
      onStatus?.('RECONNECTING');
      scheduleReconnect();
    }
  });

  const refreshTimer = window.setInterval(() => {
    const nextToken = getAccessToken();
    if (joined && nextToken) send('access_token', { access_token: nextToken });
  }, 60000);

  return () => {
    stopped = true;
    if (heartbeat) window.clearInterval(heartbeat);
    window.clearInterval(refreshTimer);
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (socket.readyState === WebSocket.OPEN) send('phx_leave', {});
    socket.close();
  };
}
