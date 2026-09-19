import { useEffect, useRef, useState } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { ArrowLeft, Check, Link as LinkIcon, Save, X } from 'lucide-react';
import { getAccessToken } from '@/lib/auth';

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
              const image = window.prompt('Enter an image URL');
              if (image) this.quill.insertEmbed(this.quill.getSelection()?.index || 0, 'image', image, 'user');
            },
          },
        },
      },
    });

    const initial = document?.content;
    if (initial && Array.isArray(initial.ops)) editor.setContents(initial);
    else editor.setContents({ ops: [{ insert: '\n' }] });

    editor.on('text-change', () => {
      setWords(wordCount(editor.getText()));
      setStatus('Saving...');
    });
    setWords(wordCount(editor.getText()));
    quill.current = editor;

    return () => {
      quill.current = null;
    };
  }, [ready, document?.id]);

  const applyFontSize = (value: string) => {
    const size = Math.max(5, Math.min(100, Number.parseInt(value, 10) || 16));
    const editor = quill.current;
    if (!editor) return;
    const range = sizeSelection.current || editor.getSelection();
    if (!range) return;
    editor.setSelection(range.index, range.length, 'silent');
    editor.format('size', `${size}px`, 'user');
    sizeSelection.current = range;
  };

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
            defaultValue="16"
            list="document-size-options"
            aria-label="Font size"
            onMouseDown={() => { sizeSelection.current = quill.current?.getSelection() || null; }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyFontSize(e.currentTarget.value);
                e.currentTarget.blur();
              }
            }}
            onChange={e => applyFontSize(e.currentTarget.value)}
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
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-zinc-700 px-4 py-8 sm:px-8">
        <div className="mx-auto h-[1056px] w-[816px] shrink-0 bg-white shadow-xl">
          <div ref={editorHost} className="h-full w-full" />
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center justify-end border-t border-black/10 bg-white px-6 text-[11px] text-slate-500">{words} {words === 1 ? 'word' : 'words'}</div>
    </div>
  );
}
