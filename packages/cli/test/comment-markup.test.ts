/**
 * A comment's markup, end to end through the CLI: attach a sheet to a
 * comment on a screen, see it in `comment ls`, fetch it back with
 * `comment markup` — and never find an item for it on the canvas, which is
 * the point: the screen stays clean and the comment carries the ask.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Daemon } from "@isocan/server";
import { startDaemon } from "@isocan/server/daemon";
import { cliEnv, runCli, type Run } from "./cli.ts";

const user = { id: "usr_kit", name: "Kit" };

let home: string;
let daemon: Daemon;
let base: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "isocan-cli-markup-"));
  await fs.writeFile(path.join(home, "identity.json"), JSON.stringify({ ...user, createdAt: new Date().toISOString() }));
  daemon = await startDaemon({ port: 0, home });
  const address = daemon.app.server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(async () => {
  await daemon.close();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function isocan(...args: string[]): Promise<Run> {
  return runCli(args, { cwd: home, env: cliEnv({ GEMINI_API_KEY: "", ISOCAN_HOME: home, ISOCAN_PORT: new URL(base).port }) });
}

async function json(...args: string[]): Promise<any> {
  const run = await isocan("--json", ...args);
  if (run.code !== 0) throw new Error(`isocan ${args.join(" ")} failed (${run.code}): ${run.stderr || run.stdout}`);
  return JSON.parse(run.stdout);
}

/** A sheet in a 400×300 screen's own coordinates: a box and an arrow, the
 * arrow with a note — the badge the window writes, by hand. */
const SHEET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect x="40" y="40" width="120" height="60" fill="none" stroke="#c93a55" stroke-width="3"/>
  <line x1="300" y1="250" x2="180" y2="110" stroke="#1e6fd9" stroke-width="3"/>
  <polygon points="180,110 195,112 190,124" fill="#1e6fd9"/>
  <g data-note="1" data-shape="arrow"><title>1. Put the total here &amp; make it bold</title><circle cx="300" cy="250" r="10" fill="#1e6fd9"/><text x="300" y="250">1</text></g>
</svg>`;

describe("a comment's markup, from the CLI", () => {
  it("attaches on add, shows in ls, fetches with `comment markup`, and puts nothing on the canvas", async () => {
    await fs.writeFile(path.join(home, "screen.html"), "<!DOCTYPE html><html><body><h1>Acme checkout</h1></body></html>");
    await fs.writeFile(path.join(home, "sheet.svg"), SHEET);
    const added = await json("add", "screen.html");
    const before = (await json("ls")).length;

    const started = await json("comment", "add", "Move the total up here", "--item", added.itemId, "--markup", "sheet.svg");
    expect(started.threadId).toBeDefined();

    // The comment carries it; the canvas does not.
    const threads = await json("comment", "ls");
    const thread = threads.find((t: any) => t.id === started.threadId);
    const markup = thread.comments[0].markup;
    expect(markup).toMatchObject({ itemId: added.itemId, mimeType: "image/svg+xml", width: 400, height: 300, marks: 2 });
    // The arrow's words ride on the comment, not only in the bytes.
    expect(markup.notes).toEqual([{ n: 1, shape: "arrow", text: "Put the total here & make it bold", x: 300, y: 250 }]);
    expect(markup.versionId).toBe((await json("show", added.itemId)).currentVersionId);
    expect((await json("ls")).length).toBe(before);

    // Plain `comment ls` says so, lists the note, and says how to fetch it.
    const listed = await isocan("comment", "ls");
    expect(listed.stdout).toContain("2 marks, 1 note on \"");
    expect(listed.stdout).toContain("1. Put the total here & make it bold  (arrow at 300,250)");
    expect(listed.stdout).toContain(`isocan comment markup ${started.threadId} ${started.commentId}`);

    // Fetch: to a file, to stdout, and the facts alone.
    const toFile = await isocan("comment", "markup", started.threadId, "back.svg");
    expect(toFile.code, toFile.stderr).toBe(0);
    expect(await fs.readFile(path.join(home, "back.svg"), "utf8")).toBe(SHEET);
    expect((await isocan("comment", "markup", started.threadId, started.commentId)).stdout).toBe(SHEET);
    const facts = await json("comment", "markup", started.threadId);
    expect(facts).toMatchObject({ threadId: started.threadId, commentId: started.commentId, itemTitle: expect.any(String), itemOnCanvas: true, marks: 2 });
    expect(facts.notes).toHaveLength(1);
    expect(facts.blobHash).toBe(markup.blobHash);
  });

  it("attaches on reply over the thread's anchor, and refuses when there is nothing to draw over", async () => {
    await fs.writeFile(path.join(home, "screen.html"), "<!DOCTYPE html><html><body><p>Acme</p></body></html>");
    await fs.writeFile(path.join(home, "sheet.svg"), SHEET);
    const added = await json("add", "screen.html");
    const started = await json("comment", "add", "First", "--item", added.itemId);
    const replied = await json("comment", "reply", started.threadId, "Like this", "--markup", "sheet.svg");
    const thread = (await json("comment", "ls")).find((t: any) => t.id === started.threadId);
    expect(thread.comments[1].id).toBe(replied.commentId);
    expect(thread.comments[1].markup.itemId).toBe(added.itemId);
    // Latest-with-markup is the default, so the reply's is what comes back.
    expect((await json("comment", "markup", started.threadId)).commentId).toBe(replied.commentId);

    const loose = await json("comment", "add", "Over here", "--at", "10,10");
    const refused = await isocan("comment", "reply", loose.threadId, "No", "--markup", "sheet.svg");
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("--on <item>");
    const none = await isocan("comment", "markup", loose.threadId);
    expect(none.code).not.toBe(0);
    expect(none.stderr).toContain("carries a markup");
  });
});
