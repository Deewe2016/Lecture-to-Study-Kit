import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Save } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getAccessToken } from '@/lib/auth';
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
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [pdfCanvas, setPdfCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
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
    setPdfCanvas(null);
    setPageCount(1);
    if (!isPdf(file)) return;
    void (async () => {
      try {
        const pdf = await pdfjsLib.getDocument(src).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages));
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create the PDF page canvas.');
        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) setPdfCanvas(canvas);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not render this PDF page.');
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, file.name, file.type, src, pageNumber]);

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

  const handleChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    if (!loaded) return;
    const scene: Scene = {
      elements: elements as any[],
      appState: {
        viewBackgroundColor: 'transparent',
        gridSize: appState.gridSize ?? null,
      },
      files: files || {},
    };
    const next = { ...scenesRef.current, [pageKey]: scene };
    scenesRef.current = next;
    setPageScenes(next);
  }, [loaded, pageKey]);

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
      const payload = {
        file_id: file.id,
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
  const canNavigatePages = pdf && pageCount > 1;

  return (
    <div className="fixed inset-0 z-[10001] flex h-[100dvh] w-[100vw] flex-col overflow-hidden bg-[#181818] text-white">
      <style>{`
        .file-annotation-excalidraw,
        .file-annotation-excalidraw .excalidraw,
        .file-annotation-excalidraw .App,
        .file-annotation-excalidraw .layer-ui__wrapper,
        .file-annotation-excalidraw .Island {
          background: transparent !important;
        }
        .file-annotation-excalidraw .excalidraw__canvas,
        .file-annotation-excalidraw canvas {
          background: transparent !important;
        }
        .file-annotation-excalidraw .App-menu_top {
          background: transparent !important;
        }
        .file-annotation-page {
          position: relative;
          display: inline-block;
          max-width: calc(100vw - 32px);
          max-height: calc(100dvh - 150px);
          overflow: hidden;
          background: white;
          box-shadow: 0 8px 30px rgba(0,0,0,.35);
        }
        .file-annotation-page > img,
        .file-annotation-page > canvas {
          display: block;
          max-width: calc(100vw - 32px);
          max-height: calc(100dvh - 150px);
          width: auto;
          height: auto;
          object-fit: contain;
        }
        .file-annotation-excalidraw {
          position: absolute;
          inset: 0;
          z-index: 2;
        }
        .file-annotation-excalidraw .excalidraw,
        .file-annotation-excalidraw .App {
          width: 100%;
          height: 100%;
        }
      `}</style>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#202020] px-3 py-2 sm:px-5">
        <button type="button" onClick={onBack} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm hover:bg-white/10" aria-label="Back to file viewer">
          <ChevronLeft size={18}/> <span>Back</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <p className="text-[10px] text-white/55">{pdf ? `Page ${pageNumber} of ${pageCount}` : 'Annotation layer'}</p>
        </div>
        <button type="button" onClick={() => void save()} disabled={!loaded || saving || loading} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4">
          {saving ? <LoaderCircle size={15} className="animate-spin"/> : <Save size={15}/>}
          {saving ? 'Saving…' : 'Save Annotation'}
        </button>
      </header>
      {canNavigatePages && <div className="flex shrink-0 items-center justify-center gap-4 border-b border-white/10 bg-[#202020] px-3 py-2">
        <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber(p => Math.max(1, p - 1))} className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30" aria-label="Previous PDF page"><ChevronLeft size={18}/></button>
        <span className="text-xs text-white/75">Page {pageNumber} / {pageCount}</span>
        <button type="button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))} className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30" aria-label="Next PDF page"><ChevronRight size={18}/></button>
      </div>}
      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#303030] p-4">
        {loading || (pdf && !pdfCanvas) || (textFile && textPageLoading) ? (
          <div className="flex items-center gap-2 text-sm text-white/60"><LoaderCircle size={18} className="animate-spin"/> Loading file and annotations…</div>
        ) : error && !loaded ? (
          <div className="max-w-xl rounded-xl border border-red-300/20 bg-red-950/40 p-5 text-sm text-red-100">{error}</div>
        ) : (
          <div className="file-annotation-page">
            {pdf && pdfCanvas && <canvas width={pdfCanvas.width} height={pdfCanvas.height} ref={node => {
              if (!node || !pdfCanvas) return;
              const context = node.getContext('2d');
              if (context) context.drawImage(pdfCanvas, 0, 0);
            }}/>}
            {image && <img src={src} alt={file.name} onLoad={event => setImageDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}/>}
            {textFile && <pre className="m-0 max-h-[calc(100dvh-150px)] w-[min(900px,calc(100vw-32px))] overflow-auto whitespace-pre-wrap break-words p-10 font-mono text-sm text-black">{textContent}</pre>}
            {!pdf && !image && !textFile && <div className="flex min-h-[360px] w-[min(900px,calc(100vw-32px))] items-center justify-center bg-white p-8 text-center text-sm text-zinc-700"><div><p className="font-semibold">{file.name}</p><p className="mt-2">This file type cannot be previewed in Flexus yet. You can still add notes on this canvas.</p></div></div>}
            {loaded && <div className="file-annotation-excalidraw">
              <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-black/60">Loading drawing tools…</div>}>
                <Excalidraw key={pageKey} theme="light" initialData={initialData} onChange={handleChange} />
              </Suspense>
            </div>}
          </div>
        )}
      </main>
      {error && loaded && <div role="alert" className="shrink-0 border-t border-red-300/20 bg-red-950/50 px-4 py-2 text-xs text-red-100">{error}</div>}
    </div>
  );
}
