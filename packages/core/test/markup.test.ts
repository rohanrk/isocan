import { describe, expect, it } from "vitest";
import {
  blobsNamedBy,
  drawingSvg,
  drawingViewBox,
  inkBounds,
  inkFromSvg,
  INK_PADDING,
  MARKUP_FILENAME,
  markBadgeAt,
  markBounds,
  markToStrokes,
  markupNotes,
  markupSheetMarks,
  markupSheetNotes,
  markupSheetSvg,
  markupSvg,
  OpValidationError,
  shapeBounds,
  shapeSvg,
  type CommentMarkup,
  type InkStroke,
  type Mark,
  type Operation,
} from "../src/index.ts";
import { apply as applyMaybe, seedState } from "./helpers.ts";
import type { CanvasState } from "../src/index.ts";

/** `apply`, with the one answer a comment op can give: a state. */
function apply(state: CanvasState, op: Operation): CanvasState {
  return applyMaybe(state, op)!;
}

function stroke(points: Array<[number, number]>, width = 4, color = "#c93a55"): InkStroke {
  return { points: points.map(([x, y]) => ({ x, y })), color, width };
}

const SCRIBBLE: Mark = { kind: "stroke", stroke: stroke([[20, 20], [60, 40], [30, 80]]) };
const ARROW: Mark = { kind: "shape", shape: "arrow", drag: { x1: 300, y1: 300, x2: 120, y2: 60 }, color: "#1e6fd9", width: 3 };
const BOX: Mark = { kind: "shape", shape: "rect", drag: { x1: 100, y1: 100, x2: 240, y2: 180 }, color: "#c93a55", width: 4 };

describe("markBounds", () => {
  it("is null with nothing to draw, and ignores empty strokes", () => {
    expect(markBounds([])).toBeNull();
    expect(markBounds([{ kind: "stroke", stroke: stroke([]) }])).toBeNull();
  });

  it("is the union of every mark's own padded box", () => {
    const b = markBounds([SCRIBBLE, ARROW, BOX])!;
    expect(b).toEqual({
      minX: 20 - 2 - INK_PADDING, // the scribble's left edge
      minY: 20 - 2 - INK_PADDING, // the scribble's top
      maxX: 300 + 1.5 + INK_PADDING, // the arrow's start, far right
      maxY: 300 + 1.5 + INK_PADDING, // the arrow's start, far down
    });
    // Each mark alone is inside it.
    for (const one of [inkBounds([SCRIBBLE.stroke]), shapeBounds(ARROW.drag, 3), shapeBounds(BOX.drag, 4)]) {
      expect(one!.minX).toBeGreaterThanOrEqual(b.minX);
      expect(one!.maxY).toBeLessThanOrEqual(b.maxY);
    }
  });
});

describe("markupSvg", () => {
  const marks = [SCRIBBLE, ARROW, BOX];
  const bounds = markBounds(marks)!;
  const svg = markupSvg(marks, bounds);

  it("is one document holding every mark, in the drawing's viewBox convention", () => {
    expect(svg.match(/<svg /g)).toHaveLength(1);
    expect(svg).toContain("<path "); // the scribble
    expect(svg).toContain("<polygon "); // the arrowhead
    expect(svg).toContain("<rect "); // the box
    expect(drawingViewBox(svg)).toEqual(bounds);
  });

  it("writes a stroke exactly as drawingSvg does, so inkFromSvg reads it back", () => {
    const alone = inkBounds([SCRIBBLE.stroke])!;
    expect(markupSvg([SCRIBBLE], alone)).toBe(drawingSvg([SCRIBBLE.stroke], alone));
    // The reader keeps on-curve points only (see `inkFromSvg`), so the fair
    // comparison is with what a Pen drawing of the same stroke reads back as.
    expect(inkFromSvg(svg)).toEqual(inkFromSvg(drawingSvg([SCRIBBLE.stroke], alone)));
    expect(inkFromSvg(svg)[0]?.color).toBe("#c93a55");
  });

  it("writes a shape exactly as shapeSvg does", () => {
    const alone = shapeBounds(BOX.drag, BOX.width);
    expect(markupSvg([BOX], alone)).toBe(shapeSvg("rect", BOX.drag, BOX.color, BOX.width));
  });

  it("never lets a colour out of the attribute", () => {
    const bad: Mark = { ...BOX, color: '" onload="alert(1)' };
    expect(markupSvg([bad], bounds)).not.toContain("onload");
  });
});

describe("markToStrokes", () => {
  it("hands drawingProperties every colour in the markup, shapes included", () => {
    const strokes = markToStrokes([SCRIBBLE, ARROW, BOX]);
    expect(strokes.map((s) => s.color)).toEqual(["#c93a55", "#1e6fd9", "#c93a55"]);
  });
});

describe("a markup sheet", () => {
  const marks = [SCRIBBLE, ARROW, BOX];

  it("is the item's own viewBox, from its top-left, so it lays over the item 1:1", () => {
    const svg = markupSheetSvg(marks, 800, 600);
    expect(drawingViewBox(svg)).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
    // The marks themselves are untouched — no translation into the sheet.
    expect(svg).toContain('x="100" y="100"'); // the box's own corner
  });

  it("counts one primitive per mark — an arrow's head is not a second mark", () => {
    expect(markupSheetMarks(markupSheetSvg(marks, 800, 600))).toBe(3);
    expect(markupSheetMarks(markupSheetSvg([], 10, 10))).toBe(0);
  });

  it("is named so an export and a download say what the bytes are", () => {
    expect(MARKUP_FILENAME).toMatch(/\.svg$/);
  });
});

