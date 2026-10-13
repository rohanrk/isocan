// @vitest-environment jsdom
/**
 * The markup window zooms the THING BEING MARKED UP, not the canvas behind
 * it: ⌘= ⌘− ⌘0 and the − % + control change the paper's scale, a ⌘-wheel
 * over the stage is consumed before it can reach the canvas's window-level
 * listener, and the window's root is marked so the canvas yields anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { CanvasContents, Item } from "@isocan/core";

vi.mock("../src/lib/api.ts", async (original) => {
  const real = await original<typeof import("../src/lib/api.ts")>();
  return { ...real, blobUrl: () => "blob:sheet", uploadBlob: vi.fn() };
});

import { openMarkupView } from "../src/components/MarkupModal.tsx";
import { useCanvasStore } from "../src/stores/canvasStore.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ada = { id: "usr_acme_ada", name: "Ada" };
const when = "2026-10-06T12:00:00.000Z";
const screen: Item = {
  id: "itm_screen", x: 0, y: 0, width: 800, height: 600, title: "checkout.html", description: "", properties: {},
  versions: [{ id: "ver_1", blobHash: "sha_1", mimeType: "text/html", filename: "checkout.html", size: 1, createdAt: when, createdBy: ada }],
  currentVersionId: "ver_1", createdAt: when, createdBy: ada, updatedAt: when, updatedBy: ada,
};
const canvas: CanvasContents = { items: { itm_screen: screen }, threads: {}, trash: [], agents: {} };
const markup = { itemId: "itm_screen", versionId: "ver_1", blobHash: "sha_sheet", mimeType: "image/svg+xml", filename: "markup.svg", size: 9, width: 800, height: 600, marks: 1 };

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
  // jsdom lays nothing out: give the stage a size so "fit" is a real number.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.classList.contains("markup-stage") ? 424 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.classList.contains("markup-stage") ? 324 : 0; } });
  useCanvasStore.setState({ canvasId: "prj_acme", canvas });
  act(() => openMarkupView({ canvasId: "prj_acme", markup }));
});
afterEach(() => {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  document.querySelector("[data-markup-modal]")?.remove();
  vi.unstubAllGlobals();
});

const paper = () => document.querySelector<HTMLDivElement>(".markup-paper")!;
const percent = () => document.querySelector(".markup-zoom-value")!.textContent;
const key = (k: string) => act(() => document.querySelector(".markup-stage")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, metaKey: true, bubbles: true })));

describe("the markup window's zoom", () => {
  it("opens fitted to the window and says so", () => {
    // 424−24 = 400 wide for an 800 document: half size.
    expect(paper().style.width).toBe("400px");
    expect(percent()).toBe("50%");
    expect(document.querySelector('[aria-label="Fit"]'), "nothing to fit back to yet").toBeNull();
  });

  it("steps with ⌘= and ⌘−, refits with ⌘0, and the control does the same", () => {
    key("=");
    expect(percent()).toBe("63%");
    expect(paper().style.width).toBe("500px");
    key("-");
    expect(percent()).toBe("50%");
    act(() => (document.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click());
    expect(document.querySelector('[aria-label="Fit"]'), "a way back once zoomed").toBeTruthy();
    key("0");
    expect(percent()).toBe("50%");
    // The percentage itself: fitted → 100%.
    act(() => (document.querySelector(".markup-zoom-value") as HTMLButtonElement).click());
    expect(percent()).toBe("100%");
    expect(paper().style.width).toBe("800px");
  });

  it("takes a ⌘-wheel over the stage for itself and marks its root, so the canvas never zooms underneath", () => {
    const reachedWindow = vi.fn();
    window.addEventListener("wheel", reachedWindow, { capture: true });
    const stage = document.querySelector(".markup-stage")!;
    const e = new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void stage.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
    expect(parseFloat(paper().style.width)).toBeGreaterThan(400);
    // The canvas's own listener is on the window, in capture; it sees the
    // event first and must step aside — which it does by this attribute.
    expect((reachedWindow.mock.calls[0]![0] as Event).target).toBe(stage);
    expect(stage.closest("[data-owns-zoom]")).toBeTruthy();
    window.removeEventListener("wheel", reachedWindow, { capture: true });
  });
});
