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

export async function saveKit(kit: StoredKit) { try { await write('kits', kit); } catch { /* browser fallback remains available */ } }
export async function deleteKit(id: string) {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(['kits', 'progress'], 'readwrite');
      request.objectStore('kits').delete(id);
      request.objectStore('progress').delete(id);
      request.oncomplete = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch { /* localStorage cleanup remains available */ }
}
export async function saveProgress(progress: StoredProgress) { try { await write('progress', progress); } catch { /* browser fallback remains available */ } }
export async function loadKits() { try { return await readAll<StoredKit>('kits'); } catch { return []; } }
export async function loadProgress(id: string) {
  try { return (await readAll<StoredProgress>('progress')).find((item) => item.id === id) ?? null; } catch { return null; }
}