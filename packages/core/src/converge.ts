import type { CanvasContents, CommentThread, Item, ItemVersion } from "./model.ts";
import { childrenOf, parentOf } from "./lineage.ts";
import { newCommentId, newThreadId } from "./ids.ts";
import { anchorOffset } from "./placement.ts";
import type { Operation } from "./ops.ts";

/**
 * **This one won.**
 *
 * The canvas can already diverge: `/variation` makes siblings from an item,
 * and each carries `parent` saying what it was made from. It has never been
 * able to CONVERGE — to say "this is the one" and have the exploration fold
 * back into the thing it explored. So a canvas accumulates four screens where
 * a decision was made about one, and the decision itself is recorded nowhere.
 *
 * Folding is: the winner's content becomes a new VERSION of the source, and
 * every child of that source — the winner included — goes to the trash. The
 * winner goes too, and that is the point rather than an oversight: its content
 * now lives on the parent's stack, so leaving it would be two copies of one
 * decision and an invitation to edit the wrong one. Nothing is lost; the trash
 * is reversible and undo brings the whole thing back at once.
 *
 * **No new op type, which is a change from the research that asked for this.**
 * That argued for one composite operation with a computed inverse, and it was
 * right at the time. Op grouping shipped since: `item.addVersion` plus one
 * `item.delete` per child, all carrying one group, gives the same
 * one-gesture-one-undo out of ops that already exist and already replay. A new
 * op type would have been a second way to say something the vocabulary can
 * already say.
 *
 * **Where the decision is recorded, honestly.** The research wanted the
 * winner's idea-name carried onto the version so the stack says what was
 * chosen. There is no field for that — `ItemVersion` has a filename and an
 * author, and a filename is the file's name rather than a label to write on.
 *
 * A group id is not a label either: grouping matches by string equality, so
 * two decisions that happened to share a human name and land next to each
 * other would merge into one undo. The id stays an id.
 *
 * So what actually records the decision is what the canvas already keeps: the
 * winner's content is now the source's top version with its own author and
 * time, and every explored sibling sits in the trash under the name somebody
 * gave it, recoverable. `label` below is the sentence the CLI prints, not a
 * field anything stores — and calling it what it is beats implying a record
 * that does not exist.
 *
 * **And, since 14 Oct 2026, the decision is SAID** (docs/projects/exploration/).
 * atlas/convergence.md recorded the gap in as many words — "no decision post"
 * — and it was the one silence that stopped an exploration from running
 * itself: an agent parked on the source woke on a bare `item.addVersion` and
 * could not tell "go this way" from "I edited it"; an agent parked on the Chat
 * heard nothing. So the person typed to the agent, which is the ping the
 * project exists to remove. The plan now carries a `post` and `convergeOps`
 * sends it LAST in the same group: a comment by the chooser on the source's
 * thread — `Chose "B" over "A", "C".` — naming the authors of the options,
 * with `Next: …` when the chooser said what comes next. Still no new op: a
 * `thread.reply` (or `thread.create` anchored to the source) inverts, so one
 * ⌘Z takes the version, the trash and the words back together.
 */
interface ConvergePlan {
  /** The item the winner folds into. */
  parentId: string;
  /** The winner's current version, to be added to the parent. */
  version: ItemVersion;
  /** Everything that goes to the trash — the winner and its siblings. */
  trash: string[];
  /** The sentence a surface says about this decision. Not stored. */
  label: string;
  /** The decision, said where the waiting agent hears it. */
  post: DecisionPost;
}

/**
 * The comment a choice leaves on the source's thread. Computed by
 * `convergePlan` so both doors say the same words; `convergeOps` turns it into
 * the one thread op.
 */
interface DecisionPost {
  /** The newest live thread anchored to the source, or null to start one. */
  threadId: string | null;
  /** `Chose "B" over "A", "C".`, then `\n\nNext: …` when `then` was given. */
  body: string;
  /** Who made the options — the `createdBy` of each trashed sibling's current
   * version, deduplicated, the chooser left out. Named so an agent on a plain
   * `wait` wakes (`reasonFor`: "mentioned") even when the post starts a new
   * thread nobody is in yet. */
  mentions: string[];
  /** The source, carried so a reader can act on it without parsing words. */
  items: string[];
  /** Where a new thread's pin sits on the source (core's `anchorOffset`),
   * unused when `threadId` names an existing thread. */
  at: { x: number; y: number };
}

/** What a chooser can add to the fold. */
interface ConvergeOptions {
  /** What should happen next, in the chooser's words — becomes the `Next:`
   * line, which is the one convention the agent half reads. */
  then?: string;
  /** The chooser, so they are not told about their own pick. */
  by?: string;
}

/** The convention: a decision post's first line. */
const DECISION_PREFIX = "Chose ";
/** The convention: the line that carries the next brief. */
const NEXT_PREFIX = "Next: ";

const quote = (title: string) => `"${title.replace(/"/g, "'")}"`;

/**
 * The thread the post lands in: the newest live thread anchored to the
 * source — the conversation that most likely asked for the options — and
 * never the Chat, which would wake every agent on the canvas for one screen's
 * decision. Null when there is none, and the caller starts one.
 */
