# Exploration — the walk

**14 October 2026.** The order of work for [design.md](design.md), held to
[journey.md](journey.md). Each phase ends with **Trajectory**: only what the
phase discovered that changes the project's course.

**Where we are:** phase 1 built 14 Oct 2026; phase 2 is next.

## Phase 1 — the decision post

**Status: CLOSED, 14 October 2026.**

`choose`, on both surfaces, posts *Chose "B" over "A", "C".* to the newest
live thread anchored to the source (or starts one), naming the options'
authors, last in the fold's undo group. `isocan choose --then <words>` adds
`Next: <words>`. `--json` returns `threadId` and `commentId`; `--dry-run`
prints the body. A `choose` guide section tells an agent to park on the
source, what a bare pick means, and that `Next:` is the brief.

**Proof:** `packages/web/test/choose.test.ts` — the menu's recorded ops equal
the CLI's logged ops up to minted ids, the last is the post anchored to the
source, one group, and one undo removes the version, restores the children
and removes the words; a second case replies on an existing thread pinned to
the source and names the agent that made the options.
`packages/core/test/converge.test.ts` — the body with and without `--then`,
`nextOf`, the thread chosen (newest anchored, never main, else new), mentions
excluding the chooser. **Walked on a throwaway daemon, 14 Oct 2026:** a
second actor (`ISOCAN_SESSION_ID` + `identity --session --name Scout`) added
two variations and parked on `wait --item <source> --timeout 30`; the person
ran `choose <B> --then "make it real data"`; Scout woke in 1 s (exit 0) with
the source already at v2, and `isocan inbox` as Scout showed the post under
*1 named you*. Its `--json` carries `threadId`, `commentId`, `body` and
`next`.

**Trajectory:**
- **2026-10-14** — The post goes on the source's thread and never the Chat.
  The first draft put it in the Chat because "that is where the agent is";
  that wakes every agent on the canvas for one screen's decision. Mentioning
  the options' authors recovers the wake without the broadcast.
- **2026-10-14** — The first walk used one actor for both halves and the
  waiter slept through its own pick, correctly: your own ops never wake you.
  A guide line already says two processes need two session keys; the lap
  section now leans on it rather than repeating it.

## Phase 2 — the pick bar

**Status: NOT STARTED.**

A bar above a pending round (two or more live siblings of one live parent):
**N options · pick one**, ← → flips and records `prefer`, **Keep this**
chooses with a one-line *Next:* field, **None — try again** posts a decision
that folds nothing. Lazy: the chunk loads when a round is detected, not on
first paint. No new op.

**Proof:** a browser walk — three variations made by CLI, the bar appears,
flipping writes `preferredOver`, *Keep this* with a Next line produces the
same ops as `isocan choose --then`, *None* posts and folds nothing; the bar
is absent on a canvas with no round. Bundle budget test unchanged.

## Phase 3 — the round from the Chat

**Status: NOT STARTED.**

`/wire` and `/variation` end their note by saying where they parked ("pick
one on the canvas; I'm watching #Settings"), and a `/variation` run from the
Chat parks the agent on the source rather than the Chat. This is guide and
command-body prose, not code, unless the walk shows otherwise.

**Proof:** `hiro_on_isocan` (or any harness reading the guide) runs journey
scenes 1–5 end to end on a real canvas with the person typing nothing but the
first request and the `Next:` lines. The transcript is the proof, and it is
pasted here with names made synthetic.
