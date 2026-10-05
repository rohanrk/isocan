/**
 * **The markup modal**: open a screen, draw everything you mean, land it as
 * ONE drawing that annotates the screen.
 *
 * The Pen settles each breath of ink as its own item, which is right for a
 * quick circle and wrong for a considered markup — six arrows and two boxes
 * about one screen should be one thing to attach to a comment, one thing to
 * move with the screen, one thing for an agent to clear. So this is the other
 * authoring shape: a modal that renders the screen at a scale that fits, an
 * SVG overlay in the screen's OWN coordinates, and a Done button. Nothing
 * reaches the canvas until Done; Cancel throws it all away.
 *
 * Opened three ways — the under-item chip, the context menu, the palette —
 * and a fourth from the comment composer, which passes `onDone` so the
 * markup is attached to the comment being written instead of opening a new
 * one. Mounted on its own body host like `VersionCompare`, so it owes the
 * canvas tree nothing.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Actor, InkPoint, Mark, ShapeTool } from "@isocan/core";
import { isDesignSystem, isTextItem, markBounds, sourceOf, visualFaceOf } from "@isocan/core";
import { useCanvasStore } from "../stores/canvasStore.ts";
import { useUiStore } from "../stores/uiStore.ts";
import { IDENTITY_COLORS, actorColorIn, useActorColors } from "../lib/colors.ts";
import { VersionContent } from "./ItemView.tsx";
import { MarkElement } from "./ShapePreview.tsx";
import { SHAPE_ICONS } from "./CanvasTools.tsx";
import "./markup-modal.css";

export interface MarkupRequest {
  canvasId: string;
  actor: Actor;
  itemId: string;
  /** From the comment composer: take the markup instead of opening a new
   * comment about it. */
  onDone?: (drawingId: string) => void;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Open the markup modal on an item, replacing one already open. */
export function openMarkup(request: MarkupRequest): void {
  if (!host) {
    host = document.createElement("div");
    host.dataset.markupModal = "";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root!.render(<MarkupModal key={request.itemId} {...request} onClose={closeMarkup} />);
}

function closeMarkup(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

/** Stroke width in the screen's own units — the Pen's width at 100%. */
const MARK_WIDTH = 3;
/** A drag shorter than this (in screen pixels) is a click, not a shape. */
const MIN_DRAG_PX = 4;

type Tool = "freehand" | ShapeTool;
const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "freehand", label: "Freehand" },
  { tool: "arrow", label: "Arrow" },
  { tool: "rect", label: "Rectangle" },
  { tool: "ellipse", label: "Ellipse" },
  { tool: "line", label: "Line" },
];

