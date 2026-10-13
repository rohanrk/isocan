/**
 * **The markup window**: open a screen, draw everything you mean, and hand it
 * to a COMMENT — nothing lands on the canvas.
 *
 * The Pen settles each breath of ink as its own item, which is right for a
 * quick circle and wrong for a considered markup — six arrows and two boxes
 * about one screen should be one thing, said once, read once. So this is the
 * other authoring shape: a modal that renders the screen at a scale that
 * fits, an SVG overlay in the screen's OWN coordinates, and a Done button
 * that uploads the sheet and attaches it to the comment being written (or
 * opens the composer with it attached). The screen itself stays clean: the
 * marks live in the comment, and the same window opens READ-ONLY from the
 * comment's chip to show the screen with the marks over it — for a person
 * here, and `isocan comment markup` gives an agent the same sheet.
 *
 * Opened four ways to draw — the under-item chip, the context menu, the
 * palette, the comment composer — and one way to view. Mounted on its own
 * body host like `VersionCompare`, so it owes the canvas tree nothing.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Actor, CommentMarkup, InkPoint, Mark, ShapeTool } from "@isocan/core";
import { DRAWING_MIME, MARKUP_FILENAME, isDesignSystem, isTextItem, markBadgeAt, markupNotes, markupSheetSvg, sourceOf, visualFaceOf } from "@isocan/core";
import { useCanvasStore } from "../stores/canvasStore.ts";
import { useUiStore } from "../stores/uiStore.ts";
import { IDENTITY_COLORS, actorColorIn, useActorColors } from "../lib/colors.ts";
import { blobUrl, uploadBlob } from "../lib/api.ts";
import { VersionContent } from "./ItemView.tsx";
import { MarkElement } from "./ShapePreview.tsx";
import { SHAPE_ICONS } from "./CanvasTools.tsx";
import { MarkupNotes } from "./CommentMarkupChip.tsx";
import "./markup-modal.css";

export interface MarkupRequest {
  canvasId: string;
  actor: Actor;
  itemId: string;
  /** From the comment composer: take the markup instead of opening a new
   * comment about it. */
  onDone?: (markup: CommentMarkup) => void;
}

