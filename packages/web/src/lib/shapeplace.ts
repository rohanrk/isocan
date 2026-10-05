/**
 * Place a finished shape as a canvas item — the shape equivalent of
 * `sketchplace.ts`. A shape is a drawing in every way: same `item.add`,
 * same `properties.kind = "drawing"`, same annotation detection, same comment
 * auto-open. The only difference is the SVG comes from `shapeSvg` instead of
 * `drawingSvg`.
 */

import type { Actor, CanvasContents, ShapeDrag, ShapeTool } from "@isocan/core";
import {
  annotationProperties,
  annotationTargetAt,
  annotationTargetFor,
  DRAWING_FILENAME,
  DRAWING_MIME,
  DRAWING_TITLE,
  newItemId,
  newVersionId,
  regionOf,
  shapeBounds,
  shapeSvg,
  shapeToStrokes,
} from "@isocan/core";
import { useCanvasStore } from "../stores/canvasStore.ts";
import { useUiStore } from "../stores/uiStore.ts";
import { sendCreatedItem, creationDestination } from "./groupplacement.ts";
import { uploadOrStageTextBlob } from "./upload.ts";

export async function placeShape(
  canvasId: string,
  actor: Actor,
  shape: ShapeTool,
  drag: ShapeDrag,
  color: string,
  strokeWidth: number,
): Promise<string> {
  const bounds = shapeBounds(drag, strokeWidth);
  const svg = shapeSvg(shape, drag, color, strokeWidth);

  // Use the synthetic strokes for colour detection — same path the Pen uses.
  const syntheticStrokes = shapeToStrokes(drag, color, strokeWidth);
  const { drawingProperties } = await import("@isocan/core/colour");
  const born = drawingProperties(syntheticStrokes);

  // Annotation detection. A box or a circle is ABOUT what it covers, so it
  // uses the Pen's share-of-box rule. An arrow is about what its TIP touches:
  // the shaft is drawn across empty canvas on purpose, so its box would
  // almost never clear the share test — and the region worth recording is
  // the spot pointed at, not the whole sweep of the shaft.
  const open = useCanvasStore.getState();
  const canvas: CanvasContents | null =
    open.canvasId === canvasId ? open.canvas : null;
  const items = canvas ? Object.values(canvas.items) : [];
  const inkBox = {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
  const tip = { x: drag.x2, y: drag.y2 };
  const target =
    shape === "arrow"
      ? annotationTargetAt(tip, items)
      : annotationTargetFor(inkBox, items);
  // What `region` describes: for an arrow, a dot the size of the arrowhead at
  // the tip; for everything else, the shape's own box.
  const regionBox =
    shape === "arrow"
      ? { x: tip.x - strokeWidth * 2, y: tip.y - strokeWidth * 2, width: strokeWidth * 4, height: strokeWidth * 4 }
      : inkBox;

  const destination = target
    ? { originGroupMode: creationDestination().originGroupMode }
    : creationDestination();

  const { upload, stagedBlob } = await uploadOrStageTextBlob(
    canvasId,
    svg,
    DRAWING_MIME,
    DRAWING_FILENAME,
  );
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
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      // Not `chosen`: like freehand ink, a shape is where the pen drew it,
      // meaningful by KIND rather than by gesture — `positionIsMeaningful`
      // keeps a drawing where it landed on that ground alone.
      placement: { x: bounds.minX, y: bounds.minY },
      title: DRAWING_TITLE,
      properties: target
        ? {
            ...born,
            ...annotationProperties(
              target.id,
              regionOf(regionBox, target),
            ),
          }
        : born,
    },
    undefined,
    { allowQueued: true, ...(stagedBlob ? { stagedBlob } : {}) },
  );

  // Select the new shape, and open the comment composer if it annotates something.
  if (useCanvasStore.getState().canvasId !== canvasId) return itemId;
  useUiStore.getState().select(itemId);
  if (target) {
    // The pin sits where the markup is: at the tip for an arrow, above the
    // shape for the rest.
    const pin =
      shape === "arrow"
        ? { x: tip.x - target.x, y: tip.y - target.y }
        : { x: (bounds.minX + bounds.maxX) / 2 - target.x, y: bounds.minY - target.y };
    useUiStore.getState().setPendingComment({
      ...pin,
      anchorItemId: target.id,
      aboutItemId: itemId,
    });
  }
  return itemId;
}
