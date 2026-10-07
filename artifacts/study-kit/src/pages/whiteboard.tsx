"use client";

import { lazy, Suspense, useMemo } from "react";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawElement,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = lazy(async () => {
  const module = await import("@excalidraw/excalidraw");
  return { default: module.Excalidraw };
});

const STORAGE_KEY = "flexus-whiteboard";

type SavedBoard = {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
};

function loadBoard(): SavedBoard | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved) as SavedBoard;
  } catch {
    return null;
  }
}

function downloadFile(
  content: BlobPart,
  filename: string,
  type: string,
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function WhiteboardPage() {
  const initialData = useMemo(() => loadBoard(), []);

  const handleChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    _files: BinaryFiles,
  ) => {
    try {
      const saved: SavedBoard = {
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom,
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Ignore storage failures so drawing is never interrupted.
    }
  };

  const exportJson = () => {
    const saved = loadBoard();
    if (!saved) return;

    downloadFile(
      JSON.stringify(
        {
          type: "excalidraw",
          version: 2,
          source: "https://flexus-workspace.vercel.app",
          elements: saved.elements,
          appState: saved.appState,
          files: {},
        },
        null,
        2,
      ),
      "flexus-whiteboard.excalidraw",
      "application/json",
    );
  };

  const exportPng = async () => {
    const module = await import("@excalidraw/excalidraw");
    const saved = loadBoard();

    if (!saved) return;

    const blob = await module.exportToBlob({
      elements: saved.elements,
      appState: {
        ...saved.appState,
        exportWithDarkMode: true,
      } as AppState,
      files: {},
      mimeType: "image/png",
    });

    downloadFile(blob, "flexus-whiteboard.png", "image/png");
  };

  return (
    <div className="flex h-[calc(100dvh-0px)] w-full min-w-0 flex-col overflow-hidden bg-[#121212]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#181818] px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold text-white">Whiteboard</h1>
          <p className="text-[11px] text-white/50">
            Draw, sketch, annotate, and export your board.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportJson}
            className="rounded-md border border-white/15 px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void exportPng()}
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Export PNG
          </button>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-[#121212] text-sm text-white/60">
              Loading whiteboard…
            </div>
          }
        >
          <Excalidraw
            theme="dark"
            initialData={initialData ?? undefined}
            onChange={handleChange}
          />
        </Suspense>
      </div>
    </div>
  );
}
