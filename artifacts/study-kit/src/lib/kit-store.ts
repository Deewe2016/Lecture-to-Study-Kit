export type StoredMaterial = { name: string; kind: string; text: string; size?: string };
export type StoredKit = {
  id: string;
  title: string;
  courseLabel: string;
  overview: string;
  chapters: Array<{ id: string; title: string; summary: string; keyPoints: string[]; objective: string | null }>;
  reviewPlan: Array<{ day: number; label: string; focus: string; tasks: string[]; minutes: number }>;
  questions: Array<{ id: string; chapterId: string; prompt: string; options: string[]; answer: number; explanation: string; difficulty: string }>;
  flashcards: Array<{ id: string; chapterId: string; front: string; back: string; hint: string | null }>;
  materials: StoredMaterial[];
  createdAt: string;
};
export type StoredProgress = { id: string; reviewed: string[]; completedTasks: string[]; answers: Record<string, number>; lastOpened?: string };

const DB_NAME = 'lecture-study-kit';
const VERSION = 1;
const DELETED_KEY = 'lecture-study-deleted-kits';
const LOCAL_KITS_KEY = 'lecture-study-kits';
const LOCAL_PROGRESS_PREFIX = 'lecture-study-progress-';

function deletedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || '[]')); } catch { return new Set(); }
}

function markDeleted(id: string) {
  const ids = deletedIds();
  ids.add(id);
  localStorage.setItem(DELETED_KEY, JSON.stringify([...ids]));
}

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
  const request = indexedDB.open(DB_NAME, VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('kits')) db.createObjectStore('kits', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function write(storeName: 'kits' | 'progress', value: StoredKit | StoredProgress) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function readAll<T>(storeName: 'kits' | 'progress'): Promise<T[]> {
  const db = await open();
  const values = await new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values;
}

function normalizeKit(kit: StoredKit): StoredKit {
  return {
    ...kit,
    overview: typeof kit.overview === 'string' ? kit.overview : '',
    chapters: Array.isArray(kit.chapters) ? kit.chapters : [],
    reviewPlan: Array.isArray(kit.reviewPlan) ? kit.reviewPlan : [],
    questions: Array.isArray(kit.questions) ? kit.questions : [],
    flashcards: Array.isArray(kit.flashcards) ? kit.flashcards : [],
    materials: Array.isArray(kit.materials) ? kit.materials : [],
  };
}

export async function saveKit(kit: StoredKit) {
  // A deleted kit must never be recreated by background synchronization.
  if (deletedIds().has(kit.id)) return;
  try { await write('kits', normalizeKit(kit)); } catch { /* localStorage remains the primary UI fallback */ }
}

export async function deleteKit(id: string) {
  // Make the tombstone first so concurrent save effects cannot resurrect the kit.
  markDeleted(id);

  // Remove the browser-local source used by App.tsx immediately. This is
  // important because App.tsx initializes its library from localStorage before
  // IndexedDB finishes loading.
  try {
    const raw = localStorage.getItem(LOCAL_KITS_KEY);
    if (raw) {
      const kits = JSON.parse(raw) as Array<{ id: string }>;
      localStorage.setItem(LOCAL_KITS_KEY, JSON.stringify(kits.filter((kit) => kit.id !== id)));
    }
    localStorage.removeItem(`${LOCAL_PROGRESS_PREFIX}${id}`);
  } catch { /* continue with IndexedDB cleanup */ }

  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(['kits', 'progress'], 'readwrite');
      request.objectStore('kits').delete(id);
      request.objectStore('progress').delete(id);
      request.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
      request.onabort = () => reject(request.error || new Error('Delete transaction aborted'));
    });
    db.close();
  } catch {
    // The tombstone plus localStorage removal still prevents the deleted kit
    // from returning if IndexedDB is unavailable or its delete transaction fails.
  }
}

export async function saveProgress(progress: StoredProgress) {
  if (deletedIds().has(progress.id)) return;
  try { await write('progress', progress); } catch { /* browser fallback remains available */ }
}

export async function loadKits() {
  try {
    const deleted = deletedIds();
    const kits = await readAll<StoredKit>('kits');
    return kits.filter((kit) => !deleted.has(kit.id)).map(normalizeKit);
  } catch { return []; }
}

export async function loadProgress(id: string) {
  if (deletedIds().has(id)) return null;
  try { return (await readAll<StoredProgress>('progress')).find((item) => item.id === id) ?? null; } catch { return null; }
}