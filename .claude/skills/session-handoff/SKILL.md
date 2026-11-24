---
name: session-handoff
description: Keep multi-session agent work resumable by storing decisions and state in files, not in chat. Use when work spans several sessions or days, when a session may end on a usage quota, compaction, or crash, or when handing work to another agent or model.
---

## When to use

- The work will not finish in one session (multi-day project, phased implementation).
- The session can end abruptly: weekly usage quota, context-window compaction, crash.
- Another agent, model, or a future session must continue exactly where this one stopped.
- The same misunderstanding has already been corrected once in this session.

## Problem this fixes

A chat session has a finite context window: chat history, files read, and tool
output all share it. When it fills, the agent summarises the older part to make
room — and the summary is lossy. The agent does not choose what survives; a
decision, a rejected design, or an uncommitted design document can silently
drop out. A fresh session starts from zero unless the state lives in files.
Measured across 50 coding sessions (Crosley), output quality degrades silently
from roughly 60% context utilisation — the agent starts forgetting earlier
instructions and repeating rejected suggestions.

## Method: three layers, read top-down

Keep state in three files so a new session reads as little as possible to resume.

### 1. Standing rules file (short, reloaded every session)

One file at the project root holding rules that do not change, plus a
"session start" section: which files to read first, what not to re-read in full
(search or summarise files over ~2,000 lines instead), and the stop rules below.
Keep it short — it loads before any work begins, so every line costs context.

### 2. Current summary (one file, 30 lines or fewer, rewritten — never appended)

Fields, in this order:

- One line: how far the work got and where it stopped.
- Files to look at: paths to the outputs or the code just changed.
- Next step: the single thing the new session does first.
- Needs a decision: what is waiting on a human.
- Lesson: one line preventing the same mistake.
- Handoff: path to the latest dated handoff note.

Rewrite the summary each time; appending turns it back into a diary. When it
exceeds 30 lines, move the oldest parts into the history section below it.

### 3. Dated handoff notes (one per session or day, can be long)

File per session, e.g. `reports/<date>_handoff_<area>.md`. Contents: what was
done, output file paths, what is left, blockers and why, open questions. A new
session opens only the latest note, and only when it needs the detail.

## End-of-session routine

Run this before the session ends, as a command (e.g. `/handoff`) or as a plain
instruction to the agent:

1. Rewrite the current summary to match the present state.
2. Write the dated handoff note for this session.
3. Commit and push any design or decision document first. A design that exists
   only inside the session is lost when the quota stops the session — that is
   the failure this skill exists to prevent.
4. Report only numbers and results that exist in files. At the end of a long
   session, summarised memory and the real files can disagree; a wrong number
   in the handoff becomes fact for the next session.
5. Close with three lines to the human: what got done, what to check, what
   comes next.

## When to trigger the handoff

- 60% context usage: finish the current step, start nothing new.
- 70% usage: write the handoff and continue in a fresh session.

These thresholds are the source author's chosen values, not vendor defaults —
adjust them to the work. In browser or chat sessions with no usage meter, check
at each completed subtask instead: after every subtask, ask whether the next
one belongs in a fresh session, and hand off at the same points.

## Starting a fresh session

1. Read the standing rules file and the current summary only.
2. Start from "files to look at" and "next step".
3. Open the dated handoff note only if the summary is not enough.
4. After a compaction, verify the important constraints survived — treat a
   compacted session's memory of details as approximate.

## If the session has drifted

- If the same misunderstanding has been corrected twice, do not compact again:
  restart from the handoff note. A third correction in the same session rarely
  sticks once the wrong idea runs through the transcript.
- If the session rests on a misread requirement, compaction preserves the
  misreading — clear the session and restart from the handoff note, after
  getting the working tree into a known state.

## How this applies to the game-improvement work

- The diving and climbing tracker files (`IMPROVEMENT_TRACKER.md`) already
  carry the phase plan; the current-summary role can be a short section there
  or a `RESUME.md` at the repository root, so Claude sessions supervised by
  Muse resume from files after the weekly quota reset.
- The 2026-11-23 failure this prevents: the diving verification design
  (`design2.md`) was completed inside a Claude session but never committed, so
  it stayed in-session when the quota stopped the session. Rule 3 above
  (commit design documents before ending) closes exactly that gap.

## Sources

Rewritten in own words as a procedure; no source text copied.

- AZTechnology, "Long Claude Code projects: RESUME files and handoffs" — https://aztech3d.com/en/guides/claude-code-long-project-handoff/
- Blake Crosley, "Context Window Management: 50 Sessions of Data" — https://blakecrosley.com/blog/context-window-management
- Kinda Technical, "Managing Long Sessions: Compaction, Clearing and Fresh Starts" — https://kindatechnical.com/engineering-with-ai-coding-agents/managing-long-sessions-compaction-clearing-and-fresh-starts.html
