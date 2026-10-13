// @vitest-environment jsdom
/**
 * **The comment draft is the markup's doorway, and who it goes to is the
 * last decision** (6 Oct 2026).
 *
 * Over a screen the draft wears a pen; the pen opens the markup window; what
 * comes back is a sheet ON THE DRAFT (never an item on the canvas); and the
 * same words then post one of two ways — for the people here, or to one
 * agent by name. Mounted for real: the pen's presence, the pill, and what
 * each send button puts in the op are the three things a reader of the
 * composer relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CanvasContents, CommentMarkup, Item } from "@isocan/core";

const sent = vi.hoisted(() => ({ ops: [] as unknown[] }));
vi.mock("../src/stores/canvasStore.ts", async (original) => {
  const real = await original<typeof import("../src/stores/canvasStore.ts")>();
  return {
    ...real,
    sendEchoedResult: vi.fn(async (_c: string, _a: unknown, op: unknown) => {
      sent.ops.push(op);
      return { status: "accepted" as const };
    }),
  };
});
// The kinds registry lives at the home; here Hiro is an agent and that is all.
vi.mock("../src/lib/actorkinds.ts", async (original) => {
  const real = await original<typeof import("../src/lib/actorkinds.ts")>();
  return { ...real, useActorKinds: () => ({ usr_acme_hiro: "agent" }) };
});
// The window is lazy-loaded; stand in for it and hand back a sheet.
const window = vi.hoisted(() => ({ opened: [] as unknown[] }));
vi.mock("../src/components/MarkupModal.tsx", () => ({
  openMarkup: (request: { itemId: string; onDone?: (m: CommentMarkup) => void }) => {
    window.opened.push(request);
    request.onDone?.({ itemId: request.itemId, blobHash: "sha_sheet", mimeType: "image/svg+xml", filename: "markup.svg", size: 99, width: 400, height: 300, marks: 2, notes: [{ n: 1, shape: "arrow", text: "Make this the primary button", x: 120, y: 340 }] });
  },
  openMarkupView: vi.fn(),
}));

import { ComposePopover } from "../src/components/CommentLayer.tsx";
import { useCanvasStore } from "../src/stores/canvasStore.ts";
import { useUiStore } from "../src/stores/uiStore.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ada = { id: "usr_acme_ada", name: "Ada" };
const hiro = { id: "usr_acme_hiro", name: "Hiro" };
const when = "2026-10-06T12:00:00.000Z";
function item(id: string, filename: string, mimeType: string): Item {
  return {
    id, x: 0, y: 0, width: 400, height: 300, title: filename, description: "", properties: {},
    versions: [{ id: `ver_${id}`, blobHash: `sha_${id}`, mimeType, filename, size: 1, createdAt: when, createdBy: ada }],
    currentVersionId: `ver_${id}`, createdAt: when, createdBy: ada, updatedAt: when, updatedBy: ada,
  };
}
const canvas: CanvasContents = {
  items: { itm_screen: item("itm_screen", "checkout.html", "text/html"), itm_note: item("itm_note", "notes.md", "text/markdown") },
  threads: {},
  trash: [],
  agents: { [hiro.id]: { actor: hiro, enrolledAt: when, writtenBy: ada } as never },
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  // jsdom has no ResizeObserver; the popover measures itself with one.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  sent.ops = [];
  window.opened = [];
  useCanvasStore.setState({ canvasId: "prj_acme", canvas });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => useUiStore.setState({ pendingComment: null }));
  vi.unstubAllGlobals();
});

function mount(anchorItemId: string) {
  const pending = { x: 10, y: 10, anchorItemId };
  act(() => useUiStore.setState({ pendingComment: pending }));
  act(() => root.render(h(ComposePopover, { canvasId: "prj_acme", actor: ada, pending: useUiStore.getState().pendingComment! })));
  return () => act(() => root.render(h(ComposePopover, { canvasId: "prj_acme", actor: ada, pending: useUiStore.getState().pendingComment! })));
}
function type(words: string) {
  const field = host.querySelector("textarea")!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { set.call(field, words); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label))!;
// The pen lazy-loads the window, so the sheet lands a tick after the click.
const pen = () => act(async () => { (host.querySelector('[aria-label="Mark up"]') as HTMLButtonElement).click(); });

describe("a comment draft over a screen", () => {
  it("wears a pen; a draft over a note does not", () => {
    mount("itm_screen");
    expect(host.querySelector('[aria-label="Mark up"]'), "the pen over a screen").toBeTruthy();
    act(() => root.unmount());
    root = createRoot(host);
    mount("itm_note");
    expect(host.querySelector('[aria-label="Mark up"]'), "no pen over words").toBeNull();
  });

  it("commits the window's sheet to the draft as a pill, with a way to drop it", async () => {
    const rerender = mount("itm_screen");
    await pen();
    rerender();
    expect(window.opened).toHaveLength(1);
    expect(useUiStore.getState().pendingComment?.markup?.blobHash).toBe("sha_sheet");
    expect(host.querySelector(".comment-markup")?.textContent).toContain("2 marks · 1 note");
    // The words the shape was given are read here before anything is sent.
    expect(host.querySelector(".markup-notes")?.textContent).toContain("Make this the primary button");
    expect(host.querySelector('[aria-label="Mark up again"]'), "the pen says it would redraw").toBeTruthy();
    act(() => (host.querySelector('[aria-label="Remove markup"]') as HTMLButtonElement).click());
    rerender();
    expect(useUiStore.getState().pendingComment?.markup).toBeUndefined();
    expect(host.querySelector(".comment-markup")).toBeNull();
  });

  it("offers Comment for the people here and → @Hiro for the agent, and posts the markup either way", async () => {
    const rerender = mount("itm_screen");
    await pen();
    rerender();
    type("Move the total above the line items");
    expect(button("Comment").disabled).toBe(false);
    expect(button("→ @Hiro"), "one button per agent on the canvas").toBeTruthy();

    await act(async () => { button("→ @Hiro").click(); });
    expect(sent.ops).toHaveLength(1);
    const op = sent.ops[0] as { type: string; anchorItemId: string; comment: { body: string; mentions?: string[]; markup?: CommentMarkup } };
    expect(op.type).toBe("thread.create");
    expect(op.anchorItemId).toBe("itm_screen");
    expect(op.comment.body).toBe("@Hiro Move the total above the line items");
    expect(op.comment.mentions).toEqual([hiro.id]);
    expect(op.comment.markup?.blobHash).toBe("sha_sheet");
    expect(op.comment.markup?.notes?.[0]?.text).toBe("Make this the primary button");
  });

  it("sends to the people here without naming anybody, and does not double a name already typed", async () => {
    mount("itm_screen");
    type("Looks good to me");
    await act(async () => { button("Comment").click(); });
    let op = sent.ops.at(-1) as { comment: { body: string; mentions?: string[] } };
    expect(op.comment.body).toBe("Looks good to me");
    expect(op.comment.mentions).toBeUndefined();

    act(() => root.unmount());
    root = createRoot(host);
    mount("itm_screen");
    type("@Hiro tighten the header");
    await act(async () => { button("→ @Hiro").click(); });
    op = sent.ops.at(-1) as { comment: { body: string; mentions?: string[] } };
    expect(op.comment.body).toBe("@Hiro tighten the header");
    expect(op.comment.mentions).toEqual([hiro.id]);
  });
});
