import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle, Save } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getAccessToken, getStoredUser } from '@/lib/auth';
import '@excalidraw/excalidraw/index.css';

const Excalidraw = lazy(async () => {
  const module = await import('@excalidraw/excalidraw');
  return { default: module.Excalidraw };
});

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type FileForAnnotation = {
  id: string;
  name: string;
  type: string;
};

type Scene = {
  elements: any[];
  appState: Record<string, any>;
  files: Record<string, any>;
};

type AnnotationRow = {
  id: string;
  file_id: string;
  owner_id: string;
  data: { pages?: Record<string, Scene> } | null;
};

const emptyScene = (): Scene => ({
  elements: [],
  appState: { viewBackgroundColor: 'transparent' },
  files: {},
});

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  if (!supabaseUrl || !supabaseAnon || !token) {
    throw new Error('You must be signed in to annotate files.');
  }
  const response = await fetch(supabaseUrl + path, {
    ...init,
    headers: {
      apikey: supabaseAnon,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw new Error(String(data?.message || data?.details || `Request failed (${response.status})`));
  }
  return data as T;
}

function isPdf(file: FileForAnnotation) {
  return file.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file.name);
}

function isImage(file: FileForAnnotation) {
  return file.type.toLowerCase().startsWith('image/');
}

function isTextFile(file: FileForAnnotation) {
  return file.type.toLowerCase().startsWith('text/') || /\.(txt|md|csv|log)$/i.test(file.name);
}

