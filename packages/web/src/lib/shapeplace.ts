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

  // Annotation detection: does this shape overlap an existing item?
  const open = useCanvasStore.getState();
  const canvas: CanvasContents | null =
    open.canvasId === canvasId ? open.canvas : null;
  const inkBox = {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
  const target =
    canvas
      ? annotationTargetFor(inkBox, Object.values(canvas.items))
      : null;

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
              regionOf(inkBox, target),
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
    useUiStore.getState().setPendingComment({
      x: (bounds.minX + bounds.maxX) / 2 - target.x,
      y: bounds.minY - target.y,
      anchorItemId: target.id,
      aboutItemId: itemId,
    });
  }
  return itemId;
}
