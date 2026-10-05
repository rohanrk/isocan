/**
 * Place a finished markup as ONE canvas item — the modal's equivalent of
 * `sketchplace.ts` and `shapeplace.ts`. The difference from both: the target
 * is KNOWN. The modal opened on a particular screen, the marks were drawn in
 * that screen's own coordinates, and so there is no detection step — the
 * markup annotates the screen it was drawn on, and `region` is where on it.
 *
 * Still a drawing in every way: same `item.add`, same `properties.kind`,
 * same `annotates` + `region`, same blob format. Only the title differs
 * (`MARKUP_TITLE`), so `isocan ls` can tell a committed markup from a Pen
 * sketch.
 */

import type { Actor, Item, Mark } from "@isocan/core";
import {
  annotationProperties,
  DRAWING_FILENAME,
  DRAWING_MIME,
  MARKUP_TITLE,
  markBounds,
  markToStrokes,
  markupSvg,
  newItemId,
  newVersionId,
  regionOf,
} from "@isocan/core";
import { useCanvasStore } from "../stores/canvasStore.ts";
import { useUiStore } from "../stores/uiStore.ts";
import { sendCreatedItem, creationDestination } from "./groupplacement.ts";
import { uploadOrStageTextBlob } from "./upload.ts";

/** A mark drawn in an item's local space, moved into world space. */
function toWorld(mark: Mark, dx: number, dy: number): Mark {
  if (mark.kind === "stroke") {
    return {
      kind: "stroke",
      stroke: { ...mark.stroke, points: mark.stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
    };
  }
  return {
    ...mark,
    drag: { x1: mark.drag.x1 + dx, y1: mark.drag.y1 + dy, x2: mark.drag.x2 + dx, y2: mark.drag.y2 + dy },
  };
}

/**
 * Land `marks` (in `target`'s local coordinates — 0,0 is its top-left) as one
 * drawing annotating `target`. Resolves to the new item's id.
 */
export async function placeMarkup(
  canvasId: string,
  actor: Actor,
  target: Item,
  localMarks: readonly Mark[],
): Promise<string> {
  const marks = localMarks.map((m) => toWorld(m, target.x, target.y));
  const bounds = markBounds(marks);
  if (!bounds) throw new Error("Nothing to place — the markup is empty.");
  const svg = markupSvg(marks, bounds);

  // Colour the same way the Pen does: from the strokes, shapes included.
  const { drawingProperties } = await import("@isocan/core/colour");
  const born = drawingProperties(markToStrokes(marks));

  const inkBox = {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };

  // It annotates something, so it lives with that something: no group of its
  // own, the way `shapeplace.ts` and the Pen do it.
  const destination = { originGroupMode: creationDestination().originGroupMode };

  const { upload, stagedBlob } = await uploadOrStageTextBlob(canvasId, svg, DRAWING_MIME, DRAWING_FILENAME);
  const itemId = newItemId();
  await sendCreatedItem(
    canvasId,
    actor,
    {
      type: "item.add",
      ...destination,
      itemId,
      version: {
        id: newVersionId(),
        blobHash: upload.blobHash,
        mimeType: DRAWING_MIME,
        filename: DRAWING_FILENAME,
        size: upload.size,
      },
      width: inkBox.width,
      height: inkBox.height,
      // Not `chosen`: a markup is where it was drawn on its target, meaningful
      // by KIND rather than by gesture — `positionIsMeaningful` keeps a
      // drawing where it landed on that ground alone.
      placement: { x: bounds.minX, y: bounds.minY },
      title: MARKUP_TITLE,
      properties: {
        ...born,
        ...annotationProperties(target.id, regionOf(inkBox, target)),
      },
    },
    undefined,
    { allowQueued: true, ...(stagedBlob ? { stagedBlob } : {}) },
  );

  if (useCanvasStore.getState().canvasId === canvasId) useUiStore.getState().select(itemId);
  return itemId;
}
