import { describe, expect, it } from "vitest";
import type { CanvasContents, Item } from "../src/model.ts";
import { convergeOps, convergePlan, isRefusal, nextOf } from "../src/converge.ts";
import { lineageProperties } from "../src/lineage.ts";

/**
 * **The half of diverge/converge the whole category left undone.**
 *
 * `/variation` makes siblings and each says what it was made from. Nothing
 * could ever say "this is the one", so a canvas accumulates four screens
 * where a decision was made about one, and the decision is recorded nowhere.
 *
 * Every refusal here is a sentence rather than a boolean, because each of
 * them is something somebody could reasonably try and "cannot converge" tells
 * them nothing about which assumption was wrong.
 */
const actor = { id: "usr_1", name: "Di" };
const version = (id: string) => ({
  id, blobHash: `sha_${id}`, mimeType: "text/html", filename: `${id}.html`,
  size: 1, createdAt: "2026-01-01T00:00:00.000Z", createdBy: actor,
});
const item = (id: string, title: string, props: Record<string, string> = {}): Item =>
  ({
    id, title, x: 0, y: 0, width: 10, height: 10, description: "",
    properties: props, versions: [version(`${id}_v1`)], currentVersionId: `${id}_v1`,
    createdAt: "2026-01-01T00:00:00.000Z", createdBy: actor,
    updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: actor,
  }) as unknown as Item;
const canvasOf = (items: Item[]): CanvasContents =>
  ({ items: Object.fromEntries(items.map((i) => [i.id, i])), threads: {} }) as unknown as CanvasContents;

const source = () => item("itm_src", "Checkout");
const child = (id: string, title: string) => item(id, title, lineageProperties("itm_src"));

describe("choosing one", () => {
  it("folds the winner onto its source and clears the exploration", () => {
    const canvas = canvasOf([source(), child("itm_a", "Bold"), child("itm_b", "Quiet")]);
    const plan = convergePlan(canvas, "itm_a");
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.parentId).toBe("itm_src");
    expect(plan.version.blobHash).toBe("sha_itm_a_v1");
    // The winner goes to the trash TOO, and that is the point rather than an
    // oversight: its content now lives on the parent's stack, so leaving it
    // would be two copies of one decision and an invitation to edit the wrong
    // one. Nothing is lost — the trash is reversible.
    expect(plan.trash.sort()).toEqual(["itm_a", "itm_b"]);
  });

  it("names the decision, which is what the group label carries", () => {
    const canvas = canvasOf([source(), child("itm_a", "Bold")]);
    const plan = convergePlan(canvas, "itm_a");
    if (isRefusal(plan)) throw new Error(plan.refused);
    // A label on the GROUP rather than a name on the version: it is the name
    // of the decision, and the decision is the group.
    expect(plan.label).toBe("chose Bold");
  });

  it("works on an only child", () => {
    const canvas = canvasOf([source(), child("itm_a", "Bold")]);
    const plan = convergePlan(canvas, "itm_a");
    expect(isRefusal(plan)).toBe(false);
  });
});

describe("what it will not do, and says why", () => {
  it("refuses an item that was not made from anything", () => {
    const plan = convergePlan(canvasOf([source()]), "itm_src");
    expect(isRefusal(plan) && plan.refused).toContain("not made from anything");
  });

  it("refuses when the source has been deleted since", () => {
    // Reachable: explore from a screen, then trash the screen. The children
    // still name a parent that is not there.
    const orphan = child("itm_a", "Bold");
    expect(isRefusal(convergePlan(canvasOf([orphan]), "itm_a")) && "yes").toBe("yes");
    const plan = convergePlan(canvasOf([orphan]), "itm_a");
    expect(isRefusal(plan) && plan.refused).toContain("no longer on the canvas");
  });

  it("refuses an item that is not here at all", () => {
    const plan = convergePlan(canvasOf([source()]), "itm_nope");
    expect(isRefusal(plan) && plan.refused).toContain("no item itm_nope");
  });

  it("refuses an item with nothing in it", () => {
    const empty = { ...child("itm_a", "Bold"), versions: [], currentVersionId: "" } as unknown as Item;
    const plan = convergePlan(canvasOf([source(), empty]), "itm_a");
    expect(isRefusal(plan) && plan.refused).toContain("no content");
  });
});

