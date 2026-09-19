import { useEffect, useMemo, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronRight, Download, File, FileArchive, FileAudio, FileImage, FileText,
  FileVideo, Folder, FolderOpen, Grid2X2, List, MoreHorizontal, Pencil, Pin,
  Plus, Search, Share2, Trash2, UploadCloud, X, ZoomIn, ZoomOut, BookOpen
} from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

type FolderRow = { id: string; name: string; parent_folder_id: string | null; owner_id: string; created_at: string };
type FileRow = { id: string; name: string; folder_id: string | null; owner_id: string; storage_path: string; size: number; type: string; created_at: string };
type ShareRow = { id: string; file_id: string | null; folder_id: string | null; shared_with_user_id: string; shared_by_user_id: string; created_at: string };
type DocumentRow = { id: string; title: string; content: any; owner_id: string; folder_id: string | null; created_at: string; updated_at: string };
type DocumentShareRow = { id: string; document_id: string; shared_with_user_id: string; shared_by_user_id: string; created_at: string };
type UserRow = { id: string; email: string; display_name: string };

const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const KIT_STORAGE = 'lecture-study-kits';

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

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  if (!token || !url || !anon) throw new Error('Files storage is not configured.');
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
  if (!response.ok) throw new Error(
    typeof data === 'object' && data ? String((data as any).message || (data as any).details || (data as any).hint || `Request failed (${response.status})`) : `Request failed (${response.status})`
  );
  return data as T;
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
  const [kits, setKits] = useState<LocalKit[]>(() => readLocalKits());
  const [selected, setSelected] = useState<string | null>(null);
  const [section, setSection] = useState<'mine' | 'shared'>('mine');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [modal, setModal] = useState<{ file: FileRow; url?: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'folder' | 'rename' | 'share'; id?: string; name?: string; fileId?: string } | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [editingItem, setEditingItem] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [sharedUser, setSharedUser] = useState<UserRow[]>([]);
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('flexus-file-pins') || '[]'); } catch { return []; }
  });

  const load = async () => {
    if (!me) return;
    setError('');
    try {
      const [fs, fl, sh, docs, docShares] = await Promise.all([
        api<FolderRow[]>('/rest/v1/folders?select=*&order=name.asc'),
        api<FileRow[]>('/rest/v1/files?select=*&order=created_at.desc'),
        api<ShareRow[]>('/rest/v1/file_shares?select=*'),
        api<DocumentRow[]>('/rest/v1/documents?select=*&order=updated_at.desc'),
        api<DocumentShareRow[]>('/rest/v1/document_shares?select=*'),
      ]);
      const normalizedFolders = await ensureRoot(fs);
      setFolders(normalizedFolders);
      setFiles(fl);
      setShares(sh);
      setDocuments(docs);
      setDocumentShares(docShares);
      setKits(readLocalKits());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your files.');
    }
  };

  useEffect(() => { void load(); }, [me?.id]);

  useEffect(() => {
    try { localStorage.setItem('flexus-file-pins', JSON.stringify(pinned)); } catch {}
  }, [pinned]);

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
  const visibleFolders = section === 'mine' ? folders.filter(f => f.owner_id === me?.id) : folders.filter(f => sharedFolderIds.has(f.id));
  const visibleFiles = section === 'mine' ? mine : sharedFiles;
  const visibleDocuments = section === 'mine' ? mineDocuments : sharedDocuments;
  const currentFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleFiles.filter(f => (!selected || f.folder_id === selected) && (!q || f.name.toLowerCase().includes(q)));
  }, [visibleFiles, selected, search]);
  const totalBytes = mine.reduce((n,f) => n + Number(f.size || 0), 0);
  const quick = folders.filter(f => pinned.includes(f.id) && f.owner_id === me?.id);
  const root = folders.find(f => f.owner_id === me?.id && f.parent_folder_id === null);
  const studyKitsFolder = folders.find(f => isStudyKitsFolder(f, root?.id));
  const studyKits = studyKitsFolder ? kits : [];
  const recentItems = [...mine.slice(0, 4).map(file => ({ kind: 'file' as const, date: file.created_at, file })),
    ...mineDocuments.slice(0, 4).map(document => ({ kind: 'document' as const, date: document.updated_at, document })),
    ...studyKits.slice(0, 3).map(kit => ({ kind: 'kit' as const, date: kit.createdAt || '', kit }))]
    .sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0))
    .slice(0, 8);

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
    if (!confirm(`Delete “${file.name}”?`)) return;
    setBusy(true);
    try {
      await fetch(`${url}/storage/v1/object/user-files/${file.storage_path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${getAccessToken()}` } });
      await api(`/rest/v1/files?id=eq.${file.id}`, { method: 'DELETE' });
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete file.'); }
    finally { setBusy(false); }
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
        <button onClick={() => setSelected(folder.id)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-secondary ${selected === folder.id ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`} style={{ paddingLeft: 8 + depth * 14 }}>
          {children(folder.id).length ? <ChevronRight size={13} /> : <span className="w-[13px]" />}
          {selected === folder.id ? <FolderOpen size={15} className="text-primary" /> : <Folder size={15} className="text-primary" />}
          <span className="truncate">{folder.name}</span>
        </button>
        {folder.owner_id === me?.id && <button onClick={() => setMenu(menu === folder.id ? null : folder.id)} className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-secondary"><MoreHorizontal size={14} /></button>}
      </div>
      {menu === folder.id && <div className="ml-auto mr-1 flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-xl">
        <button onClick={() => { setDialog({ kind:'rename', id:folder.id }); setDialogValue(folder.name); setMenu(null); }} className="rounded p-1.5 hover:bg-secondary" title="Rename"><Pencil size={13}/></button>
        <button onClick={() => { togglePin(folder.id); setMenu(null); }} className="rounded p-1.5 hover:bg-secondary" title="Pin"><Pin size={13}/></button>
        <button onClick={() => { setDialog({ kind:'share', id:folder.id }); setDialogValue(''); setMenu(null); }} className="rounded p-1.5 hover:bg-secondary" title="Share"><Share2 size={13}/></button>
        {folder.id !== root?.id && <button onClick={() => { void deleteFolder(folder.id); setMenu(null); }} className="rounded p-1.5 text-red-300 hover:bg-secondary" title="Delete"><Trash2 size={13}/></button>}
      </div>}
      {folderTree(folder.id, depth + 1)}
    </div>
  ));

  const kitCard = (kit: LocalKit) => (
    <button key={kit.id} onClick={() => window.location.assign(`/kit/${kit.id}`)} className="group rounded-xl border border-border bg-card p-5 text-left transition-transform hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpen size={19}/></div>
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-[.16em] text-primary">{kit.courseLabel || 'Study kit'}</p>
          <h3 className="mt-2 truncate font-serif text-xl tracking-[-.02em]">{kit.title}</h3>
        </div>
      </div>
      <div className="mt-5 flex gap-4 text-xs text-muted-foreground">
        <span>{kit.flashcards?.length || 0} flashcards</span>
        <span>{kit.chapters?.length || 0} chapters</span>
      </div>
    </button>
  );

  const fileCard = (file: FileRow) => {
    const Icon = iconFor(file.type, file.name);
    return (
      <div key={file.id} className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
        <button
          type="button"
          onClick={() => void openFile(file)}
          className="w-full text-left"
          aria-label={`Open ${file.name}`}
        >
          <div className="flex h-24 items-center justify-center rounded-lg bg-secondary/60">
            <Icon size={34} className="text-primary" />
          </div>
          <p className="mt-3 truncate text-sm font-medium" title={file.name}>
            {file.name.length > 15 ? file.name.slice(0, 15) + '…' : file.name}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {formatBytes(Number(file.size))} · {formatDate(file.created_at)}
          </p>
        </button>
        <div className="mt-3 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => void download(file)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Download"
            aria-label={`Download ${file.name}`}
          >
            <Download size={14}/>
          </button>
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
                <div className="absolute right-0 top-8 z-20 w-36 rounded-lg border border-border bg-card p-1 shadow-xl">
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
                      void deleteFile(file);
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
        <div className="flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><UploadCloud size={15}/> Upload File<input type="file" className="hidden" disabled={busy} onChange={e => { const f=e.target.files?.[0]; if(f) void upload(f); e.currentTarget.value=''; }}/></label>
          <button onClick={() => { setDialog({kind:'folder'}); setDialogValue(''); }} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-semibold hover:bg-secondary"><Plus size={15}/> New Folder</button>
          <a href="/new" className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/15"><Plus size={15}/> New Study Kit</a>
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Total Files', mine.length], ['Study Kits', studyKits.length], ['Storage Used', formatBytes(totalBytes)], ['Shared with Me', sharedFiles.length]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-border bg-card p-5"><p className="text-[10px] uppercase tracking-[.16em] text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p></div>)}
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border border-border bg-card p-4">
          <button onClick={() => { setSection('mine'); setSelected(null); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-secondary">
            <FolderOpen size={15} className="text-primary" /> My Files
          </button>
          <button onClick={() => { setSection('shared'); setSelected(null); }} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-secondary">
            <Share2 size={15} className="text-primary" /> Shared with Me
          </button>
          <div className="mt-4 border-t border-border pt-3">{folderTree(null)}</div>
          {quick.length > 0 && <div className="mt-6 border-t border-border pt-4"><p className="px-2 text-[10px] uppercase tracking-[.16em] text-muted-foreground">Quick Access</p>{quick.map(f=><button key={f.id} onClick={()=>{setSection('mine');setSelected(f.id)}} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-secondary"><Pin size={13} className="text-primary"/>{f.name}</button>)}</div>}
        </aside>

        <div className="min-w-0">
          {!selected ? <div>
            <div className="flex items-center justify-between"><div><h2 className="font-serif text-2xl">Recent</h2><p className="mt-1 text-xs text-muted-foreground">Your latest files and study kits</p></div></div>
            {!recentItems.length ? <div className="mt-5 rounded-2xl border border-dashed border-primary/30 bg-card/70 p-12 text-center"><div className="mx-auto flex w-fit items-center gap-2 text-primary"><UploadCloud size={30}/><BookOpen size={30}/></div><h2 className="mt-4 font-serif text-2xl">Nothing here yet</h2><p className="mt-2 text-sm text-muted-foreground">Add a file or create a study kit to get started.</p><div className="mt-5 flex justify-center gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><UploadCloud size={14}/> Upload a file<input type="file" className="hidden" disabled={busy} onChange={e => { const f=e.target.files?.[0]; if(f) void upload(f); e.currentTarget.value=''; }}/></label><a href="/new" className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-semibold hover:bg-secondary"><Plus size={14}/> Create a study kit</a></div></div> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{recentItems.map(item => item.kind === 'file' ? fileCard(item.file) : kitCard(item.kit))}</div>}
            <div className="mt-10"><h2 className="font-serif text-2xl">Quick access</h2>{quick.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{quick.map(f=><button key={f.id} onClick={()=>{setSection('mine');setSelected(f.id)}} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40"><Folder size={20} className="text-primary"/><span className="truncate text-sm font-medium">{f.name}</span></button>)}</div> : <p className="mt-3 text-xs text-muted-foreground">Pin folders from their menu to keep them here.</p>}</div>
          </div> : <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search files by name" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none"/></div><div className="flex rounded-lg border border-border p-1"><button onClick={()=>setView('grid')} className={`rounded-md p-1.5 ${view==='grid'?'bg-secondary':''}`}><Grid2X2 size={15}/></button><button onClick={()=>setView('list')} className={`rounded-md p-1.5 ${view==='list'?'bg-secondary':''}`}><List size={15}/></button></div></div>
            <div className="mt-5 flex items-center justify-between"><h2 className="font-serif text-2xl">{section==='shared'?'Shared with Me':(folders.find(f=>f.id===selected)?.name || 'My Files')}</h2><span className="text-xs text-muted-foreground">{currentFiles.length} files</span></div>
            {selected === studyKitsFolder?.id ? (studyKits.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{studyKits.filter(k => !search || k.title.toLowerCase().includes(search.toLowerCase())).map(kitCard)}</div> : <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No study kits yet.</div>) : currentFiles.length ? <div className={view==='grid'?'mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4':'mt-4 space-y-2'}>{currentFiles.map(fileCard)}</div> : <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No files in this folder.</div>}
          </div>}
        </div>
      </div>

      {modal?.url && <FileViewer file={modal.file} src={modal.url} onClose={() => setModal(null)} />}

      {dialog && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-5"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">{dialog.kind==='folder'?'New Folder':dialog.kind==='rename'?'Rename Folder':'Share with Flexus user'}</h2><button onClick={()=>setDialog(null)}><X size={17}/></button></div>
        {dialog.kind==='share' ? <><input autoFocus value={dialogValue} onChange={e=>void searchUsers(e.target.value)} placeholder="Search by name or email" className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"/><div className="mt-3 space-y-1">{sharedUser.map(u=><button key={u.id} onClick={()=>void share(u)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-secondary"><span><span className="block text-sm">{u.display_name}</span><span className="block text-[10px] text-muted-foreground">{u.email}</span></span><Share2 size={14}/></button>)}</div></> : <><input autoFocus value={dialogValue} onChange={e=>setDialogValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void (dialog.kind==='folder'?createFolder():renameFolder())}} placeholder="Folder name" className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"/><button disabled={busy||!dialogValue.trim()} onClick={()=>void (dialog.kind==='folder'?createFolder():renameFolder())} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{dialog.kind==='folder'?'Create folder':'Save changes'}</button></>}
      </div></div>}
    </div>
  </section>;
}
