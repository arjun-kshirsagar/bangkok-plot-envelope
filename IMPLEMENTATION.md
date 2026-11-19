# Implementation Plan

Bangkok plot feasibility tool for the General Machines generalist assignment.
Brief: `assignment/FULL_BRIEF.md`. Deadline: **2026-11-21 19:54 UTC** (01:24 IST, 22 Nov).
Started 2026-11-19 19:54 UTC. Total budget 48h.

## Goal in one line

Draw any plot on a real 3D map of one Bangkok zone, pick the road it faces and a
building type, and see the applicable rules, the buildable envelope carved rule by
rule, and two or more concept massings with pass/fail checklists, all updating live.

## Non-goals (write these in the one-pager too)

- No unit mix, parking, or yield optimisation (that is TestFit's job).
- No permit workflow, document checking, or multi-zone coverage (that is Archistar's job).
- No backend, no accounts, no persistence beyond the URL / localStorage.
- No Thai-language UI. English, with Thai regulation names cited.

## Stack (decided up front, change only with a logged reason)

| Concern | Choice | Why |
|---|---|---|
| App | Vite + React + TypeScript | fast iteration, static deploy |
| Map and 3D site | MapLibre GL JS with OpenFreeMap vector tiles, `fill-extrusion` for buildings | free, no key, real OSM buildings and roads, WebGL |
| Our 3D geometry | deck.gl `PolygonLayer` (extruded) interleaved with MapLibre | envelope stages and massings as extruded polygons, cheap |
| Plot drawing | Terra Draw (MapLibre adapter) | polygon draw and edit, any shape |
| 2D geometry | `@turf/turf` (buffer, area, intersect, booleanContains) + `polygon-clipping` | inward offsets, areas, containment checks |
| State | Zustand | tiny, derived state is trivially live |
| Tests | Vitest | rule pipeline is pure functions, test them |
| Hosting | Vercel or Netlify static | public URL, instant |

If OpenFreeMap buildings in the chosen area lack heights, fall back to Overpass
API fetch of `building` ways with `height` / `building:levels`, default 3.5 m per level,
and 12 m when neither tag exists. Log the decision.

## Rule pipeline (the core abstraction)

```
plot polygon
  -> stage 1: boundary setbacks           (buffer inward by setback per edge class)
  -> stage 2: road setback / road line     (extra inward offset on edges facing the road)
  -> stage 3: height cap                   (f(road width, zone, building type))
  -> stage 4: FAR cap                      (max gross floor area = FAR x plot area)
  -> stage 5: OSR / open space             (min open area = OSR% x gross floor area; footprint cap)
  -> envelope: footprint polygon x height, plus derived max floors
  -> massing templates generate designs inside the envelope
  -> checklist evaluates each design against every rule
```

Every stage is a pure function `(geometry, rules, inputs) -> geometry + annotations`.
The UI shows each stage as a toggleable layer so "each rule visibly changes it" is free.

---

## Phase 0: Setup (1h)

- [ ] `git init`, create public GitHub repo, push.
- [ ] Scaffold Vite + React + TS. Install MapLibre, deck.gl, Terra Draw, turf, zustand, vitest.
- [ ] Deploy empty shell to Vercel so the live link exists from hour one.
- [ ] Create `docs/DECISIONS.md` (decision log) and `docs/SOURCES.md` (regulation sources).
- [ ] Confirm this session's transcript is exportable.

**Done when:** live URL serves a MapLibre map centred on Bangkok.

## Phase 1: Domain research (3h)

Goal: one zone, exact rules, every number cited.

- [ ] Read the Bangkok Comprehensive Plan (ผังเมืองรวมกรุงเทพมหานคร, 2013 / B.E. 2556, check whether the 2024 revision is in force). Pick **one zone**. Candidate: a high-density residential (ย. / Y) or commercial (พ. / P) zone along Sukhumvit, because condos trigger the most rules.
- [ ] Extract for that zone: FAR, OSR, permitted building types, any bonus FAR rules (ignore bonuses unless trivial, log it).
- [ ] Building Control Act ministerial regulation No. 55 (B.E. 2543): setbacks from boundaries by building height and openings, distance from road centreline, height versus road width (the 2x road width + setback rule), minimum road width for building size.
- [ ] High-rise / large building rules (buildings >= 23 m or >= 10,000 m2): road width minimum (10 m / 18 m), 6 m perimeter clearance, etc.
- [ ] Decide building types supported: start with `condo` (high-rise residential) and `low-rise residential`, add `office`/`commercial` only if time allows.
- [ ] Write `src/rules/bangkok-<zone>.json` with numbers and `source` fields, plus `docs/SOURCES.md` with links / document names / clause numbers.
- [ ] Write every ambiguity and the call made into `docs/DECISIONS.md`.

**Done when:** rules JSON exists, every number has a source, decisions log has at least five entries.

## Phase 2: Real 3D site + plot drawing (6h)

- [ ] MapLibre with OpenFreeMap style, 3D buildings via `fill-extrusion`, pitch 55, bearing control.
- [ ] Bound the map to the chosen zone area; show a zone outline polygon (approximate from the plan map, log the approximation).
- [ ] Terra Draw polygon mode: draw, edit vertices, delete. Store plot as GeoJSON in Zustand.
- [ ] Project plot to a local metric CRS (turf uses WGS84 and metres via geodesic; verify buffer accuracy at Bangkok latitude, or use a local planar projection with `proj4`).
- [ ] Road selection: click a road segment near the plot, or pick from edges of the plot ("front edge"). Road width input (numeric, default from OSM `width`/`lanes` when available). Log the fallback.
- [ ] Building type selector.
- [ ] URL state: encode plot + inputs so a link reproduces the scene.

**Done when:** you can draw a concave plot between real buildings, pick the front road, and see them all in 3D.

## Phase 3: Envelope pipeline + per-rule rendering (8h)

- [ ] Implement stages 1-5 as pure functions in `src/engine/`, with Vitest tests on a rectangle, an L-shape, a concave plot, a sliver that setbacks consume entirely.
- [ ] Edge classification: front (road), side, rear. Setback per class.
- [ ] Inward offset via negative buffer; handle multipolygon results and empty results.
- [ ] Height cap from road width + zone + type; convert to max floors (floor-to-floor height configurable, default 3.0 m residential).
- [ ] FAR: gross floor area cap. OSR: minimum open ground area and therefore max footprint. Compute the binding constraint and show which one binds.
- [ ] Render: plot (flat), each setback stage (flat, semi-transparent), envelope (extruded, translucent). Toggle per stage. Numbers panel: plot area, footprint, max GFA, max height, max floors, binding rule.
- [ ] Everything derived from store, no manual refresh anywhere.

**Done when:** editing a vertex moves the envelope instantly and the numbers panel is consistent (GFA <= FAR x area, footprint <= envelope, floors x footprint == GFA shown).

## Phase 4: Concept designs + checklist (6h)

- [ ] Massing templates, each a function `(envelope, rules, type) -> design`:
  1. **Full-envelope slab**: footprint = envelope footprint, floors = min(height cap, FAR cap).
  2. **Tower on podium**: podium 2-3 floors near full footprint, tower on a shrunk footprint rising to height cap, GFA balanced to FAR.
  3. **Courtyard / U-block** (if time): envelope minus a central void, lower height, higher coverage.
- [ ] Each design reports: footprint area, floors, GFA, height, open space, coverage.
- [ ] Checklist per design: setbacks, height, FAR, OSR, road width minimum, high-rise clearance. Each row pass/fail with the actual vs allowed number.
- [ ] Deliberately allow a user override (for example floors slider) so a design can fail and the checklist shows red. This proves the checker is real.
- [ ] Design selector, 3D render as extruded floors, light floor-line styling.

**Done when:** two designs render inside the envelope, pass all checks, and pushing a slider makes a check fail visibly.

## Phase 5: Polish, break it, deploy (6h)

- [ ] Perf: debounce geometry on drag, keep polygon vertex counts sane, check 60 fps on an integrated-GPU laptop.
- [ ] Edge cases: self-intersecting plot (reject with message), tiny plot (envelope empty, message), plot touching two roads, plot drawn outside the zone (warn).
- [ ] Empty states, loading states, legend, units, a short "how to read this" panel.
- [ ] Mobile is not required; make sure it does not crash at narrow width.
- [ ] Final deploy, test the live link in a private window (must open with no sign-in).
- [ ] Record a 60 s screen capture as a backup for the call.

**Done when:** a stranger can open the link, draw a plot, and understand the result without help.

## Phase 6: Write-up and submission (4h, candidate's own words)

- [ ] Create the submission doc (Google Doc, anyone-with-link viewer). Seven parts in order.
- [ ] Part 3 one-pager under the four required headings. The agent may supply facts, numbers and the decisions log; the prose is yours.
- [ ] Part 4: export this session and the research session transcripts, link them, write the "what the AI missed" note.
- [ ] Parts 5, 6, 7: setup answers, best project, about you, links (résumé viewable by anyone).
- [ ] Call `time_left`, then `submit_application` via the MCP server. Save the receipt ID to `assignment/RECEIPT.md`. Call `check_submission`.

**Done when:** receipt ID saved, `check_submission` confirms the record.

---

## Time budget

| Phase | Hours | Cumulative |
|---|---|---|
| 0 Setup | 1 | 1 |
| 1 Research | 3 | 4 |
| 2 Site + drawing | 6 | 10 |
| 3 Envelope | 8 | 18 |
| 4 Designs + checklist | 6 | 24 |
| 5 Polish | 6 | 30 |
| 6 Write-up + submit | 4 | 34 |
| Sleep, food, buffer | 14 | 48 |

Hard rule: submit a complete, working version by **hour 40** (2026-11-21 ~12:00 UTC, 17:30 IST), then resubmit improvements. The latest submission counts.

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| OSM building heights missing | levels x 3.5 m, else 12 m; say so in UI and write-up |
| Negative buffer produces garbage on concave plots | try `polygon-offset` or clipper-based offset; test early in Phase 3 |
| Rule ambiguity | make a call, cite clause, log in DECISIONS.md |
| deck.gl + MapLibre interleaving issues | fall back to MapLibre `fill-extrusion` layers from GeoJSON sources for our geometry |
| Time overrun | drop courtyard template, drop second building type, never drop the checklist or live updates |
