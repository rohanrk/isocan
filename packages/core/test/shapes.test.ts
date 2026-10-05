import { describe, expect, it } from "vitest";
import {
  DRAWING_KIND,
  INK_PADDING,
  drawingViewBox,
  inkFromSvg,
  shapeBounds,
  shapeSvg,
  shapeToStrokes,
  type ShapeDrag,
  type ShapeTool,
} from "../src/index.ts";

// A drag from bottom-right to top-left, on purpose: every shape has to
// normalise it, and a rect with a negative width is an SVG that draws nothing.
const BACKWARDS: ShapeDrag = { x1: 140, y1: 180, x2: 100, y2: 100 };
const SHAPES: ShapeTool[] = ["arrow", "rect", "ellipse", "line"];

describe("shapeBounds", () => {
  it("is the drag's box grown by half the stroke and the padding, whichever way it was dragged", () => {
    expect(shapeBounds(BACKWARDS, 4)).toEqual({
      minX: 100 - 2 - INK_PADDING,
      minY: 100 - 2 - INK_PADDING,
      maxX: 140 + 2 + INK_PADDING,
      maxY: 180 + 2 + INK_PADDING,
    });
    const forwards = { x1: 100, y1: 100, x2: 140, y2: 180 };
    expect(shapeBounds(forwards, 4)).toEqual(shapeBounds(BACKWARDS, 4));
  });
});

describe("shapeSvg", () => {
  it("uses the same viewBox convention as a freehand drawing: the box IS world space", () => {
    for (const shape of SHAPES) {
      const svg = shapeSvg(shape, BACKWARDS, "#c93a55", 4);
      const b = shapeBounds(BACKWARDS, 4);
      expect(svg).toContain(
        `viewBox="${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}"`,
      );
      // The reader placement and annotation use sees the same box back.
      expect(drawingViewBox(svg)).toEqual(b);
      expect(svg).toContain('stroke="#c93a55"');
    }
  });

  it("is not freehand ink to the stroke reader, which is why shapeToStrokes exists", () => {
    // `inkFromSvg` round-trips the closed `<path>` format and nothing else; a
    // shape's colour reaches `properties.ink` through the synthetic strokes at
    // creation time, not by reading the SVG back.
    expect(inkFromSvg(shapeSvg("rect", BACKWARDS, "#c93a55", 4))).toEqual([]);
  });

  it("normalises a backwards drag so the rect and ellipse have positive size", () => {
    expect(shapeSvg("rect", BACKWARDS, "#000", 2)).toContain(
      'x="100" y="100" width="40" height="80"',
    );
    expect(shapeSvg("ellipse", BACKWARDS, "#000", 2)).toContain(
      'cx="120" cy="140" rx="20" ry="40"',
    );
  });

  it("keeps the line and arrow pointing the way they were drawn", () => {
    expect(shapeSvg("line", BACKWARDS, "#000", 2)).toContain(
      'x1="140" y1="180" x2="100" y2="100"',
    );
    const arrow = shapeSvg("arrow", BACKWARDS, "#000", 2);
    // The shaft starts where the drag started and the head is at its end.
    expect(arrow).toContain('x1="140" y1="180"');
    expect(arrow).toContain("<polygon");
    expect(arrow).toContain("100,100");
  });

  it("refuses a colour that could break out of the attribute", () => {
    const svg = shapeSvg("rect", BACKWARDS, '" onload="alert(1)', 2);
    expect(svg).not.toContain("onload");
  });
});

describe("shapeToStrokes", () => {
  it("is one stroke in the shape's ink, enough for the colour reader", () => {
    const strokes = shapeToStrokes(BACKWARDS, "#c93a55", 4);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe("#c93a55");
    expect(strokes[0].width).toBe(4);
    expect(strokes[0].points).toEqual([
      { x: 140, y: 180 },
      { x: 100, y: 100 },
    ]);
  });
});

// A shape is a drawing; it never grew a kind of its own.
it("has no shape kind — a shape is a drawing", () => {
  expect(DRAWING_KIND).toBe("drawing");
});