export default function FileAnnotationViewer({
  file,
  src,
  onBack,
  onSaved,
}: {
  file: FileForAnnotation;
  src: string;
  onBack: () => void;
  onSaved: (fileId: string) => void;
}) {
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [pageScenes, setPageScenes] = useState<Record<string, Scene>>({});
  const scenesRef = useRef<Record<string, Scene>>({});
  const [pdfCanvases, setPdfCanvases] = useState<HTMLCanvasElement[]>([]);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [textPageLoading, setTextPageLoading] = useState(false);
  const pageKey = String(pageNumber);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const rows = await api<AnnotationRow[]>(
          `/rest/v1/annotations?select=id,file_id,owner_id,data&file_id=eq.${encodeURIComponent(file.id)}&limit=1`,
        );
        if (cancelled) return;
        const row = rows[0] || null;
        const savedPages = row?.data?.pages && typeof row.data.pages === 'object' ? row.data.pages : {};
        const normalized: Record<string, Scene> = {};
        Object.entries(savedPages).forEach(([key, scene]) => {
          if (scene && typeof scene === 'object') {
            normalized[key] = {
              elements: Array.isArray(scene.elements) ? scene.elements : [],
              appState: { ...(scene.appState || {}), viewBackgroundColor: 'transparent' },
              files: scene.files && typeof scene.files === 'object' ? scene.files : {},
            };
          }
        });
        scenesRef.current = normalized;
        setPageScenes(normalized);
        setAnnotationId(row?.id || null);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load annotations.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file.id]);

  useEffect(() => {
    let cancelled = false;
    setPdfCanvases([]);
    if (!isPdf(file)) return;
    void (async () => {
      try {
        const pdf = await pdfjsLib.getDocument(src).promise;
        const rendered: HTMLCanvasElement[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not create a PDF page canvas.');
          await page.render({ canvasContext: context, viewport }).promise;
          rendered.push(canvas);
        }
        if (!cancelled) setPdfCanvases(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not render this PDF.');
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, file.name, file.type, src]);

  useEffect(() => {
    let cancelled = false;
    if (!isTextFile(file)) {
      setTextContent('');
      return;
    }
    setTextPageLoading(true);
    void fetch(src).then(async response => {
      if (!response.ok) throw new Error('Could not load the text file.');
      return response.text();
    }).then(text => {
      if (!cancelled) setTextContent(text.slice(0, 120000));
    }).catch(e => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Could not preview this text file.');
    }).finally(() => {
      if (!cancelled) setTextPageLoading(false);
    });
    return () => { cancelled = true; };
  }, [file.id, file.name, file.type, src]);

  const handleChange = useCallback((pageKey: string, elements: readonly any[], appState: any, files: any) => {
    if (!loaded) return;
    const scene: Scene = {
      elements: elements as any[],
      appState: { viewBackgroundColor: 'transparent', gridSize: appState.gridSize ?? null },
      files: files || {},
    };
    scenesRef.current = { ...scenesRef.current, [pageKey]: scene };
  }, [loaded]);

  const initialData = useMemo(() => {
    const scene = pageScenes[pageKey] || emptyScene();
    return {
      elements: scene.elements,
      appState: { ...scene.appState, viewBackgroundColor: 'transparent' },
      files: scene.files,
    };
  }, [pageScenes, pageKey]);

  const save = async () => {
    if (!loaded) return;
    setSaving(true);
    setError('');
    try {
      const user = getStoredUser();
      if (!user?.id) throw new Error('You must be signed in to save annotations.');
      const payload = {
        file_id: file.id,
        owner_id: user.id,
        data: { version: 1, pages: scenesRef.current },
        updated_at: new Date().toISOString(),
      };
      if (annotationId) {
        await api(`/rest/v1/annotations?id=eq.${encodeURIComponent(annotationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ data: payload.data, updated_at: payload.updated_at }),
          headers: { Prefer: 'return=minimal' },
        });
      } else {
        const created = await api<AnnotationRow[]>('/rest/v1/annotations?select=id', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { Prefer: 'return=representation' },
        });
        if (!created[0]?.id) throw new Error('Annotation was saved without a returned record.');
        setAnnotationId(created[0].id);
      }
      onSaved(file.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save annotations.');
    } finally {
      setSaving(false);
    }
  };

  const pdf = isPdf(file);
  const image = isImage(file);
  const textFile = isTextFile(file);
  const pageCount = pdf ? pdfCanvases.length : 1;

  const renderAnnotationLayer = (pageKey: string) => {
    const scene = pageScenes[pageKey] || emptyScene();
    const initialData = { elements: scene.elements, appState: { ...scene.appState, viewBackgroundColor: 'transparent' }, files: scene.files };
    return loaded ? (
      <div className="file-annotation-excalidraw" data-annotation-mode="true" data-page={pageKey}>
        <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-black/60">Loading drawing tools…</div>}>
          <Excalidraw key={pageKey} theme="light" initialData={initialData}
            onChange={(elements, appState, files) => handleChange(pageKey, elements, appState, files)} />
        </Suspense>
      </div>
    ) : null;
  };

  return (
    <div className="fixed inset-0 z-[10001] flex h-[100dvh] w-[100vw] flex-col overflow-hidden bg-[#181818] text-white">
      <style>{`
        .file-annotation-excalidraw,
        .file-annotation-excalidraw .excalidraw,
        .file-annotation-excalidraw .App,
        .file-annotation-excalidraw .layer-ui__wrapper,
        .file-annotation-excalidraw .Island { background: transparent !important; }
        .file-annotation-excalidraw .excalidraw__canvas,
        .file-annotation-excalidraw canvas { background: transparent !important; }
        .file-annotation-page {
          position: relative; display: block; width: fit-content;
          max-width: calc(100vw - 190px); margin: 0 auto; overflow: visible;
          background: white; box-shadow: 0 8px 30px rgba(0,0,0,.35);
        }
        .file-annotation-page > img,
        .file-annotation-page > canvas,
        .file-annotation-page > pre {
          display: block; max-width: calc(100vw - 190px); width: auto; height: auto;
        }
        .file-annotation-page > img { max-height: none; object-fit: contain; }
        .file-annotation-excalidraw { position: absolute; inset: 0; z-index: 2; pointer-events: all; }
        .file-annotation-excalidraw[data-annotation-mode="false"] { pointer-events: none; }
        .file-annotation-excalidraw .excalidraw,
        .file-annotation-excalidraw .App { width: 100%; height: 100%; background: transparent !important; }
        .file-annotation-excalidraw .App-toolbar {
          position: fixed !important; left: 12px !important; top: 50% !important;
          transform: translateY(-50%) !important; z-index: 10020 !important;
          max-height: calc(100dvh - 150px); overflow-y: auto;
        }
        .file-annotation-excalidraw .undo-redo-buttons {
          position: fixed !important; right: 12px !important; top: 50% !important;
          transform: translateY(-50%) !important; z-index: 10020 !important;
          display: flex !important; flex-direction: column !important;
        }
        .file-annotation-excalidraw .layer-ui__wrapper__top-right {
          position: fixed !important; right: 12px !important; top: calc(50% + 90px) !important;
          z-index: 10020 !important;
        }
        .file-annotation-pages { display: flex; flex-direction: column; align-items: stretch; gap: 20px; min-width: 0; padding: 20px 0 40px; }
        .file-annotation-page:not(:first-child) .App-toolbar,
        .file-annotation-page:not(:first-child) .undo-redo-buttons,
        .file-annotation-page:not(:first-child) .layer-ui__wrapper__top-right { display: none !important; }
        @media (max-width: 640px) {
          .file-annotation-page { max-width: calc(100vw - 112px); }
          .file-annotation-page > img, .file-annotation-page > canvas, .file-annotation-page > pre { max-width: calc(100vw - 112px); }
        }
      `}</style>
      <header className="relative z-30 flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#202020] px-3 py-2 sm:px-5">
        <button type="button" onClick={onBack} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm hover:bg-white/10" aria-label="Back to file viewer"><ChevronLeft size={18}/> <span>Back</span></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <p className="text-[10px] text-white/55">{pdf ? `${pageCount} pages · scroll to navigate` : 'Annotation layer'}</p>
        </div>
        <button type="button" onClick={() => void save()} disabled={!loaded || saving || loading || (pdf && pdfCanvases.length === 0)} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4">
          {saving ? <LoaderCircle size={15} className="animate-spin"/> : <Save size={15}/>} {saving ? 'Saving…' : 'Save Annotation'}
        </button>
      </header>
      <main className="relative min-h-0 flex-1 overflow-auto bg-[#303030] px-2 sm:px-4">
        {loading || (pdf && pdfCanvases.length === 0) || (textFile && textPageLoading) ? (
          <div className="flex min-h-full items-center justify-center gap-2 text-sm text-white/60"><LoaderCircle size={18} className="animate-spin"/> Loading file and annotations…</div>
        ) : error && !loaded ? (
          <div className="mx-auto mt-10 max-w-xl rounded-xl border border-red-300/20 bg-red-950/40 p-5 text-sm text-red-100">{error}</div>
        ) : (
          <div className="file-annotation-pages">
            {pdf && pdfCanvases.map((canvas, index) => {
              const pageKey = String(index + 1);
              return <section key={pageKey} className="file-annotation-page">
                <canvas aria-label={`${file.name} page ${index + 1}`} width={canvas.width} height={canvas.height}
                  ref={node => { if (!node) return; const context = node.getContext('2d'); if (context) context.drawImage(canvas, 0, 0); }} />
                {renderAnnotationLayer(pageKey)}
              </section>;
            })}
            {image && <section className="file-annotation-page"><img src={src} alt={file.name}/>{renderAnnotationLayer('1')}</section>}
            {textFile && <section className="file-annotation-page"><pre className="m-0 w-full whitespace-pre-wrap break-words p-8 font-mono text-sm text-black">{textContent}</pre>{renderAnnotationLayer('1')}</section>}
            {!pdf && !image && !textFile && <section className="file-annotation-page">
              <div className="flex min-h-[360px] w-[min(900px,calc(100vw-190px))] items-center justify-center bg-white p-8 text-center text-sm text-zinc-700">
                <div><p className="font-semibold">{file.name}</p><p className="mt-2">This file type cannot be previewed in Flexus yet. You can still add notes on this canvas.</p></div>
              </div>
              {renderAnnotationLayer('1')}
            </section>}
          </div>
        )}
      </main>
      {error && loaded && <div role="alert" className="relative z-30 shrink-0 border-t border-red-300/20 bg-red-950/50 px-4 py-2 text-xs text-red-100">{error}</div>}
    </div>
  );
}
