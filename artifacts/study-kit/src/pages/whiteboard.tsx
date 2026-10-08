"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary, type ErrorFallbackProps } from "@/components/error-boundary";
import type { AppState, BinaryFiles, ExcalidrawElement } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { getAccessToken } from "@/lib/auth";

const Excalidraw = lazy(async () => {
  console.info("[Whiteboard] Loading Excalidraw component");
  try {
    const module = await import("@excalidraw/excalidraw");
    console.info("[Whiteboard] Excalidraw component loaded");
    return { default: module.Excalidraw };
  } catch (error) {
    console.error("[Whiteboard] Excalidraw import failed", error);
    throw error;
  }
});

const EMPTY_CONTENT: WhiteboardRow["content"] = {
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
};

function normalizeContent(value: unknown): WhiteboardRow["content"] {
  if (!value || typeof value !== "object") {
    console.warn("[Whiteboard] Invalid saved content; using an empty scene");
    return EMPTY_CONTENT;
  }

  const raw = value as Record<string, unknown>;
  return {
    type: typeof raw.type === "string" ? raw.type : "excalidraw",
    version: typeof raw.version === "number" ? raw.version : 2,
    elements: Array.isArray(raw.elements) ? raw.elements as ExcalidrawElement[] : [],
    appState: raw.appState && typeof raw.appState === "object"
      ? raw.appState as Partial<AppState>
      : {},
    files: raw.files && typeof raw.files === "object"
      ? raw.files as BinaryFiles
      : {},
  };
}

