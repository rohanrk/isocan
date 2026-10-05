import type { Mark, ShapeDrag } from "@isocan/core";
import { inkPath, shapeBounds } from "@isocan/core";
import { useUiStore } from "../stores/uiStore.ts";

/**
 * Live shape preview — the geometric shape being drawn right now, before it
 * settles into an item. Like InkLayer, it lives inside `.world` so the shape
 * is drawn in world coordinates and the canvas transform pans and zooms it.
 *
 * Renders an SVG sized to the shape's world bounding box, matching the same
 * convention as `shapeSvg` and `drawingSvg`.
 */
export function ShapePreview() {
  const drag = useUiStore((s) => s.shapeDrag);
  const inkColor = useUiStore((s) => s.inkColor);
  const penShape = useUiStore((s) => s.penShape);
  if (!drag || !penShape) return null;

  const color = inkColor ?? "var(--accent, #5b5fc7)";
  const strokeWidth = 3 / (useUiStore.getState().viewport.scale || 1);
  const bounds = shapeBounds(drag, strokeWidth);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) return null;

  return (
    <svg
      className="shape-preview"
      aria-hidden
      style={{ left: bounds.minX, top: bounds.minY, width, height }}
      viewBox={`${bounds.minX} ${bounds.minY} ${width} ${height}`}
    >
      <ShapeElement shape={penShape} drag={drag} color={color} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** Any mark as SVG JSX — the live form of what `markupSvg` writes. */
export function MarkElement({ mark }: { mark: Mark }) {
  if (mark.kind === "stroke") {
    if (mark.stroke.points.length === 0) return null;
    return (
      <path
        d={inkPath(mark.stroke.points)}
        fill="none"
        stroke={mark.stroke.color}
        strokeWidth={mark.stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  return <ShapeElement shape={mark.shape} drag={mark.drag} color={mark.color} strokeWidth={mark.width} />;
}

export function ShapeElement({
  shape,
  drag,
  color,
  strokeWidth,
}: {
  shape: string;
  drag: ShapeDrag;
  color: string;
  strokeWidth: number;
}) {
  switch (shape) {
    case "line":
      return (
        <line
          x1={drag.x1}
          y1={drag.y1}
          x2={drag.x2}
          y2={drag.y2}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      );
    case "arrow": {
      const headSize = Math.max(8, Math.min(20, strokeWidth * 4));
      const dx = drag.x2 - drag.x1;
      const dy = drag.y2 - drag.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const baseX = drag.x2 - ux * headSize;
      const baseY = drag.y2 - uy * headSize;
      const px = -uy * headSize * 0.45;
      const py = ux * headSize * 0.45;
      return (
        <>
          <line
            x1={drag.x1}
            y1={drag.y1}
            x2={baseX}
            y2={baseY}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          <polygon
            points={`${drag.x2},${drag.y2} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`}
            fill={color}
          />
        </>
      );
    }
    case "rect":
      return (
        <rect
          x={Math.min(drag.x1, drag.x2)}
          y={Math.min(drag.y1, drag.y2)}
          width={Math.abs(drag.x2 - drag.x1)}
          height={Math.abs(drag.y2 - drag.y1)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          rx={2}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={(drag.x1 + drag.x2) / 2}
          cy={(drag.y1 + drag.y2) / 2}
          rx={Math.abs(drag.x2 - drag.x1) / 2}
          ry={Math.abs(drag.y2 - drag.y1) / 2}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
        />
      );
    default:
      return null;
  }
}
