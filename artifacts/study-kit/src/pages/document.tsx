import { useEffect, useRef, useState } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { ArrowLeft, Check, Link as LinkIcon, Save, X } from 'lucide-react';
import { getAccessToken, getStoredUser } from '@/lib/auth';

type DocumentRow = {
  id: string;
  title: string;
  content: any;
  owner_id: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
};

const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

async function uploadDocumentImage(file: File, documentId: string) {
  if (!IMAGE_TYPES.has(file.type)) throw new Error('Please choose a JPG, PNG, GIF, or WebP image.');
  const token = getAccessToken();
  const user = getStoredUser();
  if (!token || !user?.id || !url || !anon) throw new Error('Image storage is not configured.');
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  const path = user.id + '/documents/' + documentId + '/' + crypto.randomUUID() + '.' + ext;

  const upload = await fetch(url + '/storage/v1/object/user-files/' + path, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': file.type, 'x-upsert': 'false' },
    body: file,
  });
  if (!upload.ok) throw new Error((await upload.text()) || 'Could not upload image.');

  const signed = await fetch(url + '/storage/v1/object/sign/user-files/' + path, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 31536000 }),
  });
  const data = await signed.json().catch(() => ({}));
  if (!signed.ok || !data?.signedURL) throw new Error(data?.message || 'Could not create an image URL.');
  return String(data.signedURL).startsWith('http') ? data.signedURL : url + '/storage/v1' + data.signedURL;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  if (!token || !url || !anon) throw new Error('Document storage is not configured.');
  const response = await fetch(url + path, {
    ...init,
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  let data: any = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!response.ok) {
    throw new Error(typeof data === 'object' && data ? String(data.message || data.details || 'Request failed') : 'Request failed');
  }
  return data as T;
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export default function DocumentPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const editorHost = useRef<HTMLDivElement | null>(null);
  const quill = useRef<Quill | null>(null);
  const sizeSelection = useRef<{ index: number; length: number } | null>(null);
  const imageFileInput = useRef<HTMLInputElement | null>(null);
  const selectedImage = useRef<HTMLImageElement | null>(null);
  const [selectedImageBox, setSelectedImageBox] = useState<{left:number;top:number;width:number;height:number} | null>(null);
  const [fontSizeValue, setFontSizeValue] = useState('16');
  const resizeState = useRef<{direction:string;startX:number;startY:number;startWidth:number;startHeight:number} | null>(null);
  const [document, setDocument] = useState<DocumentRow | null>(null);
  const [title, setTitle] = useState('Untitled Document');
  const [editingTitle, setEditingTitle] = useState(false);
  const [status, setStatus] = useState<'Loading...' | 'Saving...' | 'Saved' | 'Error'>('Loading...');
  const [words, setWords] = useState(0);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<DocumentRow[]>('/rest/v1/documents?id=eq.' + encodeURIComponent(id) + '&select=*')
      .then(rows => {
        if (cancelled || !rows[0]) throw new Error('Document not found.');
        const doc = rows[0];
        setDocument(doc);
        setTitle(doc.title || 'Untitled Document');
        setStatus('Saved');
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setStatus('Error');
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!ready || !editorHost.current || quill.current) return;

    const Font = Quill.import('formats/font') as any;
    Font.whitelist = ['sans-serif', 'serif', 'monospace', 'arial', 'georgia', 'times-new-roman', 'courier-new'];
    Quill.register(Font, true);

    const Size = Quill.import('attributors/style/size') as any;
    Size.whitelist = Array.from({ length: 96 }, (_, index) => `${index + 5}px`);
    Quill.register(Size, true);

    const BaseImage = Quill.import('formats/image') as any;
    class DocumentImage extends BaseImage {
      static blotName = 'image';
      static create(value: any) {
        const node = super.create(typeof value === 'string' ? value : value?.url || '');
        if (value && typeof value === 'object') {
          if (value.width) node.style.width = value.width;
          if (value.height) node.style.height = value.height;
        }
        node.style.maxWidth = '100%';
        node.setAttribute('draggable', 'true');
        return node;
      }
      static value(node: HTMLImageElement) {
        return { url: node.getAttribute('src') || '', width: node.style.width || null, height: node.style.height || null };
      }
    }
    Quill.register(DocumentImage, true);

    const editor = new Quill(editorHost.current, {
      theme: 'snow',
      placeholder: 'Start writing…',
      modules: {
        toolbar: {
          container: '#document-toolbar',
          handlers: {
            link: function(this: any, value: boolean) {
              if (!value) return this.quill.format('link', false);
              const link = window.prompt('Enter a URL');
              if (link) this.quill.format('link', link);
            },
            image: function(this: any) {
              const image = window.prompt('Enter an image URL. To upload from your device, use the Upload Image button next to the toolbar.');
              if (image) {
                const index = this.quill.getSelection()?.index || 0;
                this.quill.insertEmbed(index, 'image', image.trim(), 'user');
                this.quill.setSelection(index + 1, 0, 'silent');
              }
            },
          },
        },
      },
    });

    const initial = document?.content;
    if (initial && Array.isArray(initial.ops)) editor.setContents(initial);
    else editor.setContents({ ops: [{ insert: '\n' }] });

    const refreshImageBox = () => {
      const image = selectedImage.current;
      const host = editorHost.current;
      if (!image || !host || !host.contains(image)) {
        selectedImage.current = null;
        setSelectedImageBox(null);
        return;
      }
      const a = image.getBoundingClientRect();
      const b = host.getBoundingClientRect();
      setSelectedImageBox({ left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height });
    };
    const onClick = (event: MouseEvent) => {
      const image = (event.target as HTMLElement | null)?.closest('img') as HTMLImageElement | null;
      if (image) {
        event.preventDefault();
        selectedImage.current = image;
        refreshImageBox();
      } else {
        selectedImage.current = null;
        setSelectedImageBox(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedImage.current || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      event.preventDefault();
      const blot = Quill.find(selectedImage.current);
      if (blot) editor.deleteText(blot.offset(editor), 1, 'user');
      selectedImage.current = null;
      setSelectedImageBox(null);
    };
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items || []).find(i => IMAGE_TYPES.has(i.type));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void insertImageFile(file);
    };
    editor.root.addEventListener('click', onClick);
    editor.root.addEventListener('keydown', onKeyDown);
    editor.root.addEventListener('paste', onPaste);
    window.addEventListener('resize', refreshImageBox);
    editor.on('text-change', () => {
      setWords(wordCount(editor.getText()));
      setStatus('Saving...');
      window.setTimeout(refreshImageBox, 0);
    });
    setWords(wordCount(editor.getText()));
    quill.current = editor;

    return () => {
      editor.root.removeEventListener('click', onClick);
      editor.root.removeEventListener('keydown', onKeyDown);
      editor.root.removeEventListener('paste', onPaste);
      window.removeEventListener('resize', refreshImageBox);
      quill.current = null;
    };
  }, [ready, document?.id]);

  const applyFontSize = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const size = Math.max(5, Math.min(100, parsed));
    setFontSizeValue(String(size));
    const editor = quill.current;
    if (!editor) return;
    const range = sizeSelection.current || editor.getSelection();
    if (!range) return;
    editor.setSelection(range.index, range.length, 'silent');
    editor.format('size', `${size}px`, 'user');
    sizeSelection.current = range;
  };

  const insertImageFile = async (file: File) => {
    if (!quill.current || !document) return;
    try {
      const imageUrl = await uploadDocumentImage(file, document.id);
      const editor = quill.current;
      const index = editor.getSelection()?.index || editor.getLength() - 1;
      editor.insertEmbed(index, 'image', imageUrl, 'user');
      editor.setSelection(index + 1, 0, 'silent');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not insert image.');
    }
  };

  const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void insertImageFile(file);
  };

  const startResize = (event: React.PointerEvent, direction: string) => {
    event.preventDefault();
    event.stopPropagation();
    const image = selectedImage.current;
    if (!image) return;
    resizeState.current = {
      direction, startX: event.clientX, startY: event.clientY,
      startWidth: image.getBoundingClientRect().width,
      startHeight: image.getBoundingClientRect().height,
    };
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const state = resizeState.current;
      const image = selectedImage.current;
      if (!state || !image) return;
      const ratio = state.startWidth / Math.max(1, state.startHeight);
      let width = state.startWidth;
      let height = state.startHeight;
      if (state.direction.includes('e')) width = Math.max(40, state.startWidth + event.clientX - state.startX);
      if (state.direction.includes('w')) width = Math.max(40, state.startWidth - event.clientX + state.startX);
      if (state.direction.includes('s')) height = Math.max(40, state.startHeight + event.clientY - state.startY);
      if (state.direction.includes('n')) height = Math.max(40, state.startHeight - event.clientY + state.startY);
      if (state.direction.includes('e') || state.direction.includes('w')) height = width / ratio;
      else width = height * ratio;
      image.style.width = Math.round(width) + 'px';
      image.style.height = Math.round(height) + 'px';
      const host = editorHost.current;
      if (host) {
        const a = image.getBoundingClientRect(), b = host.getBoundingClientRect();
        setSelectedImageBox({ left:a.left-b.left, top:a.top-b.top, width:a.width, height:a.height });
      }
    };
    const up = () => { resizeState.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const save = async () => {
    if (!quill.current || !document) return;
    setStatus('Saving...');
    try {
      const content = quill.current.getContents();
      const updated = await api<DocumentRow[]>('/rest/v1/documents?id=eq.' + encodeURIComponent(document.id) + '&select=*', {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ title: title.trim() || 'Untitled Document', content, updated_at: new Date().toISOString() }),
      });
      if (updated[0]) setDocument(updated[0]);
      setStatus('Saved');
    } catch {
      setStatus('Error');
    }
  };

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => void save(), 30000);
    saveTimer.current = timer;
    return () => {
      window.clearInterval(timer);
      saveTimer.current = null;
    };
  }, [ready, document?.id, title]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (status === 'Saving...') event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  const updateTitle = async () => {
    setEditingTitle(false);
    const next = title.trim() || 'Untitled Document';
    setTitle(next);
    if (!document) return;
    try {
      await api('/rest/v1/documents?id=eq.' + encodeURIComponent(document.id), {
        method: 'PATCH',
        body: JSON.stringify({ title: next, updated_at: new Date().toISOString() }),
      });
      setStatus('Saved');
    } catch {
      setStatus('Error');
    }
  };

  if (status === 'Error' && !document) {
    return <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-zinc-950 text-white"><div className="text-center"><p className="text-lg">Could not open this document.</p><button onClick={() => window.location.assign('/files')} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm">Back to Files</button></div></div>;
  }

  return (
    <div className="fixed inset-0 z-[10000] flex h-[100dvh] w-[100vw] flex-col bg-zinc-900 text-slate-900">
      <style>{`
        .doc-toolbar .ql-picker.ql-font .ql-picker-label[data-value="arial"]::before, .doc-toolbar .ql-picker.ql-font .ql-picker-item[data-value="arial"]::before { content: "Arial"; }
        .doc-toolbar .ql-picker.ql-font .ql-picker-label[data-value="georgia"]::before, .doc-toolbar .ql-picker.ql-font .ql-picker-item[data-value="georgia"]::before { content: "Georgia"; }
        .doc-toolbar .ql-picker.ql-font .ql-picker-label[data-value="times-new-roman"]::before, .doc-toolbar .ql-picker.ql-font .ql-picker-item[data-value="times-new-roman"]::before { content: "Times New Roman"; }
        .doc-toolbar .ql-picker.ql-font .ql-picker-label[data-value="courier-new"]::before, .doc-toolbar .ql-picker.ql-font .ql-picker-item[data-value="courier-new"]::before { content: "Courier New"; }
        .ql-font-arial { font-family: Arial, sans-serif; }
        .ql-font-georgia { font-family: Georgia, serif; }
        .ql-font-times-new-roman { font-family: "Times New Roman", serif; }
        .ql-font-courier-new { font-family: "Courier New", monospace; }
        .document-size-input { width: 54px; height: 24px; border: 1px solid #d4d4d8; border-radius: 4px; background: white; color: #18181b; padding: 0 5px; font-size: 12px; text-align: center; }
        .document-size-input:focus { outline: 2px solid #a1a1aa; outline-offset: 1px; }
        .ql-editor { box-sizing: border-box; width: 816px; min-height: 1056px; padding: 96px; font-size: 16px; line-height: 1.7; }
        .ql-container.ql-snow { border: 0; }
        .ql-toolbar.ql-snow { border: 0; }
      `}</style>

      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950 px-4 text-white">
        <button onClick={() => { void save(); window.location.assign('/files'); }} className="rounded-lg p-2 hover:bg-white/10" aria-label="Back to Files"><ArrowLeft size={18}/></button>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input autoFocus value={title} onChange={e=>setTitle(e.target.value)} onBlur={()=>void updateTitle()} onKeyDown={e=>{if(e.key==='Enter') void updateTitle(); if(e.key==='Escape'){setEditingTitle(false); setTitle(document?.title || 'Untitled Document');}}} className="h-8 w-full max-w-xl rounded border border-white/20 bg-white/10 px-2 text-sm text-white outline-none" />
          ) : (
            <button onClick={()=>setEditingTitle(true)} className="max-w-xl truncate text-left text-sm font-medium hover:underline">{title}</button>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-white/60">{status === 'Saved' ? <Check size={14}/> : status === 'Saving...' ? <Save size={14}/> : null}<span>{status}</span></div>
        <button onClick={() => void save()} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs hover:bg-white/10">Save</button>
      </div>

      <div id="document-toolbar" className="doc-toolbar shrink-0 bg-white px-3 py-1 shadow-sm">
        <span className="ql-formats">
          <select className="ql-font"><option value="sans-serif">Sans Serif</option><option value="serif">Serif</option><option value="monospace">Monospace</option><option value="arial">Arial</option><option value="georgia">Georgia</option><option value="times-new-roman">Times New Roman</option><option value="courier-new">Courier New</option></select>
          <input
            className="document-size-input"
            type="number"
            min="5"
            max="100"
            step="1"
            value={fontSizeValue}
            list="document-size-options"
            aria-label="Font size"
            onFocus={() => { sizeSelection.current = quill.current?.getSelection() || null; }}
            onChange={e => setFontSizeValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyFontSize(e.currentTarget.value);
                e.currentTarget.blur();
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                window.setTimeout(() => applyFontSize(e.currentTarget.value), 0);
              }
            }}
            onBlur={e => applyFontSize(e.currentTarget.value)}
          />
          <datalist id="document-size-options">
            <option value="5"/><option value="6"/><option value="7"/><option value="8"/><option value="9"/>
            <option value="10"/><option value="11"/><option value="12"/><option value="14"/><option value="16"/>
            <option value="18"/><option value="20"/><option value="24"/><option value="28"/><option value="32"/>
            <option value="36"/><option value="40"/><option value="48"/><option value="56"/><option value="64"/>
            <option value="72"/><option value="80"/><option value="96"/><option value="100"/>
          </datalist>
        </span>
        <span className="ql-formats">
          <button className="ql-bold"/><button className="ql-italic"/><button className="ql-underline"/><button className="ql-strike"/>
        </span>
        <span className="ql-formats">
          <select className="ql-color"/><select className="ql-background"/>
        </span>
        <span className="ql-formats">
          <select className="ql-align"><option value="center"/><option value="right"/><option value="justify"/></select>
          <button className="ql-list" value="ordered"/><button className="ql-list" value="bullet"/>
          <button className="ql-indent" value="-1"/><button className="ql-indent" value="+1"/>
        </span>
        <span className="ql-formats">
          <button className="ql-link"/><button className="ql-image"/>
          <button type="button" onClick={() => imageFileInput.current?.click()} title="Upload Image" className="ml-1 rounded px-2 text-xs hover:bg-zinc-100">Upload Image</button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-zinc-700 px-4 py-8 sm:px-8">
        <div className="mx-auto h-[1056px] w-[816px] shrink-0 bg-white shadow-xl">
          <div ref={editorHost} className="relative h-full w-full">
            {selectedImageBox && (
              <div className="pointer-events-none absolute z-20 border-2 border-blue-500" style={{left:selectedImageBox.left,top:selectedImageBox.top,width:selectedImageBox.width,height:selectedImageBox.height}}>
                {['nw','ne','sw','se'].map(direction => {
                  const pos = direction === 'nw' ? 'left-[-5px] top-[-5px]' : direction === 'ne' ? 'right-[-5px] top-[-5px]' : direction === 'sw' ? 'left-[-5px] bottom-[-5px]' : 'right-[-5px] bottom-[-5px]';
                  const cursor = direction === 'nw' || direction === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';
                  return <button key={direction} type="button" className={`pointer-events-auto absolute h-2.5 w-2.5 rounded-sm border border-blue-600 bg-white ${pos} ${cursor}`} onPointerDown={e => startResize(e, direction)} />;
                })}
              </div>
            )}
          </div>
          <input ref={imageFileInput} type="file" accept=".jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={handleImageFileChange} />
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center justify-end border-t border-black/10 bg-white px-6 text-[11px] text-slate-500">{words} {words === 1 ? 'word' : 'words'}</div>
    </div>
  );
}