/** A finished markup, from a comment: shown over its screen, not editable. */
export interface MarkupView {
  canvasId: string;
  markup: CommentMarkup;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: ReactNode): void {
  if (!host) {
    host = document.createElement("div");
    host.dataset.markupModal = "";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root!.render(node);
}

/** Open the markup window on an item to draw, replacing one already open. */
export function openMarkup(request: MarkupRequest): void {
  mount(<MarkupModal key={`draw:${request.itemId}`} {...request} onClose={closeMarkup} />);
}

/** Open a comment's markup over its screen, read-only. */
export function openMarkupView(view: MarkupView): void {
  mount(<MarkupViewer key={`view:${view.markup.blobHash}`} {...view} onClose={closeMarkup} />);
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

/**
 * Upload the sheet and describe it as the comment will carry it. The SVG's
 * viewBox is the item's box, so no coordinate is translated on the way in or
 * out: the window and `isocan comment markup` both lay it straight over.
 */
export async function uploadMarkup(
  canvasId: string,
  item: { id: string; width: number; height: number; currentVersionId: string },
  marks: readonly Mark[],
): Promise<CommentMarkup> {
  const width = Math.max(1, Math.round(item.width));
  const height = Math.max(1, Math.round(item.height));
  const svg = markupSheetSvg(marks, width, height);
  const upload = await uploadBlob(canvasId, new Blob([svg], { type: DRAWING_MIME }), MARKUP_FILENAME);
  const notes = markupNotes(marks);
  return {
    itemId: item.id,
    versionId: item.currentVersionId,
    blobHash: upload.blobHash,
    mimeType: DRAWING_MIME,
    filename: MARKUP_FILENAME,
    size: upload.size,
    width,
    height,
    marks: marks.length,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

/** The window's zoom runs from a tenth to four times the screen's own size. */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
/** One tap of + or − (or ⌘= / ⌘−) is this much. */
const ZOOM_STEP = 1.25;
/** Pinch and ⌘-wheel, same feel as the canvas's. */
const WHEEL_ZOOM_SENSITIVITY = 0.0055;

/**
 * Fit a document of `docW`×`docH` into the stage, then let the person zoom
 * the DOCUMENT — the thing being marked up — rather than the canvas behind
 * it. Pinch and ⌘-wheel zoom about the cursor; a plain wheel scrolls the
 * stage once the paper outgrows it; ⌘= ⌘− ⌘0 step and refit. `scale` is
 * what every coordinate in the window is divided by, so the overlay, the
 * badges and the note field all follow it for free.
 */
function useZoom(docW: number, docH: number) {
  const stage = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  // null = fitted; a number = what the person asked for.
  const [zoom, setZoom] = useState<number | null>(null);
  const scale = zoom ?? fit;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const refit = () => setFit(Math.min(1, (el.clientWidth - 24) / docW, (el.clientHeight - 24) / docH));
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [docW, docH]);

  /** Zoom to `next`, keeping the document point under (`cx`,`cy`) — a client
   * position — where it is; without one, about the stage's centre. */
  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const el = stage.current;
    const sheet = paper.current;
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (!el || !sheet) return setZoom(clamped);
    const from = scaleRef.current;
    const box = el.getBoundingClientRect();
    const at = { x: cx ?? box.left + box.width / 2, y: cy ?? box.top + box.height / 2 };
    const r = sheet.getBoundingClientRect();
    // The document point under the cursor, in the document's own units.
    const dx = (at.x - r.left) / from;
    const dy = (at.y - r.top) / from;
    setZoom(clamped);
    // After layout the paper has its new size; scroll so that point is back
    // under the cursor. When the paper still fits, the margins centre it and
    // there is nothing to scroll — which is also right.
    requestAnimationFrame(() => {
      const r2 = sheet.getBoundingClientRect();
      el.scrollLeft += r2.left + dx * clamped - at.x;
      el.scrollTop += r2.top + dy * clamped - at.y;
    });
  }, []);
  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => zoomTo(scaleRef.current * factor, cx, cy), [zoomTo]);
  const refit = useCallback(() => setZoom(null), []);

  // Wheel has to be a native, non-passive listener to be allowed to prevent
  // the browser's own page zoom. Safari's trackpad pinch arrives as gesture
  // events instead; `e.scale` is cumulative, so zoom by the change.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // a plain wheel scrolls the stage
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY), e.clientX, e.clientY);
    };
    let gesture = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gesture = (e as GestureEvent).scale;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      zoomBy(g.scale / gesture, g.clientX, g.clientY);
      gesture = g.scale;
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    el.addEventListener("gestureend", stop, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", stop);
    };
  }, [zoomBy]);

  // ⌘= ⌘+ ⌘− ⌘0 while the window is open — captured, so neither the browser
  // nor the canvas behind zooms instead. Not while typing a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      if (e.key === "=" || e.key === "+") zoomBy(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") refit();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomBy, refit]);

  return { stage, paper, scale, fitted: zoom === null, zoomBy, refit };
}

/** Safari's trackpad pinch event — not in lib.dom. */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** − 100% + Fit: the zoom, said and steerable without a trackpad. */
function ZoomControl({ scale, fitted, zoomBy, refit }: { scale: number; fitted: boolean; zoomBy: (f: number) => void; refit: () => void }) {
  return (
    <div className="markup-group markup-zoom" role="group" aria-label="Zoom">
      <button type="button" className="markup-tool" title="Zoom out (⌘−)" aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={scale <= ZOOM_MIN}>
        −
      </button>
      <button type="button" className="markup-zoom-value" title={fitted ? "Fitted to the window — click for 100%" : "Click to fit (⌘0)"} aria-label={`Zoom ${Math.round(scale * 100)} percent`} onClick={() => (fitted ? zoomBy(1 / scale) : refit())}>
        {Math.round(scale * 100)}%
      </button>
      <button type="button" className="markup-tool" title="Zoom in (⌘=)" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={scale >= ZOOM_MAX}>
        +
      </button>
      {!fitted && (
        <button type="button" className="markup-tool markup-zoom-fit" title="Fit to the window (⌘0)" aria-label="Fit" onClick={refit}>
          Fit
        </button>
      )}
    </div>
  );
}

/** The screen itself, drawn at its own size and scaled down — the same face
 * the canvas card shows. Pointer events never reach it. */