describe("notes on shapes", () => {
  const SAID_ARROW: Mark = { ...ARROW, label: "Make this the primary button" };
  const SAID_BOX: Mark = { ...BOX, label: "  Tighten <this> & drop the border  " };
  const QUIET: Mark = { ...BOX, drag: { x1: 500, y1: 500, x2: 400, y2: 450 } };

  it("sit where the hand began: an arrow's tail, a box's top-left; a stroke has none", () => {
    expect(markBadgeAt(ARROW)).toEqual({ x: 300, y: 300 });
    expect(markBadgeAt(QUIET)).toEqual({ x: 400, y: 450 });
    expect(markBadgeAt(SCRIBBLE)).toBeNull();
  });

  it("are numbered in drawing order over the labelled shapes only, trimmed", () => {
    const notes = markupNotes([SCRIBBLE, QUIET, SAID_ARROW, { ...BOX, label: "   " }, SAID_BOX]);
    expect(notes).toEqual([
      { n: 1, shape: "arrow", text: "Make this the primary button", x: 300, y: 300 },
      { n: 2, shape: "rect", text: "Tighten <this> & drop the border", x: 100, y: 100 },
    ]);
  });

  it("appear on the sheet as numbered badges after the marks, with the words escaped, and read back", () => {
    const svg = markupSheetSvg([SCRIBBLE, SAID_ARROW, QUIET, SAID_BOX], 800, 600);
    expect(svg).toContain('data-note="1" data-shape="arrow"');
    expect(svg).toContain("<title>2. Tighten &lt;this&gt; &amp; drop the border</title>");
    expect(svg).not.toContain("<this>");
    expect(svg.indexOf("<circle")).toBeGreaterThan(svg.lastIndexOf("<rect"));
    // A badge is not a mark.
    expect(markupSheetMarks(svg)).toBe(4);
    // The sheet alone says what it says: fetched and re-attached, it keeps its words.
    expect(markupSheetNotes(svg)).toEqual(markupNotes([SCRIBBLE, SAID_ARROW, QUIET, SAID_BOX]));
    expect(markupSheetNotes(markupSheetSvg([SCRIBBLE, QUIET], 10, 10))).toEqual([]);
  });
});

describe("a comment carrying a markup", () => {
  const markup: CommentMarkup = {
    itemId: "itm_1",
    versionId: "ver_1",
    blobHash: "sha_markup",
    mimeType: "image/svg+xml",
    filename: MARKUP_FILENAME,
    size: 321,
    width: 800,
    height: 600,
    marks: 3,
  };
  const create = (m: unknown): Operation => ({
    type: "thread.create",
    threadId: "thr_m",
    x: 10,
    y: 10,
    anchorItemId: "itm_1",
    comment: { id: "cmt_m", body: "move this up", markup: m as CommentMarkup },
  });

  it("keeps the markup on the stamped comment, on create and on reply", () => {
    let s = apply(seedState(), create(markup));
    expect(s.canvas.threads["thr_m"]!.comments[0]!.markup).toEqual(markup);
    s = apply(s, { type: "thread.reply", threadId: "thr_m", comment: { id: "cmt_r", body: "and this", markup: { ...markup, blobHash: "sha_two" } } });
    expect(s.canvas.threads["thr_m"]!.comments[1]!.markup?.blobHash).toBe("sha_two");
  });

  it("drops what it does not know and keeps what is optional only when given", () => {
    const s = apply(seedState(), create({ ...markup, versionId: undefined, marks: undefined, extra: "no" }));
    const kept = s.canvas.threads["thr_m"]!.comments[0]!.markup!;
    expect(kept).not.toHaveProperty("extra");
    expect(kept).not.toHaveProperty("versionId");
    expect(kept).not.toHaveProperty("marks");
  });

  it("refuses a markup with no blob, or with a sheet of no size", () => {
    for (const bad of [{ ...markup, blobHash: "" }, { ...markup, width: 0 }, { ...markup, height: Number.NaN }, { ...markup, notes: "no" }, { ...markup, notes: [{ n: 1, text: "x", x: Number.NaN, y: 0 }] }]) {
      try {
        apply(seedState(), create(bad));
        expect.unreachable("expected a bad-op");
      } catch (err) {
        expect(err).toBeInstanceOf(OpValidationError);
        expect((err as OpValidationError).code).toBe("bad-op");
      }
    }
  });

  it("keeps the notes, trimmed, and lets a wordless one go", () => {
    const notes = [
      { n: 1, shape: "arrow", text: "  Make this primary ", x: 300, y: 300 },
      { n: 2, shape: "rect", text: "   ", x: 1, y: 1 },
    ];
    const s = apply(seedState(), create({ ...markup, notes }));
    expect(s.canvas.threads["thr_m"]!.comments[0]!.markup!.notes).toEqual([{ n: 1, shape: "arrow", text: "Make this primary", x: 300, y: 300 }]);
    const none = apply(seedState(), create({ ...markup, notes: [notes[1]] }));
    expect(none.canvas.threads["thr_m"]!.comments[0]!.markup).not.toHaveProperty("notes");
  });

  it("survives an edit of the words — the marks are not re-resolved from the body", () => {
    let s = apply(seedState(), create(markup));
    s = apply(s, { type: "comment.update", threadId: "thr_m", commentId: "cmt_m", body: "move this DOWN" });
    expect(s.canvas.threads["thr_m"]!.comments[0]!.markup).toEqual(markup);
  });

  it("names its blob the way a version does, so the GC walk retains it unasked", () => {
    const s = apply(seedState(), create(markup));
    expect(blobsNamedBy([], s).get("sha_markup")).toEqual({ mimeType: "image/svg+xml", filename: MARKUP_FILENAME, size: 321 });
  });
});
