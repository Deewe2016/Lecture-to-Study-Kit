import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronRight, Download, File, FileArchive, FileAudio, FileImage, FileText,
  FileVideo, Folder, FolderOpen, Grid2X2, List, MoreHorizontal, Pencil, Pin, Move,
  Plus, Search, Share2, Trash2, UploadCloud, X, ZoomIn, ZoomOut, BookOpen, FilePlus2, ChevronDown
} from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

type FolderRow = { id: string; name: string; parent_folder_id: string | null; owner_id: string; created_at: string };
type FileRow = { id: string; name: string; folder_id: string | null; owner_id: string; storage_path: string; size: number; type: string; created_at: string };
type ShareRow = { id: string; file_id: string | null; folder_id: string | null; shared_with_user_id: string; shared_by_user_id: string; created_at: string };
type DocumentRow = { id: string; title: string; content: any; owner_id: string; folder_id: string | null; created_at: string; updated_at: string };
type DocumentShareRow = { id: string; document_id: string; shared_with_user_id: string; shared_by_user_id: string; created_at: string };
type WhiteboardRow = { id: string; title: string; content: any; owner_id: string; folder_id: string | null; created_at: string; updated_at: string };
type WhiteboardShareRow = { id: string; whiteboard_id: string; shared_with_user_id: string; shared_by_user_id: string; created_at: string };
type UserRow = { id: string; email: string; display_name: string };

const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const KIT_STORAGE = 'lecture-study-kits';
const AUTH_RETRY_DELAY_MS = 1000;
const AUTH_RETRY_ATTEMPTS = 3;
const AUTH_RETRY_MESSAGE = 'Having trouble connecting — your files are safe. Refreshing...';

type LocalKit = {
  id: string;
  title: string;
  courseLabel?: string;
  chapters?: unknown[];
  flashcards?: unknown[];
  createdAt?: string;
};

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function readLocalKits(): LocalKit[] {
  try {
    const raw = localStorage.getItem(KIT_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((kit) => kit?.id && kit?.title) : [];
  } catch {
    return [];
  }
}

function isStudyKitsFolder(folder: FolderRow, rootId?: string) {
  return folder.name === 'Study Kits' && folder.parent_folder_id === rootId;
}

function isJwtError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /jwt|token|issued at future|not valid yet|unauthori[sz]ed|401|clock skew/i.test(message);
}