function threadOn(canvas: CanvasContents, itemId: string): string | null {
  let best: CommentThread | null = null;
  for (const thread of Object.values(canvas.threads)) {
    if (thread.anchorItemId !== itemId || thread.main) continue;
    if (!best || thread.createdAt > best.createdAt) best = thread;
  }
  return best?.id ?? null;
}

/** `Chose "B" over "A", "C".` — fixed and short so a reader, person or
 *  agent, knows a decision at a glance. `diff <source>` says what it WAS. */
function decisionBody(chosen: string, over: readonly string[], then?: string): string {
  const head = over.length > 0 ? `${DECISION_PREFIX}${quote(chosen)} over ${over.map(quote).join(", ")}.` : `${DECISION_PREFIX}${quote(chosen)}.`;
  const next = then?.trim();
  return next ? `${head}\n\n${NEXT_PREFIX}${next}` : head;
}

/** The `Next:` line of a decision post, or null when the pick was the whole
 *  instruction. The agent half reads this rather than the prose. */
export function nextOf(body: string): string | null {
  if (!body.startsWith(DECISION_PREFIX)) return null;
  const line = body.split("\n").find((l) => l.startsWith(NEXT_PREFIX));
  return line ? line.slice(NEXT_PREFIX.length).trim() || null : null;
}

type ConvergeRefusal = { refused: string };

/**
 * What choosing this item would do, or why it cannot be done.
 *
 * A refusal is a sentence, not a boolean: every one of these is something
 * somebody could reasonably try, and "cannot converge" tells them nothing
 * about which of their assumptions was wrong.
 */
export function convergePlan(
  canvas: CanvasContents,
  chosenId: string,
  options: ConvergeOptions = {},
): ConvergePlan | ConvergeRefusal {
  const chosen = canvas.items[chosenId];
  if (!chosen) return { refused: `no item ${chosenId} on this canvas` };

  const parentId = parentOf(chosen);
  if (parentId === null) {
    return {
      refused: `"${chosen.title}" was not made from anything — there is nothing to fold it back into`,
    };
  }
  const parent = canvas.items[parentId];
  if (!parent) {
    return {
      refused: `"${chosen.title}" was made from an item that is no longer on the canvas`,
    };
  }

  const version =
    chosen.versions.find((v) => v.id === chosen.currentVersionId) ?? chosen.versions[0];
  if (!version) return { refused: `"${chosen.title}" has no content to fold in` };

  // Every sibling, the winner included. `childrenOf` is the same reader
  // `isocan lineage` prints from, so what converges is exactly what that
  // command says was made from this source.
  const family = childrenOf(canvas, parentId).map((item: Item) => item.id);
  const trash = family.includes(chosenId) ? family : [chosenId, ...family];

  // The post. The losers are named in the canvas's order so two choosers of
  // the same round write the same sentence; the authors are whoever made each
  // option's current version, which for an agent's round is the agent.
  const losers = trash.filter((id) => id !== chosenId).map((id) => canvas.items[id]!);
  const mentions = Array.from(
    new Set(trash.map((id) => currentVersionOf(canvas.items[id]!)?.createdBy.id).filter((id): id is string => !!id)),
  ).filter((id) => id !== options.by);

  return {
    parentId,
    version,
    trash,
    label: `chose ${chosen.title}`,
    post: {
      threadId: threadOn(canvas, parentId),
      body: decisionBody(chosen.title, losers.map((l) => l.title), options.then),
      mentions,
      items: [parentId],
      at: anchorOffset(parent),
    },
  };
}

function currentVersionOf(item: Item): ItemVersion | undefined {
  return item.versions.find((v) => v.id === item.currentVersionId) ?? item.versions[0];
}

export function isRefusal(plan: ConvergePlan | ConvergeRefusal): plan is ConvergeRefusal {
  return "refused" in plan;
}

/**
 * **The ops a choice sends, in order**: the winner onto the parent's stack,
 * then every child to the trash, then the decision said on the source's
 * thread. The caller sends them under ONE group, so one ⌘Z takes the version
 * back, brings every child out of the trash and removes the words.
 *
 * The post is last so that an agent woken by it reads a canvas where the fold
 * has already happened. Its ids are minted here unless the caller holds them
 * (a test comparing two surfaces does), because a `thread.create` needs an id
 * before the daemon has seen it.
 *
 * Here rather than in either client because there are two: `isocan choose`
 * and the item menu's "Choose this variation" both send exactly this list
 * (`packages/web/test/choose.test.ts` holds them equal against a daemon).
 */
export function convergeOps(
  plan: ConvergePlan,
  ids: { threadId?: string; commentId?: string } = {},
): Operation[] {
  const comment = {
    id: ids.commentId ?? newCommentId(),
    body: plan.post.body,
    ...(plan.post.mentions.length > 0 ? { mentions: plan.post.mentions } : {}),
    items: plan.post.items,
  };
  const post: Operation = plan.post.threadId
    ? { type: "thread.reply", threadId: plan.post.threadId, comment }
    : {
        type: "thread.create",
        threadId: ids.threadId ?? newThreadId(),
        anchorItemId: plan.parentId,
        x: plan.post.at.x,
        y: plan.post.at.y,
        comment,
      };
  return [
    { type: "item.addVersion", itemId: plan.parentId, version: plan.version },
    ...plan.trash.map((itemId): Operation => ({ type: "item.delete", itemId })),
    post,
  ];
}
