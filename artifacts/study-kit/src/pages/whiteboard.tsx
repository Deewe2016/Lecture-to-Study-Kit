"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, BinaryFiles, ExcalidrawElement } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { getAccessToken } from "@/lib/auth";

const Excalidraw = lazy(async () => {
  const module = await import("@excalidraw/excalidraw");
  return { default: module.Excalidraw };
});

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
  const [board, setBoard] = useState<WhiteboardRow | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const latestContent = useRef<WhiteboardRow["content"] | null>(null);

  useEffect(() => {
    if (!whiteboardId) {
      setError("This whiteboard does not have a saved Files entry.");
      return;
    }
    let cancelled = false;
    void api<WhiteboardRow[]>(
      `/rest/v1/whiteboards?select=id,title,content&id=eq.${encodeURIComponent(whiteboardId)}&limit=1`,
    ).then((rows) => {
      if (!cancelled) {
        if (!rows[0]) setError("This whiteboard could not be found.");
        else {
          setBoard(rows[0]);
          latestContent.current = rows[0].content;
        }
      }
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this whiteboard.");
    });
    return () => { cancelled = true; };
  }, [whiteboardId]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
  }, []);

  const handleChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (!whiteboardId) return;
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
    setBoard((current) => current ? { ...current, content } : current);
    setSaving(true);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const next = latestContent.current;
      if (!next) return;
      void api(`/rest/v1/whiteboards?id=eq.${encodeURIComponent(whiteboardId)}`, {
        method: "PATCH",
        body: JSON.stringify({ content: next, updated_at: new Date().toISOString() }),
      }).then(() => setSaving(false)).catch((e) => {
        setSaving(false);
        setError(e instanceof Error ? e.message : "Could not save this whiteboard.");
      });
    }, 700);
  };

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
          <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-[#121212] text-sm text-white/60">Loading whiteboard…</div>}>
            <Excalidraw
              theme="dark"
              initialData={board.content}
              onChange={handleChange}
              UIOptions={{
                canvasActions: {
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                },
              }}
            />
          </Suspense>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#121212] text-sm text-white/60">Loading whiteboard…</div>
        )}
      </div>
    </div>
  );
}
