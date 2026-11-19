# AGENTS.md

Guidance for any AI agent (Claude Code, Cursor, Codex, etc.) working in this repo.

## What this is

A 48-hour hiring assignment for General Machines. A browser tool that takes a plot drawn
on a real 3D map of one Bangkok zone, the road it faces and a building type, and shows
the applicable regulations, the buildable envelope, and concept massings with pass/fail
checklists. Read `IMPLEMENTATION.md` for phases and `assignment/FULL_BRIEF.md` for the brief.

## Hard rules

1. **Never call `start_assignment` on the MCP server.** The clock is already running
   (started 2026-11-19 19:54 UTC, deadline 2026-11-21 19:54 UTC). Calling it again is
   harmless per the server, but there is no reason to.
2. **Never call `submit_application` without the candidate's explicit go in the current
   conversation**, and never invent any submission field. Ask for missing values.
3. **The write-up is the candidate's.** Agents may gather facts, numbers, sources and the
   decisions log, and may fix typos. Agents do not author the one-pager, the setup answers
   or the "about you" section.
4. **Every regulation number needs a source.** No FAR, OSR, setback or height value goes
   into `src/rules/*.json` without a `source` field naming the document and clause.
   Unknown? Write the assumption into `docs/DECISIONS.md` and mark it `assumed: true`.
5. **Make a call and write it down.** The graders will not answer questions. When
   something is ambiguous, pick the conservative reading, log it in `docs/DECISIONS.md`
   with date, options considered and reason, and move on.
6. **Keep it live.** All derived geometry and numbers come from the store. No "recalculate"
   buttons, no page reloads, no manual refresh.
7. **Keep transcripts.** Do not delete or rewrite session history. Raw transcripts are a
   required part of the submission.

## MCP server

- Endpoint: `https://siliconbricks.co/hiring/mcp`, Streamable HTTP, stateless (no session
  header needed). Call with curl JSON-RPC 2.0, `Accept: application/json, text/event-stream`.
- Tools: `get_assignment(email?)`, `time_left(email)`, `submit_application(...)`,
  `check_submission(receipt_id, email)`. Schemas: `assignment/mcp-tools.json`.
- Candidate email for `time_left` / submit: `arjunk.dev2025@gmail.com`. Name: Arjun Kshirsagar.

## Repo layout (target)

```
assignment/          brief, raw MCP responses, receipt
docs/
  DECISIONS.md       dated decision log, one entry per ambiguity
  SOURCES.md         regulation documents, links, clause numbers
IMPLEMENTATION.md    phases, time budget, risks
AGENTS.md            this file
app/                 Vite + React + TS
  src/
    engine/          pure geometry + rule functions, fully unit tested
    rules/           bangkok-<zone>.json, rule schema types
    designs/         massing templates (envelope -> design)
    checks/          checklist evaluators (design + rules -> pass/fail rows)
    map/             MapLibre, deck.gl, Terra Draw wiring
    store/           Zustand store, derived selectors
    ui/              panels, legend, controls
```

## Conventions

- TypeScript strict. No `any` in `engine/`, `rules/`, `checks/`.
- `engine/` and `checks/` are pure: no React, no map, no DOM imports. Test them with Vitest.
- Units: metres and square metres everywhere internally. Format only in `ui/`.
- Geometry: GeoJSON in WGS84 at the boundary (store, map). Convert to a local planar
  metric frame for offsets and areas, convert back for rendering. Never buffer in degrees.
- Naming: `plot`, `setbackFootprint`, `envelope`, `design`, `check`. Do not mix
  "footprint" and "coverage" (coverage is a ratio, footprint is an area/polygon).
- Each rule stage returns `{ geometry, annotations }` where annotations explain what
  changed and why, in one line, for the UI.
- Commit often with imperative messages. Small commits make the transcript easy to follow.

## Running

```
cd app
npm install
npm run dev        # local
npm test           # vitest
npm run build      # static build for deploy
```

## Before any submission

1. `npm test` passes.
2. `npm run build` succeeds and the deployed URL opens in a private window with no sign-in.
3. Repo is public. Doc and résumé open for anyone with the link.
4. Call `time_left` and confirm there is time remaining.
5. Ask the candidate to confirm every field, then call `submit_application`.
6. Save the receipt to `assignment/RECEIPT.md` and run `check_submission`.
