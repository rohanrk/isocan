import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Daemon } from "@isocan/server";
import { startDaemon } from "@isocan/server/daemon";
import { DaemonClient } from "@isocan/api";
import type { Operation } from "@isocan/core";
import { chooseVariation } from "../src/lib/choose.ts";
import { itemMenu } from "../src/lib/menuentries.tsx";
import { useCanvasStore } from "../src/stores/canvasStore.ts";
import type { MenuAction, MenuEntry } from "../src/components/ContextMenu.tsx";
import { cliEnv, runCli, type Run } from "../../cli/test/cli.ts";

/**
 * **Converging an exploration, on both surfaces, is one list of ops.**
 *
 * `isocan choose <item>` was the only way to say "this one won" — nothing in
 * the web imported `convergePlan`, and atlas/convergence.md said so: "no web
 * door". The item menu now offers "Choose this variation" on an item whose
 * source is still here, and it goes through core's `convergePlan` and
 * `convergeOps`, as the verb does. This holds them to it against a real
 * daemon: the ops the menu action WOULD send (its sender swapped for a
 * recorder) equal the ops the CLI binary logged, both under one group — and
 * one undo of the CLI's takes the whole decision back.
 *
 * Synthetic throughout: Acme's checkout screens.
 */

const acme = { id: "usr_acme", name: "Acme" };
let home: string;
let daemon: Daemon;
let port: string;
let client: DaemonClient;

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "isocan-choose-"));
  await fs.writeFile(path.join(home, "identity.json"), JSON.stringify({ ...acme, createdAt: new Date().toISOString() }));
  daemon = await startDaemon({ port: 0, home });
  const address = daemon.app.server.address();
  port = String(typeof address === "object" && address ? address.port : 0);
  client = new DaemonClient(`http://127.0.0.1:${port}`, home);
});