function MarkupModal({ canvasId, actor, itemId, onDone, onClose }: MarkupRequest & { onClose: () => void }) {
  const item = useCanvasStore((s) => (s.canvasId === canvasId ? s.canvas?.items[itemId] : undefined));
  const colors = useActorColors();
  const mine = actorColorIn(colors, actor.id);
  const inkColor = useUiStore((s) => s.inkColor);
  const [tool, setTool] = useState<Tool>("freehand");
  const [color, setColor] = useState<string>(inkColor ?? mine);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [live, setLive] = useState<Mark | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving: with marks in hand, ask; a markup is work.
  const leave = useCallback(() => {
    if (marks.length > 0 && !window.confirm("Discard this markup?")) return;
    onClose();
  }, [marks.length, onClose]);

  // Keys belong to the modal while it is open: Escape leaves, ⌘Z takes back
  // the last mark. Captured, so the canvas behind never hears either.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        leave();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        setMarks((m) => m.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leave]);

  // Fit the screen to the stage, like VersionCompare's panes.
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const docW = item?.width ?? 1;
  const docH = item?.height ?? 1;
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 24) / docW, (el.clientHeight - 24) / docH));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docW, docH]);

  // The gesture, in the screen's own coordinates.
  const overlay = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ start: InkPoint; startClient: InkPoint; points: InkPoint[] } | null>(null);
  const toLocal = (e: { clientX: number; clientY: number }): InkPoint => {
    const rect = overlay.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.current!.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    gesture.current = { start: p, startClient: { x: e.clientX, y: e.clientY }, points: [p] };
    setLive(
      tool === "freehand"
        ? { kind: "stroke", stroke: { points: [p], color, width: MARK_WIDTH } }
        : { kind: "shape", shape: tool, drag: { x1: p.x, y1: p.y, x2: p.x, y2: p.y }, color, width: MARK_WIDTH },
    );
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = toLocal(e);
    if (tool === "freehand") {
      g.points.push(p);
      setLive({ kind: "stroke", stroke: { points: [...g.points], color, width: MARK_WIDTH } });
    } else {
      setLive({ kind: "shape", shape: tool, drag: { x1: g.start.x, y1: g.start.y, x2: p.x, y2: p.y }, color, width: MARK_WIDTH });
    }
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (overlay.current?.hasPointerCapture(e.pointerId)) overlay.current.releasePointerCapture(e.pointerId);
    const p = toLocal(e);
    const moved = Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y);
    setLive(null);
    if (tool === "freehand") {
      // A tap is a dot — the Pen keeps those too.
      setMarks((m) => [...m, { kind: "stroke", stroke: { points: [...g.points, p], color, width: MARK_WIDTH } }]);
    } else if (moved >= MIN_DRAG_PX) {
      setMarks((m) => [...m, { kind: "shape", shape: tool, drag: { x1: g.start.x, y1: g.start.y, x2: p.x, y2: p.y }, color, width: MARK_WIDTH }]);
    }
  };

  const done = async () => {
    if (!item || marks.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { placeMarkup } = await import("../lib/markupplace.ts");
      const id = await placeMarkup(canvasId, actor, item, marks);
      onClose();
      if (onDone) {
        onDone(id);
        return;
      }
      // From the chip or the menu: open the composer about it, the way the
      // Pen does — anchored to the screen, pinned above the markup.
      const b = markBounds(marks)!;
      useUiStore.getState().setPendingComment({
        x: (b.minX + b.maxX) / 2,
        y: b.minY,
        anchorItemId: item.id,
        aboutItemId: id,
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!item) {
    return (
      <Shell title="Mark up" onClose={onClose}>
        <p className="markup-empty">This item is no longer on the canvas.</p>
      </Shell>
    );
  }
  const current = item.versions.find((v) => v.id === item.currentVersionId) ?? item.versions[0];
  const visual = current ? visualFaceOf(current) : null;

  return (
    <Shell title={<>Mark up <span className="markup-title">{item.title}</span></>} onClose={leave}>
      <div className="markup-tools" role="toolbar" aria-label="Markup tools">
        <div className="markup-group" role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              className={`markup-tool${tool === t.tool ? " active" : ""}`}
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              onClick={() => setTool(t.tool)}
            >
              {SHAPE_ICONS[t.tool]}
            </button>
          ))}
        </div>
        <div className="markup-group" role="group" aria-label="Ink color">
          {[{ value: mine, name: `Your color, ${actor.name}` }, ...IDENTITY_COLORS.filter((c) => c.value !== mine)].map((c) => (
            <button
              key={c.value}
              type="button"
              className={`markup-swatch${color === c.value ? " active" : ""}`}
              style={{ background: c.value }}
              title={c.name}
              aria-label={c.name}
              aria-pressed={color === c.value}
              onClick={() => setColor(c.value)}
            />
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn" disabled={marks.length === 0} onClick={() => setMarks((m) => m.slice(0, -1))} title="Undo (⌘Z)">
          Undo
        </button>
        <button type="button" className="btn" disabled={marks.length === 0} onClick={() => setMarks([])}>
          Clear
        </button>
      </div>

      <div className="markup-stage" ref={stage}>
        <div className="markup-paper" style={{ width: docW * scale, height: docH * scale }}>
          {/* The screen itself, drawn at its own size and scaled down — the
              same face the canvas card shows. Pointer events never reach it:
              the overlay above takes every one. */}
          <div className="markup-face" style={{ width: docW, height: docH, transform: `scale(${scale})` }} aria-hidden>
            {visual && current && (
              <VersionContent
                canvasId={canvasId}
                blobHash={visual.blobHash}
                mimeType={visual.mimeType}
                filename={visual.filename ?? current.filename}
                entered={false}
                canvasOf={item.properties.canvas ?? null}
                canvasSource={sourceOf(item)}
                designSystem={isDesignSystem(item)}
                textNode={isTextItem(item)}
              />
            )}
          </div>
          <svg
            ref={overlay}
            className="markup-overlay"
            viewBox={`0 0 ${docW} ${docH}`}
            width={docW * scale}
            height={docH * scale}
            aria-label="Drawing surface"
            data-tool={tool}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {marks.map((mark, i) => (
              <MarkElement key={i} mark={mark} />
            ))}
            {live && <MarkElement mark={live} />}
          </svg>
        </div>
      </div>

      <div className="markup-foot">
        <span className="markup-count" aria-live="polite">
          {marks.length === 0 ? "Draw on the screen — every mark lands as one item." : `${marks.length} mark${marks.length === 1 ? "" : "s"}`}
        </span>
        {error && <p role="alert" className="markup-error">{error}</p>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={leave}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={marks.length === 0 || busy} onClick={() => void done()}>
          {busy ? "Placing…" : onDone ? "Attach to comment" : "Add markup"}
        </button>
      </div>
    </Shell>
  );
}

/** The modal shell — `.modal-backdrop` + `.modal-card`, the shape every
 *  overlay here wears, with the card sized for a stage rather than a column. */
function Shell({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop markup-backdrop" onPointerDown={onClose}>
      <div className="modal-card markup-card" role="dialog" aria-label="Mark up" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <b>{title}</b>
          <span className="spacer" />
          <button className="main-close" title="Close (Esc)" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