function WhiteboardErrorFallback({ error }: ErrorFallbackProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#121212] px-6 text-white">
      <div className="w-full max-w-xl rounded-2xl border border-red-400/30 bg-red-950/30 p-6">
        <h2 className="text-lg font-semibold">Whiteboard failed to load</h2>
        <p className="mt-2 text-sm text-white/70">
          The whiteboard itself crashed while loading. Your Files entry is still saved.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-red-200 whitespace-pre-wrap">
          {error.message || String(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90"
        >
          Reload whiteboard
        </button>
      </div>
    </div>
  );
}

const url = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

type WhiteboardRow = {
  id: string;
  title: string;
  content: {
    type?: string;
    version?: number;
    elements?: readonly ExcalidrawElement[];
    appState?: Partial<AppState>;
    files?: BinaryFiles;
  };
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  if (!url || !anon || !token) throw new Error("You must be signed in to use this whiteboard.");
  const response = await fetch(url + path, {
    ...init,
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  let data: unknown = null;
  try { data = body ? JSON.parse(body) : null; } catch { data = body; }
  if (!response.ok) {
    const message = typeof data === "object" && data
      ? String((data as any).message || (data as any).details || (data as any).hint || `Request failed (${response.status})`)
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function downloadFile(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

export default function WhiteboardPage() {
  const whiteboardId = useMemo(() => new URLSearchParams(window.location.search).get("id"), []);
  console.info("[Whiteboard] Page opened", { whiteboardId });
  const [board, setBoard] = useState<WhiteboardRow | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const latestContent = useRef<WhiteboardRow["content"] | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (!whiteboardId) {
      console.error("[Whiteboard] Missing whiteboard id in URL");
      setError("This whiteboard does not have a saved Files entry.");
      return;
    }
    let cancelled = false;
    console.info("[Whiteboard] Loading saved whiteboard", { whiteboardId });
    void api<WhiteboardRow[]>(
      `/rest/v1/whiteboards?select=id,title,content&id=eq.${encodeURIComponent(whiteboardId)}&limit=1`,
    ).then((rows) => {
      console.info("[Whiteboard] Saved whiteboard response received", {
        whiteboardId,
        found: Boolean(rows[0]),
      });
      if (!cancelled) {
        if (!rows[0]) setError("This whiteboard could not be found.");
        else {
          const normalized = { ...rows[0], content: normalizeContent(rows[0].content) };
          console.info("[Whiteboard] Whiteboard content normalized", {
            whiteboardId,
            elementCount: normalized.content.elements?.length ?? 0,
          });
          setBoard(normalized);
          latestContent.current = normalized.content;
          hasLoadedRef.current = true;
        }
      }
    }).catch((e) => {
      console.error("[Whiteboard] Failed to load saved whiteboard", { whiteboardId, error: e });
      if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this whiteboard.");
    });
    return () => { cancelled = true; };
  }, [whiteboardId]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
  }, []);

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (!whiteboardId || !hasLoadedRef.current) return;
    console.debug("[Whiteboard] Canvas changed", { whiteboardId, elementCount: elements.length });
    const content: WhiteboardRow["content"] = {
      type: "excalidraw",
      version: 2,
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom,
      },
      files,
    };
    latestContent.current = content;
    setSaving(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const next = latestContent.current;
      if (!next) return;
      console.info("[Whiteboard] Saving canvas", { whiteboardId });
      void api(`/rest/v1/whiteboards?id=eq.${encodeURIComponent(whiteboardId)}`, {
        method: "PATCH",
        body: JSON.stringify({ content: next, updated_at: new Date().toISOString() }),
      }).then(() => {
        console.info("[Whiteboard] Canvas saved", { whiteboardId });
        setSaving(false);
      }).catch((e) => {
        console.error("[Whiteboard] Canvas save failed", { whiteboardId, error: e });
        setSaving(false);
        setError(e instanceof Error ? e.message : "Could not save this whiteboard.");
      });
    }, 1000);
  }, [whiteboardId]);

  const initialData = useMemo(() => board?.content || null, [board]);
  const excalidrawUIOptions = useMemo(() => ({
    canvasActions: {
      export: false,
      loadScene: false,
      saveToActiveFile: false,
    },
  }), []);

  const exportJson = () => {
    if (!board) return;
    downloadFile(JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: window.location.origin,
      elements: board.content.elements || [],
      appState: board.content.appState || {},
      files: board.content.files || {},
    }, null, 2), `${board.title}.excalidraw`, "application/json");
  };

  const exportPng = async () => {
    if (!board) return;
    const module = await import("@excalidraw/excalidraw");
    const blob = await module.exportToBlob({
      elements: board.content.elements || [],
      appState: { ...(board.content.appState || {}), exportWithDarkMode: true } as AppState,
      files: board.content.files || {},
      mimeType: "image/png",
    });
    downloadFile(blob, `${board.title}.png`, "image/png");
  };

  if (error) {
    return <div className="flex h-[100dvh] items-center justify-center bg-[#121212] px-6 text-sm text-red-200">{error}</div>;
  }

  return (
    <div className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-[#121212]">
      <style>{`
        .flexus-excalidraw a[href^="http"] {
          display: none !important;
        }
        .flexus-excalidraw .dropdown-menu-item:has(a[href^="http"]) {
          display: none !important;
        }
      `}</style>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#181818] px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-white">{board?.title || "Whiteboard"}</h1>
          <p className="text-[11px] text-white/50">{saving ? "Saving…" : "Saved to Files"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportJson} disabled={!board} className="rounded-md border border-white/15 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50">Export JSON</button>
          <button type="button" onClick={() => void exportPng()} disabled={!board} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">Export PNG</button>
        </div>
      </div>

      <div className="flexus-excalidraw min-h-0 min-w-0 flex-1">
        {board ? (
          <ErrorBoundary FallbackComponent={WhiteboardErrorFallback}>
            <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-[#121212] text-sm text-white/60">Loading whiteboard…</div>}>
              <Excalidraw
              theme="dark"
              initialData={initialData}
              onChange={handleChange}
              UIOptions={excalidrawUIOptions}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#121212] text-sm text-white/60">Loading whiteboard…</div>
        )}
      </div>
    </div>
  );
}
