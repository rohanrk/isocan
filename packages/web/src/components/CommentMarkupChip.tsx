/**
 * **The chip a comment wears when it carries a markup** — and the pill the
 * composer shows while one is attached and not yet posted.
 *
 * Both open the same window (`openMarkupView`): the screen with the marks
 * over it, read-only. The marks are never on the canvas, so this chip is the
 * ONLY way a person reaches them here, which is why it sits in both comment
 * renderers (the thread popover and the Chat) rather than in one.
 */

import type { CommentMarkup, MarkupNote } from "@isocan/core";
import { useCanvasStore } from "../stores/canvasStore.ts";
import "./markup-modal.css";

const NIB = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 13l1.5-4.5L11 2l3 3-6.5 6.5L3 13z" />
    <path d="M9.5 3.5l3 3" />
  </svg>
);

function words(markup: CommentMarkup): string {
  const n = markup.marks ?? 0;
  const notes = markup.notes?.length ?? 0;
  const marks = n > 0 ? `${n} mark${n === 1 ? "" : "s"}` : "Markup";
  return notes > 0 ? `${marks} · ${notes} note${notes === 1 ? "" : "s"}` : marks;
}

/** The numbered notes a markup carries — "① make this primary" — in the
 * order the badges on the sheet wear. Under the chip in a thread, under the
 * sheet in the window, and under the pill before posting: one list. */
export function MarkupNotes({ notes }: { notes: readonly MarkupNote[] }) {
  return (
    <ol className="markup-notes" aria-label="Notes on the marks">
      {notes.map((note) => (
        <li key={note.n}>
          <span className="markup-notes-n">{note.n}</span>
          <span className="markup-notes-text">{note.text}</span>
          <span className="markup-notes-shape">{note.shape}</span>
        </li>
      ))}
    </ol>
  );
}

/** Under a posted comment: "✎ 3 marks on Checkout" — click to see them. */
export function CommentMarkupChip({ canvasId, markup }: { canvasId: string; markup: CommentMarkup }) {
  const title = useCanvasStore((s) => (s.canvasId === canvasId ? s.canvas?.items[markup.itemId]?.title : undefined));
  return (
    <div className="comment-markup-block">
      <button
        type="button"
        className="comment-markup"
        title="Open the screen with these marks over it"
        onClick={(e) => {
          e.stopPropagation();
          void import("./MarkupModal.tsx").then((m) => m.openMarkupView({ canvasId, markup }));
        }}
      >
        <span className="glyph">{NIB}</span>
        <b>{words(markup)}</b>
        <span className="on">on {title ?? "a screen no longer here"}</span>
      </button>
      {markup.notes && markup.notes.length > 0 && <MarkupNotes notes={markup.notes} />}
    </div>
  );
}

/** In the composer, before posting: the same pill, with a way to drop it. */
export function PendingMarkupChip({ canvasId, markup, onDrop }: { canvasId: string; markup: CommentMarkup; onDrop: () => void }) {
  return (
    <div className="comment-markup-block">
      <span className="comment-markup" title="Attached to this comment — click to preview">
        <span
          role="button"
          tabIndex={0}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
          onClick={() => void import("./MarkupModal.tsx").then((m) => m.openMarkupView({ canvasId, markup }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") void import("./MarkupModal.tsx").then((m) => m.openMarkupView({ canvasId, markup }));
          }}
        >
          <span className="glyph">{NIB}</span>
          <b>{words(markup)}</b>
          <span className="on">attached</span>
        </span>
        <button type="button" className="comment-markup-drop" title="Remove the markup from this comment" aria-label="Remove markup" onClick={onDrop}>
          ✕
        </button>
      </span>
      {markup.notes && markup.notes.length > 0 && <MarkupNotes notes={markup.notes} />}
    </div>
  );
}
