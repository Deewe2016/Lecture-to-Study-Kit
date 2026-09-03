const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SESSION_KEY = 'flexus-auth-session';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

type AuthSession = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: { full_name?: string };
  };
};

function ensureConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Authentication is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.');
  }
}

function toUser(user: AuthSession['user']): AuthUser {
  return {
    id: user.id,
    email: user.email || '',
    name: user.user_metadata?.full_name?.trim() || user.email?.split('@')[0] || 'Student',
  };
}

function saveSession(session: AuthSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return toUser(session.user);
}

function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  ensureConfigured();
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || 'Authentication request failed.';
    throw new Error(message);
  }
  return data as T;
}

async function refreshSession(session: AuthSession): Promise<AuthUser | null> {
  if (!session.refresh_token) return null;
  try {
    const next = await request<AuthSession>('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    return saveSession(next);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export async function signUp(name: string, email: string, password: string): Promise<AuthUser | null> {
  const session = await request<AuthSession>('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, data: { full_name: name } }),
  });

  if (!session.access_token) return null;
  return saveSession(session);
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const session = await request<AuthSession>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return saveSession(session);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = readSession();
  if (!session) return null;

  try {
    const user = await request<AuthSession['user']>('/auth/v1/user', {}, session.access_token);
    const nextUser = toUser(user);
    const current = readSession();
    if (current) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...current, user }));
    return nextUser;
  } catch {
    return refreshSession(session);
  }
}

export async function signOut() {
  const session = readSession();
  if (session?.access_token) {
    try {
      await request('/auth/v1/logout', { method: 'POST' }, session.access_token);
    } catch {
      // Clear the local session even if the remote logout request fails.
    }
  }
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredUser(): AuthUser | null {
  const session = readSession();
  return session ? toUser(session.user) : null;
}