function Face({ canvasId, itemId, versionId, width, height, scale }: { canvasId: string; itemId: string; versionId?: string; width: number; height: number; scale: number }) {
  const item = useCanvasStore((s) => (s.canvasId === canvasId ? s.canvas?.items[itemId] : undefined));
  if (!item) return <div className="markup-face markup-face-gone" style={{ width, height, transform: `scale(${scale})` }} aria-hidden />;
  // The version drawn on, when it is still in the stack; the top otherwise —
  // and the viewer says which above the stage.
  const version = item.versions.find((v) => v.id === versionId) ?? item.versions.find((v) => v.id === item.currentVersionId) ?? item.versions[0];
  const visual = version ? visualFaceOf(version) : null;
  return (
    <div className="markup-face" style={{ width, height, transform: `scale(${scale})` }} aria-hidden>
      {visual && version && (
        <VersionContent
          canvasId={canvasId}
          blobHash={visual.blobHash}
          mimeType={visual.mimeType}
          filename={visual.filename ?? version.filename}
          entered={false}
          canvasOf={item.properties.canvas ?? null}
          canvasSource={sourceOf(item)}
          designSystem={isDesignSystem(item)}
          textNode={isTextItem(item)}
        />
      )}
    </div>
  );
}

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
  // The shape whose words are being asked for — the one just drawn, or one
  // whose badge was clicked. Optional every time: Esc or an empty Enter
  // leaves the shape a shape.
  const [labeling, setLabeling] = useState<number | null>(null);
  const setLabel = (index: number, label: string) =>
    setMarks((m) =>
      m.map((mark, i): Mark => {
        if (i !== index || mark.kind !== "shape") return mark;
        const { label: _was, ...bare } = mark;
        const words = label.trim();
        return words ? { ...bare, label: words } : bare;
      }),
    );

  // Leaving: with marks in hand, ask; a markup is work.
  const leave = useCallback(() => {
    if (marks.length > 0 && !window.confirm("Discard this markup?")) return;
    onClose();
  }, [marks.length, onClose]);

  // Keys belong to the modal while it is open: Escape leaves, ⌘Z takes back
  // the last mark. Captured, so the canvas behind never hears either. While
  // a note is being typed the input owns its keys (Escape puts it away,
  // ⌘Z undoes typing) and stops them itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".markup-label")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        leave();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        setLabeling(null);
        setMarks((m) => m.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leave]);

  const docW = item?.width ?? 1;
  const docH = item?.height ?? 1;
  const { stage, paper, scale, fitted, zoomBy, refit } = useZoom(docW, docH);

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
    setLabeling(null);
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
      // A shape can mean something: ask, right where it was drawn.
      setMarks((m) => {
        setLabeling(m.length);
        return [...m, { kind: "shape", shape: tool, drag: { x1: g.start.x, y1: g.start.y, x2: p.x, y2: p.y }, color, width: MARK_WIDTH }];
      });
    }
  };

  const done = async () => {
    if (!item || marks.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const markup = await uploadMarkup(canvasId, item, marks);
      onClose();
      if (onDone) {
        onDone(markup);
        return;
      }
      // From the chip or the menu: open the composer with the markup already
      // attached — anchored to the screen, pinned at its top edge.
      useUiStore.getState().setPendingComment({
        x: item.x + item.width / 2,
        y: item.y,
        anchorItemId: item.id,
        markup,
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

  // Badges for the labelled shapes, numbered as the sheet numbers them.
  let n = 0;
  const badges = marks.flatMap((mark, index) => {
    const at = markBadgeAt(mark);
    const text = mark.kind === "shape" ? mark.label : undefined;
    return mark.kind === "shape" && at && text ? [{ index, n: ++n, x: at.x, y: at.y, color: mark.color, text }] : [];
  });
  const noteCount = badges.length;
  const labelMark = labeling !== null ? marks[labeling] : undefined;
  const labelAt = labelMark && markBadgeAt(labelMark);
  const labelValue = labelMark?.kind === "shape" ? (labelMark.label ?? "") : "";
  const labelPos = labelAt ? { x: labelAt.x, y: labelAt.y, value: labelValue } : null;

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
        <ZoomControl scale={scale} fitted={fitted} zoomBy={zoomBy} refit={refit} />
        <button type="button" className="btn" disabled={marks.length === 0} onClick={() => { setLabeling(null); setMarks((m) => m.slice(0, -1)); }} title="Undo (⌘Z)">
          Undo
        </button>
        <button type="button" className="btn" disabled={marks.length === 0} onClick={() => { setLabeling(null); setMarks([]); }}>
          Clear
        </button>
      </div>

      <div className="markup-stage" ref={stage}>
        <div className="markup-paper" ref={paper} style={{ width: docW * scale, height: docH * scale }}>
          <Face canvasId={canvasId} itemId={item.id} width={docW} height={docH} scale={scale} />
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
            {badges.map((b) => (
              <g
                key={b.index}
                className="markup-badge"
                role="button"
                tabIndex={0}
                aria-label={`Note ${b.n}: ${b.text}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setLabeling(b.index);
                }}
              >
                <title>{`${b.n}. ${b.text}`}</title>
                <circle cx={b.x} cy={b.y} r={10} fill={b.color} stroke="#fff" strokeWidth={2} />
                <text x={b.x} y={b.y} fill="#fff" fontSize={12} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                  {b.n}
                </text>
              </g>
            ))}
          </svg>
          {labelPos && labeling !== null && (
            <LabelInput
              key={labeling}
              style={{ left: labelPos.x * scale + 14, top: labelPos.y * scale - 14 }}
              value={labelPos.value}
              onCommit={(text) => {
                setLabel(labeling, text);
                setLabeling(null);
              }}
              onCancel={() => setLabeling(null)}
            />
          )}
        </div>
      </div>

      <div className="markup-foot">
        <span className="markup-count" aria-live="polite">
          {marks.length === 0
            ? "Draw on the screen — the marks go with your comment, not onto the canvas."
            : `${marks.length} mark${marks.length === 1 ? "" : "s"}${noteCount > 0 ? ` · ${noteCount} note${noteCount === 1 ? "" : "s"}` : ""}`}
        </span>
        {error && <p role="alert" className="markup-error">{error}</p>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={leave}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={marks.length === 0 || busy} onClick={() => void done()}>
          {busy ? "Attaching…" : onDone ? "Add to comment" : "Comment with markup"}
        </button>
      </div>
    </Shell>
  );
}

/** The words for one shape, asked for where the shape begins. Enter or
 * leaving the field keeps them; Escape puts the field away unchanged. */
function LabelInput({ style, value, onCommit, onCancel }: { style: React.CSSProperties; value: string; onCommit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const committed = useRef(false);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(text);
  };
  return (
    <div className="markup-label" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        type="text"
        value={text}
        placeholder="What should happen here? (optional)"
        aria-label="Note for this shape"
        maxLength={280}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ours, not the canvas's: nothing typed here is a shortcut out there.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committed.current = true;
            onCancel();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

/**
 * A comment's markup over its screen. The sheet is an `<img>` of the SVG
 * blob sized to the item's box AS IT WAS when drawn (`markup.width/height`),
 * so a screen resized since still wears the marks where they were made.
 */
function MarkupViewer({ canvasId, markup, onClose }: MarkupView & { onClose: () => void }) {
  const item = useCanvasStore((s) => (s.canvasId === canvasId ? s.canvas?.items[markup.itemId] : undefined));
  const { stage, paper, scale, fitted, zoomBy, refit } = useZoom(markup.width, markup.height);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const drawnOn = markup.versionId && item ? item.versions.findIndex((v) => v.id === markup.versionId) : -1;
  const onTop = !!item && markup.versionId === item.currentVersionId;
  const note = !item
    ? "The screen this was drawn on is no longer on the canvas — the marks are shown on their own."
    : drawnOn < 0
      ? "Drawn on a version no longer in the stack — shown over the current one."
      : onTop
        ? null
        : `Drawn on version ${drawnOn + 1} of ${item.versions.length}, shown here as it was.`;
  const count = markup.marks ?? 0;

  return (
    <Shell title={<>Markup <span className="markup-title">{item?.title ?? markup.itemId}</span></>} onClose={onClose}>
      {note && <p className="markup-note">{note}</p>}
      <div className="markup-stage" ref={stage}>
        <div className="markup-paper" ref={paper} style={{ width: markup.width * scale, height: markup.height * scale }}>
          <Face canvasId={canvasId} itemId={markup.itemId} {...(markup.versionId ? { versionId: markup.versionId } : {})} width={markup.width} height={markup.height} scale={scale} />
          <img
            className="markup-overlay markup-sheet"
            src={blobUrl(canvasId, markup.blobHash)}
            width={markup.width * scale}
            height={markup.height * scale}
            alt={`${count || "The"} mark${count === 1 ? "" : "s"} drawn on ${item?.title ?? "the screen"}`}
            draggable={false}
          />
        </div>
      </div>
      {markup.notes && markup.notes.length > 0 && <MarkupNotes notes={markup.notes} />}
      <div className="markup-foot">
        <span className="markup-count">{count > 0 ? `${count} mark${count === 1 ? "" : "s"}` : "A markup"} · {markup.width}×{markup.height}</span>
        <span className="spacer" />
        <ZoomControl scale={scale} fitted={fitted} zoomBy={zoomBy} refit={refit} />
        <a className="btn" href={blobUrl(canvasId, markup.blobHash)} download={markup.filename} title="The sheet alone, as an SVG — what `isocan comment markup` fetches">
          Download sheet
        </a>
        <button type="button" className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Shell>
  );
}

/** The modal shell — `.modal-backdrop` + `.modal-card`, the shape every
 *  overlay here wears, with the card sized for a stage rather than a column. */
function Shell({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop markup-backdrop" data-owns-zoom onPointerDown={onClose}>
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