async function waitForJwtClockSkew(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.iat !== 'number') return;
    const futureBy = payload.iat * 1000 - Date.now();
    if (futureBy > 0 && futureBy <= 60_000) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(AUTH_RETRY_DELAY_MS, futureBy)));
    }
  } catch {}
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!url || !anon) throw new Error('Files storage is not configured.');
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < AUTH_RETRY_ATTEMPTS; attempt += 1) {
    const token = getAccessToken();
    if (!token) throw new Error('You must be signed in to use Files.');

    try {
      await waitForJwtClockSkew(token);
      const response = await fetch(`${url}${path}`, {
        ...init,
        headers: {
          apikey: anon,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      const body = await response.text();
      let data: unknown = null;
      try { data = body ? JSON.parse(body) : null; } catch { data = body; }

      if (!response.ok) {
        const message = typeof data === 'object' && data
          ? String((data as any).message || (data as any).details || (data as any).hint || `Request failed (${response.status})`)
          : `Request failed (${response.status})`;
        const error = new Error(message);
        if (!isJwtError(error) || attempt === AUTH_RETRY_ATTEMPTS - 1) throw error;
        lastError = error;
      } else {
        return data as T;
      }
    } catch (error) {
      if (!isJwtError(error) || attempt === AUTH_RETRY_ATTEMPTS - 1) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await new Promise<void>((resolve) => window.setTimeout(resolve, AUTH_RETRY_DELAY_MS));
  }

  throw lastError || new Error('Supabase request failed.');
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function iconFor(type: string, name = '') {
  const t = type.toLowerCase();
  if (t.includes('pdf') || /\\.pdf$/i.test(name)) return FileText;
  if (t.startsWith('image/')) return FileImage;
  if (t.startsWith('video/')) return FileVideo;
  if (t.startsWith('audio/')) return FileAudio;
  if (t.includes('zip') || t.includes('archive') || /\\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive;
  if (t.includes('word') || t.includes('text') || /\\.(doc|docx|txt|md)$/i.test(name)) return FileText;
  return File;
}
function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}


function PdfPreview({ src, name }: { src: string; name: string }) {
  const [canvases, setCanvases] = useState<HTMLCanvasElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const pdf = await pdfjsLib.getDocument(src).promise;
        const rendered: HTMLCanvasElement[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not create a PDF canvas.');
          await page.render({ canvasContext: context, viewport }).promise;
          rendered.push(canvas);
        }
        if (!cancelled) setCanvases(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not render this PDF.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  if (loading) return <div className="flex min-h-[70vh] items-center justify-center text-sm text-muted-foreground">Rendering PDF…</div>;
  if (error) return <div className="flex min-h-[70vh] items-center justify-center text-sm text-red-200">{error}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-card px-4 py-2">
        <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} className="rounded-md p-2 hover:bg-secondary" aria-label="Zoom out"><ZoomOut size={16}/></button>
        <span className="w-14 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))} className="rounded-md p-2 hover:bg-secondary" aria-label="Zoom in"><ZoomIn size={16}/></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-900 p-5">
        <div className="mx-auto flex w-fit flex-col gap-5" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
          {canvases.map((canvas, index) => (
            <div key={index} className="bg-white shadow-2xl">
              <canvas
                aria-label={`${name} page ${index + 1}`}
                width={canvas.width}
                height={canvas.height}
                ref={(node) => {
                  if (!node) return;
                  const context = node.getContext('2d');
                  if (context) context.drawImage(canvas, 0, 0);
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileViewer({ file, src, onClose }: { file: FileRow; src: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const isPdf = file.type.includes('pdf') || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  return (
    <div className="fixed inset-0 z-[9999] flex h-[100dvh] w-[100vw] flex-col bg-background text-foreground">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-[10px] text-muted-foreground">{formatBytes(Number(file.size))}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-2.5 hover:bg-secondary" aria-label="Close full screen viewer"><X size={20}/></button>
      </div>
      <div className="min-h-0 flex-1">
        {isPdf ? <PdfPreview src={src} name={file.name} /> : isImage ? (
          <div className="relative flex h-full items-center justify-center overflow-auto bg-zinc-950 p-6">
            <div className="absolute right-5 top-5 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-black/60 p-1">
              <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.2))} className="rounded-md p-2 text-white hover:bg-white/10" aria-label="Zoom out"><ZoomOut size={17}/></button>
              <span className="w-12 text-center text-xs text-white">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(5, z + 0.2))} className="rounded-md p-2 text-white hover:bg-white/10" aria-label="Zoom in"><ZoomIn size={17}/></button>
            </div>
            <img src={src} alt={file.name} className="max-h-full max-w-full object-contain" style={{ transform: `scale(${zoom})` }} />
          </div>
        ) : isVideo ? (
          <div className="flex h-full items-center justify-center bg-black p-5">
            <video src={src} controls playsInline className="max-h-full max-w-full" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center">
              <File size={40} className="mx-auto text-primary"/>
              <h2 className="mt-4 font-serif text-2xl">Preview unavailable</h2>
              <p className="mt-2 text-sm text-muted-foreground">This file type cannot be previewed in Flexus.</p>
              <a href={src} download={file.name} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Download size={15}/> Download file</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FilesPage() {
  const me = getStoredUser();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentShares, setDocumentShares] = useState<DocumentShareRow[]>([]);
  const [whiteboards, setWhiteboards] = useState<WhiteboardRow[]>([]);
  const [whiteboardShares, setWhiteboardShares] = useState<WhiteboardShareRow[]>([]);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const [kits, setKits] = useState<LocalKit[]>(() => readLocalKits());
  const [selected, setSelected] = useState<string | null>(null);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [section, setSection] = useState<'mine' | 'shared'>('mine');
  const [search, setSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [debouncedGlobalSearch, setDebouncedGlobalSearch] = useState('');
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [modal, setModal] = useState<{ file: FileRow; url?: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'folder' | 'rename' | 'share' | 'document-share' | 'whiteboard-share' | 'move'; id?: string; name?: string; fileId?: string } | null>(null);
  const [moveItem, setMoveItem] = useState<{ kind: 'file' | 'folder' | 'document' | 'whiteboard'; id: string; name: string; currentFolderId: string | null } | null>(null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{ kind: 'file' | 'document' | 'kit' | 'whiteboard'; id: string; name: string } | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [editingItem, setEditingItem] = useState<{ kind: 'file' | 'folder' | 'document' | 'whiteboard'; id: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [sharedUser, setSharedUser] = useState<UserRow[]>([]);
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('flexus-file-pins') || '[]'); } catch { return []; }
  });

  const load = async () => {
    if (!me) return;
    setError('');
    try {
      const [fs, fl, sh, docs, docShares, wbs, wbShares] = await Promise.all([
        api<FolderRow[]>('/rest/v1/folders?select=*&order=name.asc'),
        api<FileRow[]>('/rest/v1/files?select=*&order=created_at.desc'),
        api<ShareRow[]>('/rest/v1/file_shares?select=*'),
        api<DocumentRow[]>('/rest/v1/documents?select=*&order=updated_at.desc'),
        api<DocumentShareRow[]>('/rest/v1/document_shares?select=*'),
        api<WhiteboardRow[]>('/rest/v1/whiteboards?select=*&order=updated_at.desc'),
        api<WhiteboardShareRow[]>('/rest/v1/whiteboard_shares?select=*'),
      ]);
      const normalizedFolders = await ensureRoot(fs);
      setFolders(normalizedFolders);
      setFiles(fl);
      setShares(sh);
      setDocuments(docs);
      setDocumentShares(docShares);
      setWhiteboards(wbs);
      setWhiteboardShares(wbShares);
      setKits(readLocalKits());
    } catch (e) {
      if (isJwtError(e)) {
        setError(AUTH_RETRY_MESSAGE);
        window.setTimeout(() => window.location.reload(), AUTH_RETRY_DELAY_MS * 2);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load your files.');
      }
    }
  };

  useEffect(() => { void load(); }, [me?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedGlobalSearch(globalSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [globalSearch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchRef.current?.focus();
      }
      if (event.key === 'Escape' && document.activeElement === globalSearchRef.current) {
        setGlobalSearch('');
        setDebouncedGlobalSearch('');
        globalSearchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('flexus-file-pins', JSON.stringify(pinned)); } catch {}
  }, [pinned]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) setNewMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newMenuOpen]);

  const ensureRoot = async (loadedFolders: FolderRow[]) => {
    if (!me) return loadedFolders;

    const existing = loadedFolders.find(
      (folder) =>
        folder.owner_id === me.id &&
        folder.parent_folder_id === null &&
        folder.name === 'My Files',
    );

    if (existing) return loadedFolders;

    try {
      const created = await api<FolderRow[]>(
        '/rest/v1/folders?select=*&on_conflict=owner_id%2Cparent_folder_id%2Cname',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ name: 'My Files', owner_id: me.id, parent_folder_id: null }),
        },
      );
      return created[0] ? [...loadedFolders, created[0]] : loadedFolders;
    } catch {
      const roots = await api<FolderRow[]>(
        `/rest/v1/folders?select=*&owner_id=eq.${me.id}&parent_folder_id=is.null&name=eq.My%20Files&limit=1`,
      );
      return roots[0] ? [...loadedFolders, roots[0]] : loadedFolders;
    }
  };

  const mine = useMemo(() => files.filter(f => f.owner_id === me?.id), [files, me?.id]);
  const directShared = useMemo(() => files.filter(f => shares.some(s => s.file_id === f.id && s.shared_with_user_id === me?.id)), [files, shares, me?.id]);
  const sharedFolderIds = useMemo(() => {
    const ids = new Set<string>();
    shares.filter(s => s.folder_id && s.shared_with_user_id === me?.id).forEach(s => ids.add(s.folder_id!));
    let changed = true;
    while (changed) {
      changed = false;
      folders.forEach(f => { if (f.parent_folder_id && ids.has(f.parent_folder_id) && !ids.has(f.id)) { ids.add(f.id); changed = true; } });
    }
    return ids;
  }, [folders, shares, me?.id]);
  const sharedFiles = useMemo(() => files.filter(f => directShared.includes(f) || (f.folder_id && sharedFolderIds.has(f.folder_id))), [files, directShared, sharedFolderIds]);
  const mineDocuments = useMemo(() => documents.filter(d => d.owner_id === me?.id), [documents, me?.id]);
  const sharedDocuments = useMemo(() => documents.filter(d => documentShares.some(s => s.document_id === d.id && s.shared_with_user_id === me?.id)), [documents, documentShares, me?.id]);
  const mineWhiteboards = useMemo(() => whiteboards.filter(w => w.owner_id === me?.id), [whiteboards, me?.id]);
  const sharedWhiteboards = useMemo(() => whiteboards.filter(w => whiteboardShares.some(s => s.whiteboard_id === w.id && s.shared_with_user_id === me?.id)), [whiteboards, whiteboardShares, me?.id]);
  const visibleFolders = section === 'mine' ? folders.filter(f => f.owner_id === me?.id) : folders.filter(f => sharedFolderIds.has(f.id));
  const visibleFiles = section === 'mine' ? mine : sharedFiles;
  const visibleDocuments = section === 'mine' ? mineDocuments : sharedDocuments;
  const visibleWhiteboards = section === 'mine' ? mineWhiteboards : sharedWhiteboards;
  const currentWhiteboards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleWhiteboards.filter(w => (!selected || w.folder_id === selected) && (!q || w.title.toLowerCase().includes(q)));
  }, [visibleWhiteboards, selected, search]);

  const currentFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleFolders.filter(folder => folder.parent_folder_id === selected && (!q || folder.name.toLowerCase().includes(q)));
  }, [visibleFolders, selected, search]);
  const currentFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleFiles.filter(f => f.folder_id === selected && (!q || f.name.toLowerCase().includes(q)));
  }, [visibleFiles, selected, search]);
  const currentDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleDocuments.filter(d => d.folder_id === selected && (!q || d.title.toLowerCase().includes(q)));
  }, [visibleDocuments, selected, search]);
  const totalBytes = mine.reduce((n,f) => n + Number(f.size || 0), 0);
  const quick = folders.filter(f => pinned.includes(f.id) && f.owner_id === me?.id);
  const root = folders.find(f => f.owner_id === me?.id && f.parent_folder_id === null);
  const studyKitsFolder = folders.find(f => isStudyKitsFolder(f, root?.id));
  const studyKits = studyKitsFolder ? kits : [];
  const recentItems = [...(section === 'mine' ? mine : sharedFiles).slice(0, 4).map(file => ({ kind: 'file' as const, date: file.created_at, file })),
    ...(section === 'mine' ? mineDocuments : sharedDocuments).slice(0, 4).map(document => ({ kind: 'document' as const, date: document.updated_at, document })),
    ...(section === 'mine' ? mineWhiteboards : sharedWhiteboards).slice(0, 4).map(whiteboard => ({ kind: 'whiteboard' as const, date: whiteboard.updated_at, whiteboard })),
    ...(section === 'mine' ? studyKits : []).slice(0, 3).map(kit => ({ kind: 'kit' as const, date: kit.createdAt || '', kit }))]
    .sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0))
    .slice(0, 8);

  const folderLocation = (folderId: string | null): string => {
    if (!folderId) return 'My Files';
    const folder = folders.find(item => item.id === folderId);
    if (!folder) return 'My Files';
    const parent = folder.parent_folder_id ? folderLocation(folder.parent_folder_id) : '';
    return parent && parent !== 'My Files' ? `${parent} / ${folder.name}` : folder.name;
  };

  const matchingFolders = debouncedGlobalSearch ? visibleFolders.filter(folder => folder.name.toLowerCase().includes(debouncedGlobalSearch.toLowerCase())).slice(0, 5) : [];
  const matchingFiles = debouncedGlobalSearch ? visibleFiles.filter(file => file.name.toLowerCase().includes(debouncedGlobalSearch.toLowerCase())).slice(0, 5) : [];
  const matchingDocuments = debouncedGlobalSearch ? visibleDocuments.filter(document => document.title.toLowerCase().includes(debouncedGlobalSearch.toLowerCase())).slice(0, 5) : [];
  const matchingWhiteboards = debouncedGlobalSearch ? visibleWhiteboards.filter(board => board.title.toLowerCase().includes(debouncedGlobalSearch.toLowerCase())).slice(0, 5) : [];
  const matchingKits = debouncedGlobalSearch && section === 'mine' ? kits.filter(kit => kit.title.toLowerCase().includes(debouncedGlobalSearch.toLowerCase())).slice(0, 5) : [];
  const hasSearchResults = matchingFolders.length + matchingFiles.length + matchingDocuments.length + matchingWhiteboards.length + matchingKits.length > 0;

  const highlightMatch = (name: string) => {
    const query = debouncedGlobalSearch.toLowerCase();
    const index = name.toLowerCase().indexOf(query);
    if (!query || index < 0) return name;
    return <>{name.slice(0, index)}<mark className="rounded bg-primary/25 text-foreground">{name.slice(index, index + query.length)}</mark>{name.slice(index + query.length)}</>;
  };

  const openSearchResult = (kind: 'folder' | 'file' | 'document' | 'whiteboard' | 'kit', item: any) => {
    setGlobalSearch('');
    setDebouncedGlobalSearch('');
    if (kind === 'folder') {
      setSection(item.owner_id === me?.id ? 'mine' : 'shared');
      setSelected(item.id);
      setFolderDrawerOpen(false);
    } else if (kind === 'file') {
      setSection(item.owner_id === me?.id ? 'mine' : 'shared');
      setSelected(item.folder_id || null);
      void openFile(item);
    } else if (kind === 'document') {
      window.location.assign('/document/' + item.id);
    } else if (kind === 'whiteboard') {
      window.location.assign('/whiteboard?id=' + encodeURIComponent(item.id));
    } else {
      window.location.assign('/kit/' + item.id);
    }
  };

  const children = (parent: string | null) => visibleFolders.filter(f => f.parent_folder_id === parent);

  useEffect(() => {
    if (!me || !root || studyKitsFolder) return;
    void api<FolderRow[]>('/rest/v1/folders?select=*&on_conflict=owner_id%2Cparent_folder_id%2Cname', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ name: 'Study Kits', owner_id: me.id, parent_folder_id: root.id }),
    }).then((created) => {
      if (created[0]) setFolders(prev => [...prev.filter(folder => folder.id !== created[0].id), created[0]]);
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not create Study Kits folder.'));
  }, [me?.id, root?.id, studyKitsFolder?.id]);

  const createFolder = async () => {
    if (!me || !dialogValue.trim()) return;
    const parent = section === 'mine' ? (selected || root?.id || null) : null;
    if (!parent && section === 'mine') {
      const normalized = await ensureRoot(folders);
      setFolders(normalized);
      return;
    }
    setBusy(true);
    try {
      const created = await api<FolderRow[]>('/rest/v1/folders?select=*', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name: dialogValue.trim(), owner_id: me.id, parent_folder_id: parent }),
      });
      setFolders(prev => [...prev, ...created]); setDialog(null); setDialogValue('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create folder.'); }
    finally { setBusy(false); }
  };

  const folderDescendantIds = (folderId: string): Set<string> => {
    const descendants = new Set<string>();
    const visit = (parentId: string) => folders.filter(folder => folder.parent_folder_id === parentId).forEach(folder => {
      if (descendants.has(folder.id)) return;
      descendants.add(folder.id);
      visit(folder.id);
    });
    visit(folderId);
    return descendants;
  };

  const openMoveDialog = (item: { kind: 'file' | 'folder' | 'document' | 'whiteboard'; id: string; name: string; currentFolderId: string | null }) => {
    setMoveItem(item);
    setMoveTargetId(item.currentFolderId || root?.id || '');
    setDialog({ kind: 'move', id: item.id, name: item.name });
    setMenu(null);
  };

  const moveSelectedItem = async () => {
    if (!moveItem || !moveTargetId) return;
    if (moveItem.kind === 'folder') {
      if (moveItem.id === root?.id) { setError('The My Files root folder cannot be moved.'); return; }
      if (moveTargetId === moveItem.id || folderDescendantIds(moveItem.id).has(moveTargetId)) {
        setError('A folder cannot be moved into itself or one of its subfolders.');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      if (moveItem.kind === 'folder') {
        await api('/rest/v1/folders?id=eq.' + encodeURIComponent(moveItem.id), { method: 'PATCH', body: JSON.stringify({ parent_folder_id: moveTargetId }) });
        setFolders(prev => prev.map(folder => folder.id === moveItem.id ? { ...folder, parent_folder_id: moveTargetId } : folder));
      } else {
        const table = moveItem.kind === 'file' ? 'files' : moveItem.kind === 'document' ? 'documents' : 'whiteboards';
        await api('/rest/v1/' + table + '?id=eq.' + encodeURIComponent(moveItem.id), { method: 'PATCH', body: JSON.stringify({ folder_id: moveTargetId }) });
        if (moveItem.kind === 'file') setFiles(prev => prev.map(item => item.id === moveItem.id ? { ...item, folder_id: moveTargetId } : item));
        if (moveItem.kind === 'document') setDocuments(prev => prev.map(item => item.id === moveItem.id ? { ...item, folder_id: moveTargetId } : item));
        if (moveItem.kind === 'whiteboard') setWhiteboards(prev => prev.map(item => item.id === moveItem.id ? { ...item, folder_id: moveTargetId } : item));
      }
      setDialog(null); setMoveItem(null); setMoveTargetId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move item.');
    } finally { setBusy(false); }
  };

  const renameFile = async (file: FileRow, nextName: string) => {
    const name = nextName.trim();
    if (!name || name === file.name) return;
    setBusy(true);
    try {
      await api("/rest/v1/files?id=eq." + file.id, { method: 'PATCH', body: JSON.stringify({ name }) });
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, name } : f));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename file.'); }
    finally { setBusy(false); }
  };

  const renameFolderById = async (id: string, name: string) => {
    setBusy(true);
    try {
      await api("/rest/v1/folders?id=eq." + id, { method: 'PATCH', body: JSON.stringify({ name }) });
      setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename folder.'); }
    finally { setBusy(false); }
  };

  const saveInlineRename = async () => {
    const item = editingItem;
    const name = editingValue.trim();
    if (!item) return;
    if (!name) { setEditingItem(null); return; }
    if (item.kind === 'file') {
      const file = files.find(f => f.id === item.id);
      if (file) await renameFile(file, name);
    } else if (item.kind === 'whiteboard') {
      const whiteboard = whiteboards.find(candidate => candidate.id === item.id);
      if (whiteboard) await renameWhiteboard(whiteboard, name);
    } else if (item.kind === 'document') {
      setBusy(true);
      try {
        await api(`/rest/v1/documents?id=eq.${item.id}`, { method: 'PATCH', body: JSON.stringify({ title: name }) });
        setDocuments(prev => prev.map(document => document.id === item.id ? { ...document, title: name } : document));
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename document.'); }
      finally { setBusy(false); }
    } else {
      const folder = folders.find(f => f.id === item.id);
      if (folder && folder.name !== name) await renameFolderById(item.id, name);
    }
    setEditingItem(null);
  };

  const renameFolder = async () => {
    if (!dialog?.id || !dialogValue.trim()) return;
    setBusy(true);
    try {
      await api(`/rest/v1/folders?id=eq.${dialog.id}`, { method: 'PATCH', body: JSON.stringify({ name: dialogValue.trim() }) });
      setFolders(prev => prev.map(f => f.id === dialog.id ? { ...f, name: dialogValue.trim() } : f));
      setDialog(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename folder.'); }
    finally { setBusy(false); }
  };

  const deleteFolder = async (id: string) => {
    if (!confirm('Delete this folder and everything inside it?')) return;
    setBusy(true);
    try {
      await api(`/rest/v1/folders?id=eq.${id}`, { method: 'DELETE' });
      setFolders(prev => prev.filter(f => f.id !== id && f.parent_folder_id !== id));
      setFiles(prev => prev.filter(f => f.folder_id !== id));
      if (selected === id) setSelected(root?.id || null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete folder.'); }
    finally { setBusy(false); }
  };

  const upload = async (file: globalThis.File) => {
    if (!me) return;
    const folderId = selected || root?.id;
    if (!folderId) { setError('Your My Files folder is still being created.'); return; }
    setBusy(true); setError('');
    const path = `${me.id}/${folderId}/${Date.now()}-${safeName(file.name)}`;
    try {
      const storageResponse = await fetch(`${url}/storage/v1/object/user-files/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${getAccessToken()}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: file,
      });
      if (!storageResponse.ok) throw new Error((await storageResponse.text()).slice(0, 300) || 'Upload failed.');
      const created = await api<FileRow[]>('/rest/v1/files?select=*', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name: file.name, folder_id: folderId, owner_id: me.id, storage_path: path, size: file.size, type: file.type || 'application/octet-stream' }),
      });
      setFiles(prev => [...created, ...prev]);
    } catch (e) {
      try { await fetch(`${url}/storage/v1/object/user-files/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${getAccessToken()}` } }); } catch {}
      setError(e instanceof Error ? e.message : 'Could not upload file.');
    } finally { setBusy(false); }
  };

  const openFile = async (file: FileRow) => {
    try {
      const response = await api<{ signedURL: string }>('/storage/v1/object/sign/user-files/' + file.storage_path.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST', body: JSON.stringify({ expiresIn: 600 }),
      });
      const signed = response.signedURL.startsWith('http') ? response.signedURL : `${url}/storage/v1${response.signedURL}`;
      setModal({ file, url: signed });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open file.'); }
  };

  const download = async (file: FileRow) => {
    try {
      const response = await api<{ signedURL: string }>('/storage/v1/object/sign/user-files/' + file.storage_path.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST', body: JSON.stringify({ expiresIn: 600 }),
      });
      const signed = response.signedURL.startsWith('http') ? response.signedURL : `${url}/storage/v1${response.signedURL}`;
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not download file.'); }
  };

  const deleteFile = async (file: FileRow) => {
    setBusy(true);
    setError('');
    try {
      await api(`/rest/v1/files?id=eq.${encodeURIComponent(file.id)}`, { method: 'DELETE' });

      const storagePath = file.storage_path.split('/').map(encodeURIComponent).join('/');
      const storageResponse = await fetch(`${url}/storage/v1/object/user-files/${storagePath}`, {
        method: 'DELETE',
        headers: {
          apikey: anon,
          Authorization: `Bearer ${getAccessToken()}`,
        },
      });

      if (!storageResponse.ok && storageResponse.status !== 404) {
        const storageMessage = (await storageResponse.text()).slice(0, 300);
        throw new Error(storageMessage || `Storage deletion failed (${storageResponse.status}).`);
      }

      setFiles(prev => prev.filter(f => f.id !== file.id));
      setShares(prev => prev.filter(share => share.file_id !== file.id));
      console.info('[Files] Deleted file', { fileId: file.id, storagePath: file.storage_path });
    } catch (e) {
      console.error('[Files] Failed to delete file', {
        fileId: file.id,
        storagePath: file.storage_path,
        error: e,
      });
      setError(e instanceof Error ? e.message : 'Could not delete file.');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    const pending = deleteDialog;
    if (!pending) return;

    setBusy(true);
    setError('');

    try {
      if (pending.kind === 'file') {
        const file = files.find(item => item.id === pending.id);
        if (!file) throw new Error('This file is no longer available.');
        await deleteFile(file);
        setDeleteDialog(null);
        return;
      }

      if (pending.kind === 'whiteboard') {
        await api(`/rest/v1/whiteboards?id=eq.${encodeURIComponent(pending.id)}`, { method: 'DELETE' });
        setWhiteboards(prev => prev.filter(whiteboard => whiteboard.id !== pending.id));
        setWhiteboardShares(prev => prev.filter(share => share.whiteboard_id !== pending.id));
        setDeleteDialog(null);
        return;
      }

      if (pending.kind === 'document') {
        await api(`/rest/v1/documents?id=eq.${encodeURIComponent(pending.id)}`, { method: 'DELETE' });
        setDocuments(prev => prev.filter(document => document.id !== pending.id));
        setDocumentShares(prev => prev.filter(share => share.document_id !== pending.id));
        setDeleteDialog(null);
        console.info('[Files] Deleted document', { documentId: pending.id });
        return;
      }

      const raw = localStorage.getItem(KIT_STORAGE);
      const stored = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(stored)) throw new Error('Study kit storage is invalid.');

      const nextKits = stored.filter((kit: LocalKit) => kit?.id !== pending.id);
      if (nextKits.length === stored.length) {
        throw new Error('This study kit is no longer available.');
      }

      localStorage.setItem(KIT_STORAGE, JSON.stringify(nextKits));
      setKits(prev => prev.filter(kit => kit.id !== pending.id));

      try {
        await api(`/rest/v1/study_kits?id=eq.${encodeURIComponent(pending.id)}`, { method: 'DELETE' });
      } catch (e) {
        console.error('[Files] Study kit was removed locally but Supabase deletion failed', {
          kitId: pending.id,
          error: e,
        });
        setError('Study kit removed from this device, but its cloud copy could not be deleted.');
      }

      console.info('[Files] Deleted study kit', { kitId: pending.id });
      setDeleteDialog(null);
    } catch (e) {
      console.error('[Files] Delete failed', {
        kind: pending.kind,
        id: pending.id,
        name: pending.name,
        error: e,
      });
      setError(e instanceof Error ? e.message : 'Could not delete item.');
    } finally {
      setBusy(false);
    }
  };

  const searchUsers = async (q: string) => {
    setDialogValue(q);
    if (q.trim().length < 2) { setSharedUser([]); return; }
    try {
      const found = await api<UserRow[]>(`/rest/v1/users?select=id,email,display_name&id=neq.${me?.id}&or=(email.ilike.*${encodeURIComponent(q)}*,display_name.ilike.*${encodeURIComponent(q)}*)&limit=8`);
      setSharedUser(found);
    } catch { setSharedUser([]); }
  };

  const share = async (user: UserRow) => {
    if (!dialog) return;
    setBusy(true);
    try {
      const body = dialog.kind === 'share' && dialog.fileId
        ? { file_id: dialog.fileId, shared_with_user_id: user.id, shared_by_user_id: me?.id }
        : { folder_id: dialog.id, shared_with_user_id: user.id, shared_by_user_id: me?.id };
      await api('/rest/v1/file_shares', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      setDialog(null); setSharedUser([]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not share.'); }
    finally { setBusy(false); }
  };

  const createWhiteboard = async () => {
    console.info('[Files] Whiteboard creation started', {
      userId: me?.id ?? null,
      selectedFolderId: selected,
      rootFolderId: root?.id ?? null,
    });
    if (!me) {
      console.error('[Files] Whiteboard creation stopped: no signed-in user');
      setError('You must be signed in to create a whiteboard.');
      return;
    }

    const folderId = selected || root?.id || null;
    const payload = {
      title: 'Untitled Whiteboard',
      content: { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} },
      owner_id: me.id,
      folder_id: folderId,
    };

    console.info('[Files] Whiteboard creation payload prepared', {
      ownerId: payload.owner_id,
      folderId: payload.folder_id,
      title: payload.title,
    });

    setBusy(true);
    setError('');

    try {
      console.info('[Files] Creating whiteboard in Supabase');
      const created = await api<WhiteboardRow[]>('/rest/v1/whiteboards?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });

      console.info('[Files] Supabase whiteboard creation response received', {
        count: created.length,
        id: created[0]?.id ?? null,
      });

      if (!created[0]) {
        throw new Error('Supabase created the request but returned no whiteboard row.');
      }

      setWhiteboards(prev => [created[0], ...prev]);
      setNewMenuOpen(false);

      const destination = '/whiteboard?id=' + encodeURIComponent(created[0].id);
      console.info('[Files] Whiteboard created successfully; navigating to editor', {
        whiteboardId: created[0].id,
        destination,
      });
      window.location.assign(destination);
    } catch (e) {
      console.error('[Files] Whiteboard creation failed', {
        userId: me.id,
        folderId,
        error: e,
      });
      setError(e instanceof Error ? e.message : 'Could not create whiteboard.');
    } finally {
      console.info('[Files] Whiteboard creation finished');
      setBusy(false);
    }
  };

  const shareWhiteboard = async (user: UserRow) => {
    if (!dialog?.id || !me) return;
    setBusy(true);
    try {
      await api('/rest/v1/whiteboard_shares', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ whiteboard_id: dialog.id, shared_with_user_id: user.id, shared_by_user_id: me.id }) });
      setDialog(null); setSharedUser([]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not share whiteboard.'); }
    finally { setBusy(false); }
  };

  const renameWhiteboard = async (whiteboard: WhiteboardRow, nextName: string) => {
    const title = nextName.trim();
    if (!title || title === whiteboard.title) return;
    setBusy(true);
    try {
      const updatedAt = new Date().toISOString();
      await api('/rest/v1/whiteboards?id=eq.' + whiteboard.id, { method: 'PATCH', body: JSON.stringify({ title, updated_at: updatedAt }) });
      setWhiteboards(prev => prev.map(item => item.id === whiteboard.id ? { ...item, title, updated_at: updatedAt } : item));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename whiteboard.'); }
    finally { setBusy(false); }
  };

  const createDocument = async () => {
    if (!me) return;
    const folderId = selected || root?.id || null;
    setBusy(true); setError('');
    try {
      const created = await api<DocumentRow[]>('/rest/v1/documents?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title: 'Untitled Document', content: { ops: [{ insert: '\n' }] }, owner_id: me.id, folder_id: folderId }),
      });
      if (created[0]) {
        setDocuments(prev => [created[0], ...prev]);
        setNewMenuOpen(false);
        window.location.assign('/document/' + created[0].id);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create document.'); }
    finally { setBusy(false); }
  };

  const shareDocument = async (user: UserRow) => {
    if (!dialog?.id || !me) return;
    setBusy(true);
    try {
      await api('/rest/v1/document_shares', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ document_id: dialog.id, shared_with_user_id: user.id, shared_by_user_id: me.id }) });
      setDialog(null); setSharedUser([]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not share document.'); }
    finally { setBusy(false); }
  };

  const togglePin = (id: string) => setPinned(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const folderTree = (parent: string | null, depth = 0): JSX.Element[] => children(parent).map(folder => (
    <div key={folder.id}>
      <div className="group flex items-center">
        <div role="button" tabIndex={0} onClick={() => setSelected(folder.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ') setSelected(folder.id)}} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-secondary ${selected === folder.id ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`} style={{ paddingLeft: 8 + depth * 14 }}>
          {children(folder.id).length ? <ChevronRight size={13} /> : <span className="w-[13px]" />}
          {selected === folder.id ? <FolderOpen size={15} className="text-primary" /> : <Folder size={15} className="text-primary" />}
          {editingItem?.kind === 'folder' && editingItem.id === folder.id ? (
            <input autoFocus value={editingValue} onChange={e=>setEditingValue(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter') void saveInlineRename(); if(e.key==='Escape') setEditingItem(null);}}
              onBlur={()=>void saveInlineRename()} onDoubleClick={e=>e.stopPropagation()}
              className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs outline-none" />
          ) : (
            <span onDoubleClick={(e)=>{e.stopPropagation(); setEditingItem({kind:'folder',id:folder.id}); setEditingValue(folder.name);}} className="truncate">{folder.name}</span>
          )}
        </div>
        {folder.owner_id === me?.id && <button onClick={() => setMenu(menu === folder.id ? null : folder.id)} className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-secondary"><MoreHorizontal size={14} /></button>}
      </div>
      {menu === folder.id && <div className="ml-auto mr-1 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-xl">
        <button onClick={() => { setEditingItem({kind:'folder',id:folder.id}); setEditingValue(folder.name); setMenu(null); }} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary" title="Rename"><Pencil size={13}/> Rename</button>
        <button onClick={() => { togglePin(folder.id); setMenu(null); }} className="rounded p-1.5 hover:bg-secondary" title="Pin"><Pin size={13}/></button>
        <button onClick={() => { setDialog({ kind:'share', id:folder.id }); setDialogValue(''); setMenu(null); }} className="rounded p-1.5 hover:bg-secondary" title="Share"><Share2 size={13}/></button>
        {folder.id !== root?.id && <button onClick={() => openMoveDialog({kind:'folder',id:folder.id,name:folder.name,currentFolderId:folder.parent_folder_id})} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary" title="Move"><Move size={13}/> Move</button>}
        {folder.id !== root?.id && <button onClick={() => { void deleteFolder(folder.id); setMenu(null); }} className="rounded p-1.5 text-red-300 hover:bg-secondary" title="Delete"><Trash2 size={13}/></button>}
      </div>}
      {folderTree(folder.id, depth + 1)}
    </div>
  ));

  const renameStudyKit = async (kit: LocalKit) => {
    const next = window.prompt('Rename study kit', kit.title)?.trim();
    if (!next || next === kit.title) return;
    try {
      const raw = localStorage.getItem(KIT_STORAGE);
      const stored = raw ? JSON.parse(raw) : [];
      if (Array.isArray(stored)) localStorage.setItem(KIT_STORAGE, JSON.stringify(stored.map((item: LocalKit) => item.id === kit.id ? { ...item, title: next } : item)));
      setKits(prev => prev.map(item => item.id === kit.id ? { ...item, title: next } : item));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename study kit.'); }
  };

  const shareStudyKit = async (kit: LocalKit) => {
    const shareUrl = `${window.location.origin}/kit/${kit.id}`;
    try {
      if (navigator.share) await navigator.share({ title: kit.title, url: shareUrl });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(shareUrl); setError(''); }
      else throw new Error('Sharing is not available in this browser.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Could not share study kit.');
    }
  };

  const kitCard = (kit: LocalKit) => (
    <div key={kit.id} className="group rounded-xl border border-border bg-card p-5 hover:border-primary/40">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => window.location.assign(`/kit/${kit.id}`)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpen size={19}/></div>
          <div className="min-w-0">
            <p className="truncate text-[10px] uppercase tracking-[.16em] text-primary">{kit.courseLabel || 'Study kit'}</p>
            <h3 className="mt-2 truncate font-serif text-xl tracking-[-.02em]">{kit.title}</h3>
          </div>
        </button>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMenu(menu === 'kit:' + kit.id ? null : 'kit:' + kit.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="More options"><MoreHorizontal size={14}/></button>
          {menu === 'kit:' + kit.id && <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card p-1 shadow-xl">
            <button type="button" onClick={() => { void renameStudyKit(kit); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Pencil size={13}/> Rename</button>
            <button type="button" onClick={() => { void shareStudyKit(kit); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Share2 size={13}/> Share</button>
            <button type="button" onClick={() => { setDeleteDialog({ kind: 'kit', id: kit.id, name: kit.title }); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-secondary"><Trash2 size={13}/> Delete</button>
            <button type="button" onClick={() => { window.location.assign(`/kit/${kit.id}`); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><BookOpen size={13}/> Open</button>
          </div>}
        </div>
      </div>
      <div className="mt-5 flex gap-4 text-xs text-muted-foreground">
        <span>{kit.flashcards?.length || 0} flashcards</span>
        <span>{kit.chapters?.length || 0} chapters</span>
      </div>
    </div>
  );

  const folderCard = (folder: FolderRow) => (
    <div key={folder.id} className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => { setSelected(folder.id); setSearch(''); setFolderDrawerOpen(false); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Folder size={23}/></div>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{folder.name}</span><span className="mt-1 block text-[10px] text-muted-foreground">{children(folder.id).length} subfolders</span></span>
        </button>
        {folder.owner_id === me?.id && <div className="relative shrink-0">
          <button type="button" onClick={() => setMenu(menu === 'folder-card:' + folder.id ? null : 'folder-card:' + folder.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Folder options"><MoreHorizontal size={14}/></button>
          {menu === 'folder-card:' + folder.id && <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card p-1 shadow-xl">
            <button type="button" onClick={() => { setEditingItem({kind:'folder',id:folder.id}); setEditingValue(folder.name); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Pencil size={13}/> Rename</button>
            <button type="button" onClick={() => { togglePin(folder.id); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Pin size={13}/> Pin</button>
            {folder.id !== root?.id && <button type="button" onClick={() => openMoveDialog({kind:'folder',id:folder.id,name:folder.name,currentFolderId:folder.parent_folder_id})} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Move size={13}/> Move</button>}
            {folder.id !== root?.id && <button type="button" onClick={() => { void deleteFolder(folder.id); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-secondary"><Trash2 size={13}/> Delete</button>}
          </div>}
        </div>}
      </div>
    </div>
  );

  const whiteboardCard = (whiteboard: WhiteboardRow) => (
    <div key={whiteboard.id} className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
      <button type="button" onClick={() => window.location.assign('/whiteboard?id=' + encodeURIComponent(whiteboard.id))} className="w-full text-left">
        <div className="flex h-24 items-center justify-center rounded-lg bg-secondary/60"><Pencil size={34} className="text-primary" /></div>
        <p className="mt-3 truncate text-sm font-medium" title={whiteboard.title}>{whiteboard.title.length > 15 ? whiteboard.title.slice(0, 15) + '…' : whiteboard.title}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Whiteboard · {formatDate(whiteboard.updated_at)}</p>
      </button>
      {whiteboard.owner_id === me?.id && <div className="mt-3 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === 'wb:' + whiteboard.id ? null : 'wb:' + whiteboard.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="More options"><MoreHorizontal size={14}/></button>
          {menu === 'wb:' + whiteboard.id && <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card p-1 shadow-xl">
            <button type="button" onClick={() => openMoveDialog({kind:'whiteboard',id:whiteboard.id,name:whiteboard.title,currentFolderId:whiteboard.folder_id})} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Move size={13}/> Move</button>
            <button type="button" onClick={() => { const next = window.prompt('Rename whiteboard', whiteboard.title)?.trim(); if (next && next !== whiteboard.title) void renameWhiteboard(whiteboard, next); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Pencil size={13}/> Rename</button>
            <button type="button" onClick={() => { setDialog({ kind:'whiteboard-share', id:whiteboard.id }); setDialogValue(''); setSharedUser([]); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Share2 size={13}/> Share</button>
            <button type="button" onClick={() => { setDeleteDialog({ kind:'whiteboard', id:whiteboard.id, name:whiteboard.title }); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-secondary"><Trash2 size={13}/> Delete</button>
          </div>}
        </div>
      </div>}
    </div>
  );

  const documentCard = (document: DocumentRow) => (
    <div key={document.id} className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
      <button type="button" onClick={() => window.location.assign('/document/' + document.id)} className="w-full text-left">
        <div className="flex h-24 items-center justify-center rounded-lg bg-secondary/60"><FileText size={34} className="text-primary" /></div>
        <p className="mt-3 truncate text-sm font-medium" title={document.title}>{document.title.length > 15 ? document.title.slice(0, 15) + '…' : document.title}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Document · {formatDate(document.updated_at)}</p>
      </button>
      {document.owner_id === me?.id && (
        <div className="mt-3 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
          <div className="relative">
            <button type="button" onClick={() => setMenu(menu === 'doc:' + document.id ? null : 'doc:' + document.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="More options"><MoreHorizontal size={14}/></button>
            {menu === 'doc:' + document.id && <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card p-1 shadow-xl">
              <button type="button" onClick={() => openMoveDialog({kind:'document',id:document.id,name:document.title,currentFolderId:document.folder_id})} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Move size={13}/> Move</button>
              <button type="button" onClick={() => { const next = window.prompt('Rename document', document.title)?.trim(); if (next && next !== document.title) void (async () => { setBusy(true); try { await api(`/rest/v1/documents?id=eq.${document.id}`, { method: 'PATCH', body: JSON.stringify({ title: next }) }); setDocuments(prev => prev.map(item => item.id === document.id ? { ...item, title: next } : item)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename document.'); } finally { setBusy(false); } })(); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Pencil size={13}/> Rename</button>
              <button type="button" onClick={() => { setDialog({ kind:'document-share', id:document.id }); setDialogValue(''); setSharedUser([]); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Share2 size={13}/> Share</button>
              <button type="button" onClick={() => { setDeleteDialog({ kind:'document', id:document.id, name:document.title }); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-secondary"><Trash2 size={13}/> Delete</button>
            </div>}
          </div>
        </div>
      )}
    </div>
  );

  const fileCard = (file: FileRow) => {
    const Icon = iconFor(file.type, file.name);
    return (
      <div key={file.id} className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
        <div
          role="button"
          tabIndex={0}
          onClick={() => void openFile(file)}
          onKeyDown={e=>{if(e.key==='Enter'||e.key===' ') void openFile(file)}}
          className="w-full text-left"
          aria-label={`Open ${file.name}`}
        >
          <div className="flex h-24 items-center justify-center rounded-lg bg-secondary/60">
            <Icon size={34} className="text-primary" />
          </div>
          {editingItem?.kind === 'file' && editingItem.id === file.id ? (
            <input autoFocus value={editingValue} onChange={e=>setEditingValue(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter') void saveInlineRename(); if(e.key==='Escape') setEditingItem(null);}}
              onBlur={()=>void saveInlineRename()} onDoubleClick={e=>e.stopPropagation()}
              className="mt-3 h-7 w-full rounded border border-input bg-background px-1.5 text-sm outline-none" />
          ) : (
            <p onDoubleClick={(e)=>{e.stopPropagation(); setEditingItem({kind:'file',id:file.id}); setEditingValue(file.name);}} className="mt-3 truncate text-sm font-medium" title={file.name}>
              {file.name.length > 15 ? file.name.slice(0, 15) + '…' : file.name}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">
            {formatBytes(Number(file.size))} · {formatDate(file.created_at)}
          </p>
        </div>
        <div className="mt-3 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {file.owner_id === me?.id && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu(menu === file.id ? null : file.id)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="More options"
                aria-label="More options"
              >
                <MoreHorizontal size={14}/>
              </button>
              {menu === file.id && (
                <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-border bg-card p-1 shadow-xl">
                  <button type="button" onClick={() => openMoveDialog({kind:'file',id:file.id,name:file.name,currentFolderId:file.folder_id})} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Move size={13}/> Move</button>
                  <button type="button" onClick={() => { void download(file); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Download size={13}/> Download</button>
                  <button type="button" onClick={() => { setEditingItem({kind:'file',id:file.id}); setEditingValue(file.name); setMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"><Pencil size={13}/> Rename</button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialog({ kind:'share', fileId:file.id });
                      setDialogValue('');
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"
                  >
                    <Share2 size={13}/> Share
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      setDeleteDialog({ kind: 'file', id: file.id, name: file.name });
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-secondary"
                  >
                    <Trash2 size={13}/> Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return <section className="px-5 py-8 sm:px-8">
    <div className="mx-auto max-w-[1500px]">
      {error && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Workspace</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em]">Your workspace</h1><p className="mt-2 text-sm text-muted-foreground">Files, study kits, and everything you need</p></div>
        <div className="relative" ref={newMenuRef}>
          <button type="button" onClick={() => setNewMenuOpen(open => !open)} disabled={busy} className="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"><Plus size={15}/> New <ChevronDown size={14}/></button>
          {newMenuOpen && <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-border bg-card p-1.5 shadow-2xl">
            <button type="button" onClick={() => { setDialog({kind:'folder'}); setDialogValue(''); setNewMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary"><Folder size={16} className="text-muted-foreground" /> New Folder</button>
            <button type="button" onClick={() => void createDocument()} disabled={busy} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary disabled:opacity-50"><FileText size={16} className="text-muted-foreground" /> New Document</button>
            <button type="button" onClick={() => void createWhiteboard()} disabled={busy} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary disabled:opacity-50"><Pencil size={16} className="text-muted-foreground" /> New Whiteboard</button>
            <button type="button" onClick={() => { setNewMenuOpen(false); window.location.assign('/new'); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary"><BookOpen size={16} className="text-muted-foreground" /> New Study Kit</button>
            <label className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-secondary"><UploadCloud size={16} className="shrink-0" /> Upload File<input type="file" className="hidden" disabled={busy} onChange={e => { const f=e.target.files?.[0]; if(f) void upload(f); e.currentTarget.value=''; }}/></label>
          </div>}
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Total Files', mine.length], ['Study Kits', studyKits.length], ['Storage Used', formatBytes(totalBytes)], ['Shared with Me', sharedFiles.length]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-border bg-card p-5"><p className="text-[10px] uppercase tracking-[.16em] text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p></div>)}
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[280px_1fr]">
        <aside className={folderDrawerOpen ? "rounded-xl border border-border bg-card p-4 max-xl:fixed max-xl:inset-y-0 max-xl:left-0 max-xl:z-[90] max-xl:w-[300px] max-xl:overflow-y-auto max-xl:rounded-none max-xl:shadow-2xl xl:static" : "rounded-xl border border-border bg-card p-4 max-xl:fixed max-xl:inset-y-0 max-xl:left-0 max-xl:z-[90] max-xl:w-[300px] max-xl:overflow-y-auto max-xl:rounded-none max-xl:shadow-2xl max-xl:-translate-x-full xl:static"}>
          <div className="mb-3 flex items-center justify-between xl:hidden"><span className="text-sm font-semibold">Browse folders</span><button type="button" onClick={() => setFolderDrawerOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Close folders"><X size={18}/></button></div><button onClick={() => { setSection('mine'); setSelected(null); setFolderDrawerOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-secondary">
            <FolderOpen size={15} className="text-primary" /> My Files
          </button>
          <button onClick={() => { setSection('shared'); setSelected(null); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-secondary">
            <Share2 size={15} className="text-primary" /> Shared with Me
          </button>
          <div className="mt-4 border-t border-border pt-3">{folderTree(null)}</div>
          {quick.length > 0 && <div className="mt-6 border-t border-border pt-4"><p className="px-2 text-[10px] uppercase tracking-[.16em] text-muted-foreground">Quick Access</p>{quick.map(f=><button key={f.id} onClick={()=>{setSection('mine');setSelected(f.id)}} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-secondary"><Pin size={13} className="text-primary"/>{f.name}</button>)}</div>}
        </aside>
        {folderDrawerOpen && <button type="button" onClick={() => setFolderDrawerOpen(false)} className="fixed inset-0 z-[80] bg-black/50 xl:hidden" aria-label="Close folders" />}

        <div className="min-w-0">
          <div className="relative mb-5">
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input ref={globalSearchRef} value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search files, documents, whiteboards, and study kits..." aria-label="Search all files and workspace content" className="h-12 w-full rounded-xl border border-input bg-card pl-10 pr-20 text-sm outline-none transition-colors focus:border-primary" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-1 text-[10px] text-muted-foreground">⌘K / Ctrl K</span>
            {globalSearch.trim() && <button type="button" onClick={() => { setGlobalSearch(''); setDebouncedGlobalSearch(''); }} className="absolute right-12 top-1/2 hidden -translate-y-1/2 rounded p-1 hover:bg-secondary sm:block" aria-label="Clear search"><X size={14}/></button>}
            {debouncedGlobalSearch && <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-2xl">
              {!hasSearchResults ? <p className="px-2 py-5 text-sm text-muted-foreground">No results found for <span className="font-medium text-foreground">{debouncedGlobalSearch}</span></p> : <div className="space-y-4">
                {matchingFolders.length > 0 && <section><h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Folders</h3>{matchingFolders.map(item => <button key={item.id} onClick={() => openSearchResult('folder', item)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"><Folder size={17} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block truncate text-sm">{highlightMatch(item.name)}</span><span className="block truncate text-[11px] text-muted-foreground">{folderLocation(item.parent_folder_id)}</span></span></button>)}</section>}
                {matchingFiles.length > 0 && <section><h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Files</h3>{matchingFiles.map(item => { const Icon = iconFor(item.type, item.name); return <button key={item.id} onClick={() => openSearchResult('file', item)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"><Icon size={17} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block truncate text-sm">{highlightMatch(item.name)}</span><span className="block truncate text-[11px] text-muted-foreground">{folderLocation(item.folder_id)}</span></span></button>; })}</section>}
                {matchingDocuments.length > 0 && <section><h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Documents</h3>{matchingDocuments.map(item => <button key={item.id} onClick={() => openSearchResult('document', item)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"><FileText size={17} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block truncate text-sm">{highlightMatch(item.title)}</span><span className="block truncate text-[11px] text-muted-foreground">{folderLocation(item.folder_id)}</span></span></button>)}</section>}
                {matchingWhiteboards.length > 0 && <section><h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Whiteboards</h3>{matchingWhiteboards.map(item => <button key={item.id} onClick={() => openSearchResult('whiteboard', item)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"><Pencil size={17} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block truncate text-sm">{highlightMatch(item.title)}</span><span className="block truncate text-[11px] text-muted-foreground">{folderLocation(item.folder_id)}</span></span></button>)}</section>}
                {matchingKits.length > 0 && <section><h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Study Kits</h3>{matchingKits.map(item => <button key={item.id} onClick={() => openSearchResult('kit', item)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"><BookOpen size={17} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block truncate text-sm">{highlightMatch(item.title)}</span><span className="block truncate text-[11px] text-muted-foreground">{folderLocation(studyKitsFolder?.id || null)}</span></span></button>)}</section>}
              </div>}
            </div>}
          </div>
          <button type="button" onClick={() => setFolderDrawerOpen(true)} className="mb-4 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-xs font-semibold xl:hidden"><FolderOpen size={15} className="text-primary"/> Browse folders</button>
          {!selected ? <div>
            <div className="flex items-center justify-between"><div><h2 className="font-serif text-2xl">Recent</h2><p className="mt-1 text-xs text-muted-foreground">Your latest files and study kits</p></div></div>
            {!recentItems.length ? <div className="mt-5 rounded-2xl border border-dashed border-primary/30 bg-card/70 p-12 text-center"><div className="mx-auto flex w-fit items-center gap-2 text-primary"><UploadCloud size={30}/><BookOpen size={30}/></div><h2 className="mt-4 font-serif text-2xl">Nothing here yet</h2><p className="mt-2 text-sm text-muted-foreground">Use + New above to add something to your workspace.</p></div> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{recentItems.map(item => item.kind === 'file' ? fileCard(item.file) : item.kind === 'document' ? documentCard(item.document) : item.kind === 'whiteboard' ? whiteboardCard(item.whiteboard) : kitCard(item.kit))}</div>}
            <div className="mt-10"><h2 className="font-serif text-2xl">Quick access</h2>{quick.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{quick.map(f=><button key={f.id} onClick={()=>{setSection('mine');setSelected(f.id)}} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40"><Folder size={20} className="text-primary"/><span className="truncate text-sm font-medium">{f.name}</span></button>)}</div> : <p className="mt-3 text-xs text-muted-foreground">Pin folders from their menu to keep them here.</p>}</div>
          </div> : <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search files by name" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none"/></div><div className="flex rounded-lg border border-border p-1"><button onClick={()=>setView('grid')} className={`rounded-md p-1.5 ${view==='grid'?'bg-secondary':''}`}><Grid2X2 size={15}/></button><button onClick={()=>setView('list')} className={`rounded-md p-1.5 ${view==='list'?'bg-secondary':''}`}><List size={15}/></button></div></div>
            <div className="mt-5 flex items-center justify-between"><h2 className="font-serif text-2xl">{section==='shared'?'Shared with Me':(folders.find(f=>f.id===selected)?.name || 'My Files')}</h2><span className="text-xs text-muted-foreground">{currentFolders.length + currentFiles.length + currentDocuments.length + currentWhiteboards.length} items</span></div>
            {selected === studyKitsFolder?.id ? (studyKits.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{studyKits.filter(k => !search || k.title.toLowerCase().includes(search.toLowerCase())).map(kitCard)}</div> : <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No study kits yet.</div>) : (currentFolders.length || currentFiles.length || currentDocuments.length || currentWhiteboards.length) ? <div className={view==='grid'?'mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4':'mt-4 space-y-2'}>{currentFolders.map(folderCard)}{currentWhiteboards.map(whiteboardCard)}{currentDocuments.map(documentCard)}{currentFiles.map(fileCard)}</div> : <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">This folder is empty.</div>}
          </div>}
        </div>
      </div>

      {modal?.url && <FileViewer file={modal.file} src={modal.url} onClose={() => setModal(null)} />}

      {deleteDialog && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-5">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
          <h2 className="font-serif text-2xl">Delete {deleteDialog.kind === 'document' ? 'document' : deleteDialog.kind === 'kit' ? 'study kit' : deleteDialog.kind === 'whiteboard' ? 'whiteboard' : 'file'}?</h2>
          <p className="mt-3 text-sm text-muted-foreground">Are you sure you want to delete {deleteDialog.name}? This cannot be undone.</p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteDialog(null)} className="rounded-lg border border-border px-4 py-2.5 text-xs font-semibold hover:bg-secondary">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void confirmDelete()} className="rounded-lg bg-red-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">Delete</button>
          </div>
        </div>
      </div>}

      {dialog?.kind === 'move' && moveItem && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/70 p-5"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-serif text-2xl">Move {moveItem.kind}</h2><button type="button" onClick={() => { setDialog(null); setMoveItem(null); }} aria-label="Close move dialog"><X size={17}/></button></div><p className="mt-3 text-sm text-muted-foreground">Choose a destination for <span className="font-medium text-foreground">{moveItem.name}</span>.</p><select value={moveTargetId} onChange={e=>setMoveTargetId(e.target.value)} className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none" disabled={busy}>{root && <option value={root.id}>My Files (root)</option>}{folders.filter(folder=>folder.owner_id===me?.id && folder.id!==root?.id && folder.id!==moveItem.id && !(moveItem.kind==='folder' && folderDescendantIds(moveItem.id).has(folder.id))).map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button type="button" disabled={busy||!moveTargetId||moveTargetId===moveItem.currentFolderId} onClick={()=>void moveSelectedItem()} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{busy?'Moving…':'Move here'}</button></div></div>}
      {dialog && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-5"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">{dialog.kind==='folder'?'New Folder':dialog.kind==='rename'?'Rename Folder':'Share with Flexus user'}</h2><button onClick={()=>setDialog(null)}><X size={17}/></button></div>
        {dialog.kind==='share' || dialog.kind==='document-share' || dialog.kind==='whiteboard-share' ? <><input autoFocus value={dialogValue} onChange={e=>void searchUsers(e.target.value)} placeholder="Search by name or email" className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"/><div className="mt-3 space-y-1">{sharedUser.map(u=><button key={u.id} onClick={()=>void (dialog.kind==='document-share' ? shareDocument(u) : dialog.kind==='whiteboard-share' ? shareWhiteboard(u) : share(u))} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-secondary"><span><span className="block text-sm">{u.display_name}</span><span className="block text-[10px] text-muted-foreground">{u.email}</span></span><Share2 size={14}/></button>)}</div></> : <><input autoFocus value={dialogValue} onChange={e=>setDialogValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void (dialog.kind==='folder'?createFolder():renameFolder())}} placeholder="Folder name" className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"/><button disabled={busy||!dialogValue.trim()} onClick={()=>void (dialog.kind==='folder'?createFolder():renameFolder())} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{dialog.kind==='folder'?'Create folder':'Save changes'}</button></>}
      </div></div>}
    </div>
  </section>;
}
