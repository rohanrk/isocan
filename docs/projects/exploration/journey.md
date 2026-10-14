---
status: partial
since: 2026-10-14
see: wireframes, atlas, version-diff, design-partner
note: the ideal, as scenes. Asked 14 Oct 2026 — "I want the interface to nudge the process along instead of making me constantly ping the agent." Almost every piece of the exploratory loop already existed (`/wire`, `/variation`, `prefer`, `choose` on both surfaces, `wait --item`); what did not exist was the handoff — a pick was silent, so the agent either never heard it or heard a bare `item.addVersion` with no words. Phase 1 (the decision post, `choose --then`) built the same day.
---

# Exploration — the journey

Asked for by Rohan on 14 October 2026, close to verbatim:

> I want to allow isocan to display wireframes, and options for a design if I
> ask for them, and have a flow where I can select and accept one which then
> triggers further iterations on that HTML. Think of an exploratory phase. Is
> that for the agent to decide and isocan is just a canvas? I want the
> interface to nudge the process along instead of making me constantly ping
> the agent.

The first agent to run this loop is Rohan's own harness, `hiro_on_isocan`;
nothing here is specific to it, and anything that turned out to be would be a
bug. These scenes are the acceptance suite. Mechanism appears only where a
scene forced it; [design.md](design.md) names the pieces and
[phases.md](phases.md) is the walk.

## The sentence

> **An exploration is a round of options and a pick; isocan owns the turn,
> the agent owns the content.**

Isocan does not decide how many options there are, how many rounds, or what
fidelity the next one is at — that is policy, and it belongs to whoever is
running the round (an agent, or `/wire`'s composer). What isocan owns is the
**handoff**: the pending decision is visible, the pick is one gesture and one
undo, and the pick lands in the thread as words the waiting agent hears. That
is the same split the design competition settled on ("a person decides") and
the rc built the summons for.

## 1. A round arrives

Priya says, in the Chat or to an agent parked on the canvas:

> three directions for the settings page — one dense, one spacious, one that
> hides everything behind a search box

A minute later there are three screens in a row beneath the original, each
made *from* it (`parent` set, the way `/variation` and `wire vary` have always
done it). The agent's one working note in the Chat says what the three are
and which it would pick, and then the agent parks — on the **source** screen,
not the Chat, because that is where the decision will land.

**What the scene forces:** nothing new. Variations already carry their
lineage, and an agent can already `wait --item <source>`.

## 2. She picks one

She reads the three, flips between two of them, and right-clicks the spacious
one → **Choose this variation**. The spacious one becomes the next version of
the settings page and all three go to the trash; one ⌘Z would bring them
back. That much is 24 September's.

What is new: **a comment appears on the settings page's thread**, by Priya,
saying *Chose "Spacious" over "Dense", "Search-first".* The agent that drew
the three is named in it. Priya typed nothing; the decision is the words.

**What the scene forces:** `choose` posts the decision, on both surfaces, in
the same undo group as the fold. The post is a real comment and not a
`record`: the whole point is that it summons. It names the authors of the
options it decided between, so an agent on a plain `wait` wakes as surely as
one on `wait --item <source>`.

## 3. The agent hears it, and goes again

The agent wakes. Its `wait` says `reason: "change"`, and the inbox shows one
comment on the settings page: *Chose "Spacious" over …*. There is no `Next:`
line, so the pick is the whole instruction — *this direction*. The agent
reads the new version off the source, replies in one line with what it would
do next, and does it: three variations of the spacious direction at higher
fidelity, each made from the settings page again. Round two. It parks on the
source again.

Priya pinged nobody.

**What the scene forces:** the guide tells an agent what a decision post is,
how to park for one, and what a bare pick means. An agent that is not told
has not been nudged.

## 4. She picks one and says what next

Round two is on the canvas. This time she has an opinion: from the CLI,

```
isocan choose <spacious-b> --then "keep the two-column layout, lose the sidebar icons, and make it real data"
```

The post reads *Chose "Spacious B" over "Spacious A", "Spacious C".* and, on
its own line, *Next: keep the two-column layout, lose the sidebar icons, and
make it real data.* The agent wakes with its brief in the comment. From the
app, the same words go in a one-line field on the pick (scene 6).

**What the scene forces:** `--then` on the verb, carried into the post as a
`Next:` line, which is the one convention the agent half reads.

## 5. She is done

Round three lands and it is right. She chooses it and says so:

```
isocan choose <final> --then "done — ship this one"
```

The agent wakes, reads *done*, replies *Shipped as v4* and stops. The
exploration folded into the settings page's version stack — v1 the original,
v2 spacious, v3 the two-column cut, v4 the one with real data — and the roads
not taken are in the trash under their names. `isocan diff <settings> v1 v4`
tells the story.

**What the scene forces:** nothing — `choose` already converges, and
*stopping* is an agent's practice (guide, `practices`). It is here because a
loop that cannot end is not a loop.

## 6. The canvas asks

*(Phase 2, not built.)* Priya opens a canvas somebody else's agent has been
working on. Three screens sit under a fourth, and a small bar floats above
them: **3 options · pick one** with ← → to flip and **Keep this**, **None —
try again**. Flipping records `prefer` for free (the eye test, 9 Sep); *Keep
this* is `choose` with a one-line field for *Next:*; *None* posts the same
kind of decision without folding anything. She did not need to know a
right-click menu existed.

**What the scene forces:** the web detects a pending round (two or more live
siblings sharing a `parent`) and offers the decision where the options are.
Everything the bar sends already exists; the bar is only the nudge.

## What the scenes force

The load-bearing minimum, in the order to build it:

1. **The decision post** (scenes 2, 4, 5): `choose` on both surfaces posts
   *Chose X over Y, Z* to the source's thread, in the fold's own undo group,
   naming the options' authors; `--then` adds a `Next:` line. No new op.
2. **The agent half** (scene 3): a guide topic — park on the source, read the
   post, a bare pick means *this direction*, `Next: done` means stop.
3. **The pick bar** (scene 6): the web's nudge, out of `prefer`, `choose` and
   the post.

What the scenes do **not** force, and the project declines: a round counter,
an "exploration" item kind, a fidelity ladder, or any rule about how many
options a round has. Those are the agent's, and the day one is needed it
should be a property an agent writes, not a mechanism isocan enforces.
