import { useEffect, useMemo, useState } from 'react';
import {
  Archive, ChevronDown, ChevronRight, Download, File, FileArchive, FileAudio,
  FileImage, FileText, FileVideo, Folder, FolderOpen, Grid2X2, List, MoreHorizontal,
  Pencil, Pin, Plus, Search, Share2, Trash2, UploadCloud, X
} from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

type FolderRow = { id: string; name: string; parent_folder_id: string | null; owner_id: string; created_at: string };
type FileRow = { id: string; name: string; folder_id: string | null; owner_id: string; storage_path: string; size: number; type: string; created_at: string };
type ShareRow = { id: string; file_id: string | null; folder_id: string | null; shared_with_user_id: string; shared_by_user_id: string; created_at: string };
type UserRow = { id: string; email: string; display_name: string };

const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

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

export default function FilesPage() {
  const me = getStoredUser();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
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
  const [sharedUser, setSharedUser] = useState<UserRow[]>([]);
  const [pinned, setPinned] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('flexus-file-pins') || '[]'); } catch { return []; }
  });

  const load = async () => {
    if (!me) return;
    setError('');
    try {
      const [fs, fl, sh] = await Promise.all([
        api<FolderRow[]>('/rest/v1/folders?select=*&order=name.asc'),
        api<FileRow[]>('/rest/v1/files?select=*&order=created_at.desc'),
        api<ShareRow[]>('/rest/v1/file_shares?select=*'),
      ]);
      setFolders(fs);
      setFiles(fl);
      setShares(sh);
      const root = fs.find(f => f.owner_id === me.id && f.parent_folder_id === null);
      if (!selected && root) setSelected(root.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your files.');
    }
  };

  useEffect(() => { void load(); }, [me?.id]);

  useEffect(() => {
    try { localStorage.setItem('flexus-file-pins', JSON.stringify(pinned)); } catch {}
  }, [pinned]);

  const ensureRoot = async () => {
    if (!me || folders.some(f => f.owner_id === me.id && f.parent_folder_id === null)) return;
    try {
      const created = await api<FolderRow[]>('/rest/v1/folders?select=*', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name: 'My Files', owner_id: me.id, parent_folder_id: null }),
      });
      if (created[0]) { setFolders(prev => [...prev, created[0]]); setSelected(created[0].id); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create My Files.'); }
  };
  useEffect(() => { void ensureRoot(); }, [me?.id, folders.length]);

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
  const visibleFolders = section === 'mine' ? folders.filter(f => f.owner_id === me?.id) : folders.filter(f => sharedFolderIds.has(f.id));
  const visibleFiles = section === 'mine' ? mine : sharedFiles;
  const currentFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleFiles.filter(f => (!selected || f.folder_id === selected) && (!q || f.name.toLowerCase().includes(q)));
  }, [visibleFiles, selected, search]);
  const recent = [...mine].sort((a,b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 5);
  const totalBytes = mine.reduce((n,f) => n + Number(f.size || 0), 0);
  const recentCount = mine.filter(f => Date.now() - +new Date(f.created_at) < 7 * 86400000).length;
  const quick = folders.filter(f => pinned.includes(f.id) && f.owner_id === me?.id);

  const children = (parent: string | null) => visibleFolders.filter(f => f.parent_folder_id === parent);
  const root = folders.find(f => f.owner_id === me?.id && f.parent_folder_id === null);

  const createFolder = async () => {
    if (!me || !dialogValue.trim()) return;
    const parent = section === 'mine' ? (selected || root?.id || null) : null;
    if (!parent && section === 'mine') { await ensureRoot(); return; }
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
    if (!me || !selected) return;
    setBusy(true); setError('');
    const path = `${me.id}/${selected}/${Date.now()}-${safeName(file.name)}`;
    try {
      const storageResponse = await fetch(`${url}/storage/v1/object/user-files/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${getAccessToken()}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
        body: file,
      });
      if (!storageResponse.ok) throw new Error((await storageResponse.text()).slice(0, 300) || 'Upload failed.');
      const created = await api<FileRow[]>('/rest/v1/files?select=*', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name: file.name, folder_id: selected, owner_id: me.id, storage_path: path, size: file.size, type: file.type || 'application/octet-stream' }),
      });
      setFiles(prev => [...created, ...prev]);
    } catch (e) {
      try { await fetch(`${url}/storage/v1/object/user-files/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { apikey: anon, Authorization: `Bearer ${getAccessToken()}` } }); } catch {}
      setError(e instanceof Error ? e.message : 'Could not upload file.');
    } finally { setBusy(false); }
  };

  const download = async (file: FileRow, preview = false) => {
    try {
      const response = await api<{ signedURL: string }>('/storage/v1/object/sign/user-files/' + file.storage_path.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST', body: JSON.stringify({ expiresIn: 600 }),
      });
      const signed = response.signedURL.startsWith('http') ? response.signedURL : `${url}/storage/v1${response.signedURL}`;
      if (preview) setModal({ file, url: signed }); else window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open file.'); }
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

  const fileCard = (file: FileRow) => {
    const Icon = iconFor(file.type, file.name);
    const previewable = file.type.startsWith('image/') || file.type === 'application/pdf' || /\\.(pdf)$/i.test(file.name);
    return <div key={file.id} className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40">
      <button onClick={() => previewable ? void download(file, true) : void download(file)} className="w-full text-left">
        <div className="flex h-24 items-center justify-center rounded-lg bg-secondary/60"><Icon size={34} className="text-primary" /></div>
        <p className="mt-3 truncate text-sm font-medium">{file.name}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{formatBytes(Number(file.size))} · {formatDate(file.created_at)}</p>
      </button>
      <div className="mt-3 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={() => void download(file)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Download"><Download size={14}/></button>
        {file.owner_id === me?.id && <><button onClick={() => { setDialog({ kind:'share', fileId:file.id }); setDialogValue(''); setMenu(null); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" title="Share"><Share2 size={14}/></button><button onClick={() => void deleteFile(file)} className="rounded-md p-1.5 text-red-300 hover:bg-secondary" title="Delete"><Trash2 size={14}/></button></>}
      </div>
    </div>;
  };

  return <section className="px-5 py-8 sm:px-8">
    <div className="mx-auto max-w-[1500px]">
      {error && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">File storage</p><h1 className="mt-3 font-serif text-4xl tracking-[-.04em]">Your Files</h1><p className="mt-2 text-sm text-muted-foreground">Store, organize, and share your files</p></div>
        <div className="flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><UploadCloud size={15}/> Upload File<input type="file" className="hidden" disabled={!selected || busy} onChange={e => { const f=e.target.files?.[0]; if(f) void upload(f); e.currentTarget.value=''; }}/></label>
          <button onClick={() => { setDialog({kind:'folder'}); setDialogValue(''); }} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-semibold hover:bg-secondary"><Plus size={15}/> New Folder</button>
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[['Total Files', mine.length], ['Total Storage Used', formatBytes(totalBytes)], ['Shared with Me', sharedFiles.length], ['Recent Uploads', recentCount]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-border bg-card p-5"><p className="text-[10px] uppercase tracking-[.16em] text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p></div>)}
      </div>

      {!mine.length ? <div className="mt-8 rounded-2xl border border-dashed border-primary/30 bg-card/70 p-10 text-center"><UploadCloud className="mx-auto text-primary" size={34}/><h2 className="mt-4 font-serif text-2xl">Upload your first file</h2><p className="mt-2 text-sm text-muted-foreground">Keep your study materials, documents, images, and more in one place.</p></div> : <div className="mt-8 grid gap-8 xl:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border border-border bg-card p-4">
          <div className="flex gap-1 rounded-lg bg-secondary p-1"><button onClick={()=>setSection('mine')} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${section==='mine'?'bg-card font-medium':''}`}>My Files</button><button onClick={()=>setSection('shared')} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${section==='shared'?'bg-card font-medium':''}`}>Shared with Me</button></div>
          <div className="mt-4">{folderTree(section==='mine' ? null : null)}</div>
          {quick.length > 0 && <div className="mt-6 border-t border-border pt-4"><p className="px-2 text-[10px] uppercase tracking-[.16em] text-muted-foreground">Quick Access</p>{quick.map(f=><button key={f.id} onClick={()=>setSelected(f.id)} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-secondary"><Pin size={13} className="text-primary"/>{f.name}</button>)}</div>}
        </aside>
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search files by name" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none"/></div><div className="flex rounded-lg border border-border p-1"><button onClick={()=>setView('grid')} className={`rounded-md p-1.5 ${view==='grid'?'bg-secondary':''}`}><Grid2X2 size={15}/></button><button onClick={()=>setView('list')} className={`rounded-md p-1.5 ${view==='list'?'bg-secondary':''}`}><List size={15}/></button></div></div>
          <div className="mt-5 flex items-center justify-between"><h2 className="font-serif text-2xl">{section==='shared'?'Shared with Me':(folders.find(f=>f.id===selected)?.name || 'My Files')}</h2><span className="text-xs text-muted-foreground">{currentFiles.length} files</span></div>
          {currentFiles.length ? <div className={view==='grid'?'mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4':'mt-4 divide-y divide-border rounded-xl border border-border bg-card'}>{currentFiles.map(fileCard)}</div> : <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No files in this folder.</div>}

          <div className="mt-10"><h2 className="font-serif text-2xl">Recent Files</h2><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">{recent.map(fileCard)}</div></div>
        </div>
      </div>}

      {modal?.url && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 p-5" onClick={()=>setModal(null)}><div className="relative max-h-[90vh] max-w-5xl overflow-auto rounded-xl border border-border bg-card p-3" onClick={e=>e.stopPropagation()}><button onClick={()=>setModal(null)} className="absolute right-3 top-3 rounded-full bg-background/80 p-2"><X size={16}/></button>{modal.file.type.startsWith('image/')?<img src={modal.url} alt={modal.file.name} className="max-h-[82vh] max-w-full object-contain"/>:<iframe title={modal.file.name} src={modal.url} className="h-[80vh] w-[80vw] min-w-[320px]"/>}</div></div>}

      {dialog && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-5"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="font-serif text-2xl">{dialog.kind==='folder'?'New Folder':dialog.kind==='rename'?'Rename Folder':'Share with Flexus user'}</h2><button onClick={()=>setDialog(null)}><X size={17}/></button></div>
        {dialog.kind==='share' ? <><input autoFocus value={dialogValue} onChange={e=>void searchUsers(e.target.value)} placeholder="Search by name or email" className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"/><div className="mt-3 space-y-1">{sharedUser.map(u=><button key={u.id} onClick={()=>void share(u)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-secondary"><span><span className="block text-sm">{u.display_name}</span><span className="block text-[10px] text-muted-foreground">{u.email}</span></span><Share2 size={14}/></button>)}</div></> : <><input autoFocus value={dialogValue} onChange={e=>setDialogValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') void (dialog.kind==='folder'?createFolder():renameFolder())}} placeholder="Folder name" className="mt-5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"/><button disabled={busy||!dialogValue.trim()} onClick={()=>void (dialog.kind==='folder'?createFolder():renameFolder())} className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{dialog.kind==='folder'?'Create folder':'Save changes'}</button></>}
      </div></div>}
    </div>
  </section>;
}
