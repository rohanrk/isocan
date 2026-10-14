# Exploration — the design

**14 October 2026.** The mechanism behind [journey.md](journey.md). Read the
journey first; this names the pieces and the lines between them.

## The debt it discharges

[atlas/convergence.md](../atlas/convergence.md) records it in so many words:
*"No decision post. `choose` does not write the decision to the parent's
thread."* So the canvas could diverge (`/variation`, `wire vary`), hold a
preference (`prefer`), and converge (`choose`, **Choose this variation**) —
and the one moment that should move the work forward was silent. An agent
parked on the source woke on a bare `item.addVersion` and could not tell "go
this direction" from "I edited it" from "we are done"; an agent parked on the
Chat heard nothing at all. The person closed the gap by typing to the agent,
which is the ping the project exists to remove.

## 1. The decision post

`convergePlan` grows a `post`, and `convergeOps` emits it **last** in the same
group as the fold:

```ts
interface ConvergePlan {
  parentId: string;
  version: ItemVersion;
  trash: string[];
  label: string;
  post: {
    /** The newest live thread anchored to the source, or null: create one. */
    threadId: string | null;
    /** "Chose "B" over "A", "C"." — plus "\n\nNext: …" when `then` was given. */
    body: string;
    /** Authors of the options decided between, the chooser excluded. */
    mentions: string[];
    /** The source, so a reader can act on it. */
    items: string[];
  };
}
```

Why each choice:

- **On the source's thread**, anchored to the source. That is where the
  exploration's answer lives (its new version) and it is what `wait --item
  <source>` hears (`touches.ts`: a reply's touched item is its thread's
  anchor). The newest live thread anchored there is reused so a conversation
  that asked for the options gets its answer in place; failing one, the post
  starts a thread anchored to the source. Never the Chat: that wakes every
  parked agent on the canvas for a decision about one screen.
- **Mentions the options' authors.** `reasonFor` (`inbox.ts`) wakes an agent
  that is named, or in the thread, or on the main thread. A new anchored
  thread has nobody in it, so without the mention an agent on a plain `wait`
  sleeps through its own pick. The authors are the `createdBy` of each
  trashed sibling's current version, deduplicated, minus the chooser — a
  person choosing their own hand-made options is told nothing.
- **Not a `record`.** A record "reports; it never summons", and this must
  summon. It is a comment by the person who chose, which is true.
- **Last in the group.** When the agent wakes and reads the snapshot, the fold
  is already there to read. And one ⌘Z takes version, trash and post back
  together, because `thread.create` and `thread.reply` invert.
- **No new op.** `op-types` is a ratcheted bound and `converge.ts` already
  made the argument: the vocabulary can say this.

The sentence is fixed and short on purpose: `Chose "B" over "A", "C".` A
reader — person or agent — should recognise a decision post at a glance, and
`diff <source>` says what the choice *was*; the post says only that it
happened. `--then <words>` appends `\n\nNext: <words>`, and `Next:` is the one
convention the agent half reads (§3).

## 2. Both doors send it

`isocan choose <item> [--then <words>]` and the web's **Choose this
variation** both call `convergePlan` → `convergeOps`, as before;
`packages/web/test/choose.test.ts` already holds the two surfaces' op lists
equal against a daemon and now holds the post too. The web menu entry passes
no `then` until the pick bar (§4) gives it a field. `choose --json` returns
`threadId` and `commentId` beside `parentId`, `trashed` and `label`;
`--dry-run` prints the body it would post.

## 3. The agent half

A guide topic — the lap of an exploration, from the agent's side:

1. Make the options **from** the source (`/variation`, `wire vary`, or
   `add --prop parent=<source>`), say in one note what they are, and park on
   the source: `isocan wait --item <source> --json --timeout 900`.
2. Wake on a comment beginning `Chose`. Read the source's new version.
3. No `Next:` line → the pick is the instruction: reply in one line with the
   next round and run it. `Next: <words>` → that is the brief. `Next:` with
   `done`/`ship` in it → say what shipped and stop.
4. Make the next round from the source again — never from the trashed winner
   — so the lineage stays one stack with explorations hanging off it.

Nothing here is `hiro_on_isocan`'s; it is what any harness that reads the
guide will do.

## 4. The pick bar (phase 2)

The web's nudge. When a canvas holds two or more live items sharing a
`parent` that is itself live, a bar floats above the set: **N options · pick
one**, ← → to flip (each flip is `prefer` for the one you landed on, over the
one you left — the eye test as it was meant to be used), **Keep this** (the
same `chooseVariation`, with a one-line *Next:* field), and **None — try
again** (a decision post that folds nothing: *Chose none of "A", "B", "C".*
plus its `Next:`). Everything it sends exists by the end of phase 1; the bar
adds no op and loads with the canvas only when a round is pending, so the
entry chunk does not pay for it.

## What this does not do

- No round counter, fidelity ladder or option count. The agent runs the
  round; isocan runs the turn.
- No "exploration" item kind. Siblings sharing a `parent` *are* the round;
  the trash is its record.
- `prefer` stays silent. Twenty flips should not be twenty comments.