describe("what a choice sends", () => {
  it("is the version onto the source first, then every child to the trash, then the words", () => {
    // Both surfaces send this list under one group; the order is part of
    // what they agree on, so the log reads the same from either. The post is
    // last so an agent it wakes reads a canvas where the fold already happened.
    const plan = convergePlan(canvasOf([source(), child("itm_a", "Bold"), child("itm_b", "Quiet")]), "itm_b");
    if (isRefusal(plan)) throw new Error(plan.refused);
    const ops = convergeOps(plan, { threadId: "thr_t", commentId: "cmt_t" });
    expect(ops[0]).toEqual({ type: "item.addVersion", itemId: "itm_src", version: plan.version });
    expect(ops.slice(1, -1)).toEqual(plan.trash.map((itemId) => ({ type: "item.delete", itemId })));
    expect(ops.at(-1)).toMatchObject({ type: "thread.create", threadId: "thr_t", anchorItemId: "itm_src", comment: { id: "cmt_t" } });
    expect(ops).toHaveLength(4);
  });
});

/**
 * **The decision is said** (docs/projects/exploration/design.md §1). Until
 * this, `choose` folded in silence: an agent parked on the source woke on a
 * bare `item.addVersion` and could not tell "go this way" from "I edited it".
 */
describe("the decision post", () => {
  const agent = { id: "usr_agent", name: "Scout" };
  const byAgent = (id: string, title: string): Item => {
    const it = child(id, title);
    const v = { ...it.versions[0]!, createdBy: agent };
    return { ...it, versions: [v] } as Item;
  };

  it("says what was chosen over what, in the canvas's order", () => {
    const plan = convergePlan(canvasOf([source(), child("itm_a", "Bold"), child("itm_b", "Quiet"), child("itm_c", "Loud")]), "itm_b");
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.post.body).toBe('Chose "Quiet" over "Bold", "Loud".');
    expect(plan.post.items).toEqual(["itm_src"]);
    expect(nextOf(plan.post.body)).toBeNull();
  });

  it("says only what was chosen when there was nothing else", () => {
    const plan = convergePlan(canvasOf([source(), child("itm_a", "Bold")]), "itm_a");
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.post.body).toBe('Chose "Bold".');
  });

  it("carries the next brief as a Next: line the agent half can read back", () => {
    const plan = convergePlan(canvasOf([source(), child("itm_a", "Bold"), child("itm_b", "Quiet")]), "itm_a", { then: "  make it real data " });
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.post.body).toBe('Chose "Bold" over "Quiet".\n\nNext: make it real data');
    expect(nextOf(plan.post.body)).toBe("make it real data");
    expect(nextOf("Chose \"Bold\".")).toBeNull();
    expect(nextOf("Next: not a decision")).toBeNull();
  });

  it("names the options' authors and not the chooser", () => {
    // An agent's round: every option's current version is the agent's. The
    // person choosing is left out — they are not told about their own pick.
    const canvas = canvasOf([source(), byAgent("itm_a", "Bold"), byAgent("itm_b", "Quiet"), child("itm_c", "Mine")]);
    const plan = convergePlan(canvas, "itm_a", { by: actor.id });
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.post.mentions).toEqual([agent.id]);
    const ops = convergeOps(plan, { threadId: "thr_t", commentId: "cmt_t" });
    expect(ops.at(-1)).toMatchObject({ comment: { mentions: [agent.id] } });
  });

  it("lands on the newest live thread anchored to the source, never the Chat", () => {
    const canvas = canvasOf([source(), child("itm_a", "Bold")]);
    (canvas as { threads: Record<string, unknown> }).threads = {
      thr_main: { id: "thr_main", anchorItemId: null, main: true, createdAt: "2026-01-03T00:00:00.000Z", comments: [] },
      thr_old: { id: "thr_old", anchorItemId: "itm_src", createdAt: "2026-01-01T00:00:00.000Z", comments: [] },
      thr_new: { id: "thr_new", anchorItemId: "itm_src", createdAt: "2026-01-02T00:00:00.000Z", comments: [] },
      thr_other: { id: "thr_other", anchorItemId: "itm_a", createdAt: "2026-01-04T00:00:00.000Z", comments: [] },
    };
    const plan = convergePlan(canvas, "itm_a", { by: actor.id });
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.post.threadId).toBe("thr_new");
    expect(convergeOps(plan, { commentId: "cmt_t" }).at(-1)).toEqual({
      type: "thread.reply", threadId: "thr_new", comment: { id: "cmt_t", body: 'Chose "Bold".', items: ["itm_src"] },
    });
  });

  it("starts a thread on the source when none is there", () => {
    const plan = convergePlan(canvasOf([source(), child("itm_a", "Bold")]), "itm_a");
    if (isRefusal(plan)) throw new Error(plan.refused);
    expect(plan.post.threadId).toBeNull();
    const last = convergeOps(plan).at(-1)!;
    expect(last.type).toBe("thread.create");
    if (last.type !== "thread.create") return;
    expect(last.anchorItemId).toBe("itm_src");
    expect(last.threadId).toMatch(/^thr_/);
    expect(last.comment.id).toMatch(/^cmt_/);
    expect(last.main).toBeUndefined();
  });
});