afterAll(async () => {
  await daemon.close();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function isocan(...args: string[]): Promise<Run> {
  return runCli(args, { cwd: home, env: cliEnv({ ISOCAN_HOME: home, ISOCAN_PORT: port }) });
}

async function ok(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const run = await isocan(...args);
  expect(run.code, run.stderr).toBe(0);
  return run;
}

async function screen(canvas: string, name: string, ...flags: string[]): Promise<string> {
  const file = path.join(home, `${name}.html`);
  await fs.writeFile(file, `<!doctype html><title>${name}</title><p>Acme ${name}</p>`);
  return JSON.parse((await ok("--canvas", canvas, "--json", "add", file, "--title", name, ...flags)).stdout).itemId;
}

const labels = (entries: MenuEntry[]) =>
  entries.filter((e): e is MenuAction => !("separator" in e)).map((a) => a.label);

describe("choose — the item menu and the CLI send one list of ops", () => {
  it("folds the winner onto its source, trashes the exploration, and undoes as one", async () => {
    const canvas = JSON.parse((await ok("--json", "canvas", "create", "Acme choose")).stdout).canvasId;
    const source = await screen(canvas, "Acme checkout");
    const bold = await screen(canvas, "Acme bold", "--prop", `parent=${source}`, "--at", "0,400");
    const quiet = await screen(canvas, "Acme quiet", "--prop", `parent=${source}`, "--at", "500,400");

    // The menu offers it on a variation, and not on the thing it came from.
    useCanvasStore.setState({ canvas: (await client.snapshot(canvas)).canvas });
    const ctx = { canvasId: canvas, actor: acme, world: { x: 0, y: 0 }, navigate: () => {} };
    const items = useCanvasStore.getState().canvas!.items;
    expect(labels(itemMenu([items[bold]!], ctx))).toContain("Choose this variation");
    expect(labels(itemMenu([items[source]!], ctx))).not.toContain("Choose this variation");

    // What the menu entry would send, recorded rather than sent.
    const sent: Array<{ op: Operation; group: string }> = [];
    const ops = await chooseVariation(canvas, acme, bold, async (op, group) => void sent.push({ op, group }));
    expect(ops, "the web action refused").not.toBeNull();
    expect(new Set(sent.map((s) => s.group)).size, "one group, so one ⌘Z").toBe(1);
    expect(sent[0]!.op).toMatchObject({ type: "item.addVersion", itemId: source });
    expect(sent.slice(1, -1).map((s) => s.op)).toEqual(
      expect.arrayContaining([bold, quiet].map((itemId) => ({ type: "item.delete", itemId }))),
    );
    // The decision is said, last, on the source — the words an agent parked
    // on `wait --item <source>` wakes to (docs/projects/exploration/design.md).
    expect(sent.at(-1)!.op).toMatchObject({
      type: "thread.create",
      anchorItemId: source,
      comment: { body: 'Chose "Acme bold" over "Acme quiet".', items: [source] },
    });
    expect(sent).toHaveLength(4);

    // The CLI, over the same canvas: the same ops, in the same order, one
    // group — up to the ids the post mints on each side.
    const before = (await client.getLog(canvas, 0)).length;
    await ok("--canvas", canvas, "choose", bold, "--then", "make it real data");
    const logged = (await client.getLog(canvas, 0)).slice(before);
    const shape = (op: Operation) =>
      op.type === "thread.create"
        ? { ...op, threadId: "<minted>", comment: { ...op.comment, id: "<minted>", body: op.comment.body.split("\n")[0] } }
        : op;
    expect(logged.map((e) => shape(e.envelope.op))).toEqual(sent.map((s) => shape(s.op)));
    expect(new Set(logged.map((e) => e.group)).size).toBe(1);
    expect(logged[0]!.group).toBeTruthy();

    const after = (await client.snapshot(canvas)).canvas;
    expect(after.items[source]!.versions).toHaveLength(2);
    expect(after.items[bold]).toBeUndefined();
    expect(after.items[quiet]).toBeUndefined();
    const posted = Object.values(after.threads).find((t) => t.anchorItemId === source);
    expect(posted, "the decision was said on the source's thread").toBeDefined();
    expect(posted!.comments[0]!.body).toBe('Chose "Acme bold" over "Acme quiet".\n\nNext: make it real data');
    expect(posted!.comments[0]!.author.id).toBe(acme.id);
    // Acme made the options and Acme chose: nobody to name.
    expect(posted!.comments[0]!.mentions ?? []).toEqual([]);

    // One undo takes the whole decision back, the words included.
    await ok("--canvas", canvas, "undo");
    const undone = (await client.snapshot(canvas)).canvas;
    expect(undone.items[source]!.versions).toHaveLength(1);
    expect(undone.items[bold]).toBeDefined();
    expect(undone.items[quiet]).toBeDefined();
    expect(Object.values(undone.threads).find((t) => t.anchorItemId === source)).toBeUndefined();
  });

  it("replies on the source's thread when one exists, and names the options' author", async () => {
    const canvas = JSON.parse((await ok("--json", "canvas", "create", "Acme reply")).stdout).canvasId;
    const source = await screen(canvas, "Acme settings");
    // The conversation that asked for the options, pinned to the source.
    const asked = JSON.parse((await ok("--canvas", canvas, "--json", "comment", "add", "--item", source, "three directions please")).stdout);
    // The options, made by an agent — claimed on this badge and sent over the
    // API as that actor, the way the api fixtures seed a second agent.
    await client.claimActor({ type: "actor.claim", sessionKey: "acme:scout", name: "Scout" });
    const scout = (await client.actorBindings(["acme:scout"]))[0]!.actor;
    const made = async (name: string, x: number) => {
      const itemId = `itm_${name.replace(/\W/g, "_").toLowerCase()}`;
      const upload = await client.uploadBlob(canvas, Buffer.from(`<!doctype html><title>${name}</title>`), "text/html", `${name}.html`);
      await client.sendOp(canvas, scout, {
        type: "item.add", itemId, title: name, properties: { parent: source }, width: 400, height: 300,
        placement: { x, y: 400, chosen: true }, version: { id: `ver_${itemId}`, ...upload, filename: `${name}.html` },
      });
      return itemId;
    };
    const dense = await made("Acme dense", 0);
    const airy = await made("Acme airy", 500);
    expect((await client.snapshot(canvas)).canvas.items[dense]!.versions[0]!.createdBy.id).toBe(scout.id);

    const out = JSON.parse((await ok("--canvas", canvas, "--json", "choose", airy)).stdout);
    expect(out.threadId).toBe(asked.threadId);
    const thread = (await client.snapshot(canvas)).canvas.threads[asked.threadId]!;
    const post = thread.comments.at(-1)!;
    expect(post.id).toBe(out.commentId);
    expect(post.body).toBe('Chose "Acme airy" over "Acme dense".');
    expect(post.mentions).toEqual([scout.id]);
  });

  it("refuses what has nowhere to fold into, from the menu as from the CLI", async () => {
    const canvas = JSON.parse((await ok("--json", "canvas", "create", "Acme refusals")).stdout).canvasId;
    const lone = await screen(canvas, "Acme lone");
    useCanvasStore.setState({ canvas: (await client.snapshot(canvas)).canvas });
    const sent: Operation[] = [];
    expect(await chooseVariation(canvas, acme, lone, async (op) => void sent.push(op))).toBeNull();
    expect(sent).toEqual([]);
    const run = await isocan("--canvas", canvas, "choose", lone);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("was not made from anything");
  });
});
