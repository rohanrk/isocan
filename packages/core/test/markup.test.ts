import { describe, expect, it } from "vitest";
import {
  drawingSvg,
  drawingViewBox,
  inkBounds,
  inkFromSvg,
  INK_PADDING,
  MARKUP_TITLE,
  DRAWING_TITLE,
  markBounds,
  markToStrokes,
  markupSvg,
  shapeBounds,
  shapeSvg,
  type InkStroke,
  type Mark,
} from "../src/index.ts";

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

it("lands under its own title, so `isocan ls` can tell it from a Pen sketch", () => {
  expect(MARKUP_TITLE).toBe("Markup");
  expect(MARKUP_TITLE).not.toBe(DRAWING_TITLE);
});
