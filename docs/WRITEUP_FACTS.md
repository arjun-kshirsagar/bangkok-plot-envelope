# Write-up facts sheet

Raw material for the one-pager (brief section 5, Part 3) and the "what the AI missed" note (Part 4).
Facts only, each with the file it comes from. Not prose for the submission: the brief says the write-up is the candidate's own.
Compiled 2026-11-20 from the repo state at commit `6698777`.

Abbreviations: DEC = `docs/DECISIONS.md` (rows cited by their decision text), RJ = `rules/bangkok-zone.json` (rules cited by `id`), RES = `docs/RESEARCH.md`, SRC = `docs/SOURCES.md`, IMPL = `IMPLEMENTATION.md`, README = `app/README.md`.

---

## 1. Problem as understood

- Who: a Bangkok developer who owns a plot and wants to know size, height and likely form before paying an architect (`assignment/FULL_BRIEF.md` s.2).
- Question: given plot + location/zone + road + building type, what rules apply, what space the building may fill, and at least two concept designs with pass/fail checklists, in 3D (FULL_BRIEF s.3).
- Brief's quality bar: any plot shape drawn on a map; envelope follows the real outline and each rule visibly changes it; floor areas add up; real surrounding buildings and roads; live updates with no reload; smooth on a normal laptop (FULL_BRIEF s.3).
- Why the rules are hard (RES s.1, SRC):
  - Two separate legal systems: zoning (Bangkok Comprehensive Plan B.E. 2556, a ministerial regulation: FAR, OSR, permitted uses) and building control (Building Control Act B.E. 2522 regulations MR-55 and MR-33, plus the Bangkok Building Control Bylaw B.E. 2544: setbacks, height, open space, high-rise rules).
  - Primary texts are Thai, from the Royal Gazette / ASA mirrors; 4 primary PDFs stored in `docs/sources/`.
  - Values are zone-specific (FAR 8 / OSR 4% in ย.10 vs FAR 10 / OSR 3% in พ.5 vs FAR 7 / OSR 4.5% in ย.9; SRC BMA-GIS row).
  - Which plan is in force is itself a question: 2013 plan said "five years"; still law in Nov 2026 via Town Planning Act B.E. 2562 transitional provisions; 4th-revision draft approved by the provincial committee 9 Apr 2026, posted Aug-Nov 2026, expected 2027 (RES s.1; DEC "Plan version", "Legal basis").
  - Same rule repeated in national and Bangkok texts with small differences (e.g. BMA ข้อ 50 adds "large building" to the tier-2 road setback list; RJ `mr55-road-setback`).
- "One zone done properly" was taken as: few rules, exact, every number cited to document + clause; thin slice of TestFit (massing) and Archistar (compliance) (DEC row 1; AGENTS.md hard rule 4).
- Non-goals written up front: no unit mix / parking / yield optimisation, no permit workflow, no multi-zone, no backend, English UI with Thai citations (IMPL "Non-goals").

## 2. Scope decisions

| Decision | Fact | Where |
|---|---|---|
| Zone | ย.10 (Y.10), very-high-density residential, brown; plan ข้อ 17 | DEC "Zone: ย.10" |
| Zone values | FAR 8:1; OSR 4% of GFA; >= 50% of open space permeable | RJ `zone-far`, `zone-osr`; BMA-CP ข้อ 17 |
| Map focus | Official sub-zone ย.10-4, north of Sukhumvit, Soi 31-55; centre 100.5724 E, 13.7363 N; 2.85 km2 | RES s.2 |
| Zone polygons shipped | 7 sub-zones (ย.10-4 to ย.10-10) in `rules/bangkok-zone-y10.geojson` | DEC "Zone geometry" |
| Why ย.10 | condos dominant; FAR 8 inside 6-10 range; a condo has no plan road-width condition in a residential zone, so the chain is building control only | DEC "Zone: ย.10" |
| Rejected zones | พ.5 Asok / Silom (commercial road conditions), ย.9 Soi 24-26, ย.7 | DEC "Zone: ย.10" |
| Building types shipped | `condo`, `lowRiseResidential`; `office` in RJ, second priority | DEC "Building types shipped" |
| Excluded: FAR bonuses (ข้อ 51-57, up to +20%) | base FAR 8 only; bonuses need facts the tool lacks | DEC "FAR bonuses"; RJ `far-bonus-ignored` (assumed) |
| Excluded: two-road height relief (MR-55 ข้อ 45/46) | height from user-selected front road only | DEC "Plots on two roads"; RJ `mr55-two-roads` |
| Excluded: parking optimisation | informational deduction only (ceil(GFA/120) spaces x 30 m2), never a pass/fail row | DEC "Parking", "Indicative parking"; RJ `bma-parking-indicative` |
| Excluded: EIA, Condominium Act, draft 4th plan | not geometric / not in force | SRC "Not used" |
| Excluded: permit workflow, multi-zone | out of scope | IMPL "Non-goals" |
| Excluded: road continuity routing (MR-33 ข้อ 2) | user attestation checkbox | DEC "MR-33 ข้อ 2 road continuity" |
| Plots outside ย.10 | still computed with ย.10 rules plus a warning | DEC "Plots drawn outside" |

## 3. Rule chain (engine order, `app/src/engine/pipeline.ts` `STAGE_IDS`: plot, roadSetback, boundarySetback, height, far, openSpace, envelope)

| # | Stage | Formula | Source |
|---|---|---|---|
| 1 | Plot | WGS84 polygon projected to UTM 47N (EPSG:32647); all geometry in metres | DEC "Displayed plot area is planar UTM" |
| 2 | Road setback (front edge only) | W < 6: 3 m from centreline; >2 storeys or >8 m: W < 10 -> 6 m from centreline (6 - W/2 from edge); 10-20 -> W/10 from edge; > 20 -> 2 m from edge. Tier 2 always applied for shipped types | MR-55 ข้อ 41; BMA-BL-2544 ข้อ 50; RJ `mr55-road-setback`; DEC "Road setback tier" |
| 3 | Height cap | flat Hmax = 2 x (right-of-way + front setback); floors = floor(Hmax / floor-to-floor), default 3.0 m (legal min 2.60 m) | MR-55 ข้อ 44; BMA ข้อ 49; MR-55 ข้อ 22; RJ `mr55-height-road`, `floor-to-floor` |
| 4 | Boundary setback (standard regime) | max(openings rule: 2 m if <= 9 m, 3 m if 9-23 m; perimeter rule: 1 m if <= 15 m, 2 m if > 15 m), evaluated at built height | MR-55 ข้อ 50; BMA ข้อ 54, 55; RJ `mr55-boundary-openings`, `bma-perimeter-open`; DEC "evaluated at the BUILT height" |
| 5 | FAR | GFA cap = 8 x plot area; all storeys incl. parking/basements; MR-33 ข้อ 2 road tier caps at 30,000 m2 on roads < 18 m | BMA-CP ข้อ 17(1), ข้อ 4; MR-33 ข้อ 2; RJ `zone-far`, `far-counts-all-floors` |
| 6 | Open space | open area >= max(30% of plot, 4% of GFA actually built); footprint shrunk by further uniform offset if needed | BMA ข้อ 52(1); MR-33 ข้อ 6; BMA-CP ข้อ 17(2); DEC "OSR ... actual GFA" |
| 7 | Regime switch | if standard result >= 23 m or GFA >= 10,000 m2 -> MR-33: 6 m from every boundary and road, road >= 10 m right-of-way, frontage >= 12 m, 6 m fire road; envelope recomputed, both routes shown | MR-33 ข้อ 1-4; DEC "Regime derivation" |
| 7a | High-rise not permitted | road < 10 m or front edge < 12 m -> envelope held under 23 m and 10,000 m2 | DEC "front edge shorter than ... 12 m" |
| 7b | High-rise guard | if the 6 m band leaves a non-high-rise building or consumes the plot, fall back to capped standard envelope (9 m wide plot -> 21 m building) | DEC "Erosion clips" row |
| 8 | Frontage (per design) | road-facing building line > 1/8 perimeter and within 20 m of the way, else FAIL with note | BMA ข้อ 52(6), 53; RJ `bma-frontage` |

Thresholds (RJ `thresholds`): high-rise 23 m; extra-large 10,000 m2; MR-33 road tier 30,000 m2; large building (BMA ข้อ 50) > 2,000 m2 or >= 15 m and > 1,000 m2.

Worked example (RES s.4; reproduced in app as "Load worked example (docs)", README): 40 x 40 m = 1,600 m2, 12 m right-of-way, condo.
- FAR cap 8 x 1,600 = 12,800 m2 -> extra-large -> MR-33 regime.
- 6 m all round -> 28 x 28 = 784 m2 footprint (49% coverage); open space 816 m2.
- Height 2 x (12 + 6) = 36 m -> 12 floors at 3.0 m.
- GFA 784 x 12 = 9,408 m2 (73% of cap). Height binds.
- Open-space floor: 30% x 1,600 = 480 m2 governs (4% of actual GFA = 376 m2; research shortcut used 4% of FAR cap = 512 m2) (DEC "OSR ... actual GFA").
- Standard-regime alternative: road setback 1.2 m (12/10), boundary 3 m -> raw 34 x 35.8 = 1,217 m2, cut to 1,120 m2 by the 30% rule; 7 floors = 21 m (< 23 m); GFA 7,840 m2.
- Sloped-envelope note: rear face at 34 m behind road edge allows 2 x (12 + 34) = 92 m; not implemented (RES s.4).

Concept designs (`app/src/designs/templates.ts`; DEC rows "Tower-on-podium template", "Courtyard template"):
- Slab: full envelope footprint x envelope floors.
- Tower on podium: 2-floor podium on envelope footprint; tower area solved so total = min(FAR cap, height-bound GFA); tower >= 12 m wide and >= 400 m2 (assumption); podium drops floors if it alone exceeds the GFA target.
- Courtyard: only when envelope footprint > 1,500 m2; 10 m deep ring; floors for 80% of FAR cap.
- Overrides per design: floors 1..max+6, "ignore setbacks"; stored in URL (`design`, `dfl`, `nosb`) (DEC "Design overrides").
- Checklist rows (`app/src/checks/evaluate.ts`): road setback, boundary setback, high-rise 6 m clearance, height (2x road), FAR / GFA cap, open space 30% of plot, OSR 4% of GFA, high-rise road access, fronting the public way, low-rise definition, floor-to-floor minimum. Each design is checked in the regime it triggers itself (DEC "Checklist evaluates each design").

## 4. Technical decisions

Stack (DEC row 3, DEC "Pin maplibre-gl"; README "Stack"; `app/package.json`):

| Item | Reason recorded |
|---|---|
| Vite + React 19 + TypeScript strict | fast iteration, static deploy (IMPL stack table) |
| Static frontend, no backend, no API keys | nothing to break on demo day, free hosting (DEC row 2) |
| MapLibre GL 5.24.1 + OpenFreeMap (Liberty style) | real OSM 3D buildings and roads, no key (DEC row 3) |
| Pinned MapLibre 5.x, not 6.x | deck.gl 9.4 `MapboxOverlay` reads `map.transform`, removed in MapLibre 6 (DEC "Pin maplibre-gl") |
| deck.gl 9 `MapboxOverlay` (interleaved) | envelope stages and massings as extruded polygons (IMPL) |
| Terra Draw (MapLibre adapter) | polygon draw and vertex edit, any shape (IMPL) |
| proj4, UTM 47N | metric planar frame; `turf.area` differs ~0.4%; FAR x area must use the same frame as the pipeline (DEC "Displayed plot area") |
| polygon-clipping | setback erosion (DEC "Setback geometry") |
| Zustand | derived state is live (IMPL) |
| Vitest | pure engine tested (IMPL) |
| Hosting | Vercel static, root dir `app/` (`docs/DEPLOY.md`) |

Allowed-space computation (`app/src/engine/offset.ts`, `pipeline.ts`):
- Per-edge erosion: plot minus a stadium/strip per edge at that edge's distance (road edge d_road, others d_boundary) minus a disc at reflex/collinear vertices, via polygon-clipping difference (DEC "Setback geometry", "Erosion clips").
- Reason: MR-33 ข้อ 4 / MR-55 ข้อ 50 require every part >= d from the boundary, which is a distance erosion; handles concave plots and mixed distances; never buffers in degrees (DEC "Setback geometry").
- Convex corners need no disc (strips extended 1 mm cover the wedge); halved clip count, 60-vertex star 309 ms -> 187 ms (DEC "Erosion clips").
- Arcs: 12 segments, circumscribed (radius d / cos(pi/12)), so results are conservative; area change < 0.1% (`offset.ts` `CIRCLE_SEGMENTS = 12`; DEC "Open-space shrink and all design offsets").
- Composed erosion: area targets solved by eroding the ORIGINAL plot by d_i + s, not re-eroding a rounded footprint (DEC same row).
- Area targets: Illinois regula falsi on f(s) = area(s) - target, seeded s0 = (A - target) / perimeter, converges in 3-6 erosions (`offset.ts` `erodeToArea`).
- Largest piece kept when setbacks split the plot; dropped area annotated (`offset.ts` `largestPiece`; `pipeline.ts` annotation).
- Containment checks: every design vertex inside the region (0.05 m tolerance) AND outside area < perimeter x 0.05 m (DEC "Containment = every design vertex").

Site data:
- 3D buildings: OpenFreeMap vector tiles, `render_height` / `render_min_height`, MapLibre `fill-extrusion` (DEC "3D buildings come from OpenFreeMap tiles").
- Check at research time: z14 tile 14/12768/7560 over Sukhumvit/Asok, 125/125 building features carry `render_height` (DEC same row). Runtime: app logs the in-view share and switches to Overpass if < 50% (`app/src/map/buildings.ts`). A runtime figure of 99% in view is not recorded in the repo; confirm from the session log.
- Caveat: OpenMapTiles emits `render_height = 5` for untagged buildings (DEC same row).
- Overpass fallback (`height` -> `building:levels` x 3.5 m -> 12 m) implemented, dormant; endpoints overpass-api.de and overpass.kumi.systems, 20 s timeout, 700 ms debounce, min zoom 15 (`buildings.ts`).
- Road name/class from tiles; width from Overpass `around:30` (`width`, else `lanes` x 3.5 m), else default 12 m; source shown; user override kept (DEC "Road width pre-fill", "Road-width estimate").
- Zone polygons: BMA CPUD ArcGIS REST service `BMAGI_Planing/MapServer/1`, exported once to GeoJSON; fields LUP_FAR / LUP_OSR match Gazette text; ย.10-7 has a hole, point-in-zone handles holes (SRC BMA-GIS; RES s.2).
- Example plot: ~2,280 m2, 5 vertices, open lot / car park on Soi Sukhumvit 53 (ย.10-4), no OSM footprint overlap, 10 m right-of-way assumed (DEC "Demo 'Load example plot'").

Smoothness:
- Engine pure (no React/map/DOM imports in `engine/`, `checks/`) (AGENTS.md conventions).
- Memoised selectors (`useMemo` in `app/src/store/selectors.ts`) shared by React and the map (commit 1bc97eb).
- Overlay updates coalesced to one per animation frame while dragging (`app/src/map/MapView.tsx`, `requestAnimationFrame`).
- Plot capped at 60 vertices (`MAX_PLOT_VERTICES`, `app/src/map/draw.ts`; DEC "Open-space shrink ...").
- Perf before/after:
  - Old search: 0.6-24 s on 16-60 vertex plots (verifier measurement, DEC "Open-space shrink ...").
  - 60-vertex plot pipeline: 12 s -> 38 ms (commit 1bc97eb message).
  - Thinness search on 60-vertex star: ~1.1 s -> 0.16 s; pipeline + 3 designs + checks 150-180 ms in all tested road cases (DEC "Thinness search"; commit 6698777).
  - Per-probe erosion 30-40 ms -> 2-15 ms (DEC "Thinness search").
- Bundle (`app/dist/assets`, built 2026-11-20 05:13; vendor chunks split, nothing lazy-loaded, README):

| Chunk | Raw | Gzip |
|---|---|---|
| vendor-maplibre | 1,028,795 B | 270,646 B |
| vendor-deck (deck.gl/luma) | 854,881 B | 237,900 B |
| vendor-geo | 306,672 B | 88,924 B |
| vendor-react | 219,314 B | 67,856 B |
| index (app code) | 174,850 B | 55,425 B |
| CSS (app + maplibre) | 12,747 + 69,808 B | - |

## 5. Verification process

- Roles: orchestrator session; builder agents; fresh read-only verifier agents re-reading primary sources and code (AGENTS.md; `docs/DEPLOY.md` "Nothing below has been run by the builder agent; the orchestrator runs it after review"). Agent-session details beyond this are in the transcripts, not the repo.
- Model on commits: "Claude Fable 5.1" co-author trailer on all 9 commits (`git log`).

What verifier passes caught, with commit:

| Finding | Fix | Commit | Where recorded |
|---|---|---|---|
| Legal basis cited a repealed Act (TPA No.4/2558) | cite TPA B.E. 2562 transitional provisions; No.4 kept as history | 2fb6e31 | DEC "Verifier pass 1", "Legal basis" |
| MR-33 consolidation date wrong | corrected to B.E. 2564 | 2fb6e31 | DEC "Verifier pass 1" |
| Perimeter open space fixed at 2 m | made height-dependent 1 m (<= 15 m) / 2 m (> 15 m) per BMA ข้อ 55 | 2fb6e31 | RJ diff df7d30b..2fb6e31 |
| "Large building" tier-2 road setback attributed to MR-55 | attributed to BMA-BL-2544 ข้อ 50 | 2fb6e31 | DEC "Verifier pass 1" |
| FAR bonus text wrong | ข้อ 53/54 bonuses are for public buildings only, not condos | 2fb6e31 | DEC "Verifier pass 1" |
| Frontage rule missing | `bma-frontage` added (BMA ข้อ 52(6), 53); plus `bma-parking-indicative`, `mr55-buildings-same-plot` (22 -> 25 rules) | 2fb6e31 | DEC "Frontage rule added" |
| BMA bylaw 30%-of-plot open space | present in RJ `bcl-open-space-plot` already at df7d30b; when/how it was caught is not in git, check the research transcript | df7d30b | RJ; DEC "Open space" |
| OSR read against FAR cap (512 m2) | verifier agreed actual-GFA reading; solved as fixed point | 7fe4850 | DEC "OSR ... actual GFA" |
| White screen on malformed URL hash | URL validation + ErrorBoundary | 7fe4850 | commit message; `app/src/ui/ErrorBoundary.tsx`, `store/urlState.ts` |
| Perf blow-up 0.6-24 s on 16-60 vertex plots | composed erosion, seeded regula falsi, 60-vertex cap, rAF | 1bc97eb | DEC "Open-space shrink ..." |
| Boundary setback evaluated at cap height (3-storey house on 6 m soi lost 44 m2) | evaluate at built height | 1bc97eb | DEC "Standard-regime boundary setback" |
| Podium alone over GFA cap (100 x 100 m plot on 8 m road) | podium drops floors; sweep test 6 plots x 5 roads x 2 types | 6698777 | DEC "Tower-on-podium never exceeds" |
| Containment area slack let a 0.3 x 10 m bump pass (3 m2 < 8 m2) | per-vertex test added | 6698777 | DEC "Containment = every design vertex" |
| Override lifting design 9 m -> 12 m passed with 2 m setback | boundary row re-evaluated at design height | 6698777 | DEC "Boundary-setback row" |
| Frontage heuristic collapsed a 60-vertex star to a 0.4 m line | facing-normal test (30 deg, 20 m); now 46 m of 278 m | 6698777 | DEC "ข้อ 53 building line" |
| GFA-cap row named the wrong rule | `gfaCapNote` prints actual reason | 6698777 | DEC "GFA-cap row" |
| Front edge < 12 m still showed a high-rise envelope | held in standard regime | 6698777 | DEC "front edge shorter" |

## 6. "What the AI missed" candidates (Part 4)

- First research draft cited the Town Planning Act (No.4) B.E. 2558 s.14 as the in-force basis; that Act was repealed by TPA B.E. 2562. Caught by verifier re-reading sources (DEC "Legal basis"; diff df7d30b..2fb6e31 RES s.1).
- First draft modelled BMA ข้อ 55 perimeter open space as a flat value per type (2 m condo, 1 m low-rise) instead of by height (RJ diff).
- First draft omitted the BMA ข้อ 52(6)/53 frontage rule; a deep tower can fail it (DEC "Frontage rule added").
- First draft's OSR used 4% of the FAR cap (512 m2) instead of the building's own GFA (DEC "OSR ... actual GFA"); worked-example arithmetic exposed that 30% of plot (480 m2) governs.
- DECISIONS originally said road width estimate = lanes x 3.5 + 4 m; shipped code uses lanes x 3.5 only; corrected in a later row (DEC "Road-width estimate").
- Research plan (IMPL) assumed 12 m default for untagged buildings; tiles actually give 5 m (DEC "3D buildings").
- IMPL assumed road width from tiles; OpenMapTiles never carries `width`/`lanes` (DEC "Road width pre-fill").
- IMPL proposed latest MapLibre; 6.x breaks deck.gl interleaving (DEC "Pin maplibre-gl").
- Builder's first engine: boundary setback at cap height, podium over GFA cap, containment slack, 12-24 s perf; found by verifier fuzz/sweep tests and timing (section 5).
- Unverified claims still flagged: MR No. 7 parking ratio; "successor plan will be a ข้อบัญญัติ" (SRC SEC-MR7, TPA-2562 row).

## 7. Known limitations and next-step candidates

| Limitation | Recorded in |
|---|---|
| Zone boundary is BMA digitisation of a 1:75,000 map, +/-50-100 m; UI says approximate | RES s.6 item 1; DEC "Zone geometry" |
| Right-of-way must be confirmed by the user; OSM rarely has `width`; estimate is lanes x 3.5 m | RES s.6 item 4; DEC "Road-width estimate" |
| Flat height cap, not per-point sloped envelope (sloped would allow ~92 m at the rear of the worked example) | DEC "Height cap v1"; RES s.4 |
| Height = roof-deck level; parapets, lift overruns, roof plant ignored | RJ `height-measurement` (assumed); DEC "Height measurement" |
| Overpass fallback dormant and not exercised on this network | DEC "3D buildings"; `buildings.ts` |
| Frontage building-line test is a heuristic (30 deg facing, 20 m midpoint); 6/12 m front-open-space route not modelled, fails conservatively | DEC "ข้อ 53 building line", "Frontage check" |
| No two-road / corner height relief | DEC "Plots on two roads" |
| Single zone; plots outside still use ย.10 rules; straddling plots use centroid sub-zone | DEC "Plots drawn outside", "Plot straddling" |
| Road continuity user-attested | DEC "MR-33 ข้อ 2 road continuity" |
| No parking layout; indicative deduction only | DEC "Indicative parking" |
| No sun / shadow analysis | not modelled anywhere in repo |
| No unit mix / yield | IMPL "Non-goals" |
| Basements not modelled though they count in FAR | DEC "FAR counting" |
| FAR bonuses not applied | DEC "FAR bonuses" |
| Edge classes road/boundary only | RJ `edge-classification` (assumed) |
| Walls assumed to have openings on every side (no 0.5 m blank-wall option) | DEC "Condo walls are assumed" |
| Tower min 12 m / 400 m2, courtyard 10 m ring, 1,500 m2 threshold are design assumptions, not law | DEC "Tower-on-podium template", "Courtyard template" |
| Plan currency: 4th revision (expected 2027) may lower FAR in brown zones | RES s.6 item 5; SRC SEC-DRAFT4 |
| Out of scope but real: lifts/fire stairs (MR-33 ข้อ 7+), EIA, ล. overlays, road-widening lines (ถนนสาย ก/ข) | RES s.6 item 6 |
| Office type in RJ but second priority | DEC "Building types shipped" |
| Assumed rules (7): `floor-to-floor`, `height-measurement`, `far-counts-all-floors`, `far-bonus-ignored`, `road-width-definition`, `edge-classification`, `bma-parking-indicative` | RJ `assumed: true` |

## 8. Numbers appendix

- Tests: 103 passed in 11 files, ~2.5 s (`cd app && npm test`, run 2026-11-20 05:14 IST). Progression by commit: 52 (7fe4850), 65 (948d71b), 72 (1bc97eb), 103 (6698777).
- Rules: 25 in RJ, 7 `assumed: true`; 22 at df7d30b, +3 at 2fb6e31.
- Sources: 14 IDs in SRC (7 primary incl. TPA-4 history: BMA-CP, BMA-GIS, MR-55, MR-33, BMA-BL-2544, TPA-2562, TPA-4; 7 secondary: SEC-STATUS, SEC-DRAFT4, SEC-SUMMARIES, SEC-LISTINGS, SEC-KNS, SEC-OSM, SEC-MR7); 4 primary PDFs in `docs/sources/`.
- Decision log: 59 dated rows in DEC.
- Zone polygons: 7 features in `rules/bangkok-zone-y10.geojson`.
- Clock: started 2026-11-19 19:54 UTC (01:24 IST 20 Nov); deadline 2026-11-21 19:54 UTC (FULL_BRIEF).

Commits (`git log --format='%h %ad %s' --date=iso`, IST):

| Hash | Time (+0530) | Summary |
|---|---|---|
| b6c7176 | 2026-11-20 02:37 | Brief, implementation plan, agent guide, decision log |
| df7d30b | 2026-11-20 03:14 | Research: ย.10 rule set (22 rules), zone GeoJSON, sources, PDFs |
| 2fb6e31 | 2026-11-20 03:19 | Research: verifier fixes; frontage, parking, same-plot rules |
| 349083f | 2026-11-20 03:24 | Vite scaffold, 3D site, plot drawing, front edge, URL state |
| 7fe4850 | 2026-11-20 03:51 | Envelope pipeline, zone layer, verifier fixes (52 tests) |
| 948d71b | 2026-11-20 04:05 | Concept designs and checklist (65 tests) |
| 1bc97eb | 2026-11-20 04:28 | Perf fix 12 s -> 38 ms, setback at built height, high-rise guard (72 tests) |
| 2861dbd | 2026-11-20 04:42 | Visual polish, empty state, sources modal, legend, narrow layout |
| 6698777 | 2026-11-20 05:12 | Phase 4 fixes, edge cases, data sync, new example lot (103 tests) |

Lines of code (`wc -l`, `app/src`):

| Folder | Source | Tests |
|---|---|---|
| engine | 1,605 | 712 |
| map | 1,354 | 0 |
| ui | 985 | 0 |
| designs | 623 | 242 |
| store | 533 | 109 |
| checks | 328 | 116 |
| rules (TS) | 255 | 62 |
| App.tsx + main.tsx | 44 | - |
| index.css | 1,038 | - |
| Total TS/TSX excl. tests | 5,727 | 1,241 |

Data/docs: RJ 351 lines; DEC 65; SRC 35; RES 73; IMPL 163; README 85.

## 9. Orchestrator notes (facts from the live session, not derivable from the repo)

- Building heights at runtime: builder's console log on first load at Asok, 2026-11-20: "90 building features in view, 89 with render_height (99%). Using OpenFreeMap tile heights." The Phase 2 verifier independently logged 88 in view, 87 with heights. Overpass fallback never activated.
- BMA Bylaw 2544 ข้อ 52(1) (30% of plot open space): found by the research agent itself, not a verifier. Its report said this rule "was not in the original brief and is the rule that actually caps footprint at 70%". The research verifier then confirmed it and added the missing frontage rule (ข้อ 52(6) + 53) and the parking rule (ข้อ 84).
- Agent process: main session acted as orchestrator and committer. One research agent, two builder agents (second one on Opus 5.5 from 2026-11-20 ~04:30 IST onward), five fresh read-only verifier agents (research; Phase 0/2; Phase 3; Phase 4; Phase 5 break-test). Verifiers never edited files; builders never ran git. Each phase was committed before and after verifier fixes so it can be reverted.
- Overpass API was unreachable from the development network (HTTP 406/502) during the whole build, so the road-width lookup from OSM tags was never exercised live. Building heights did not need it.
- The first builder was blocked by the harness from creating the GitHub repo and deploying to Vercel (outward-facing actions); these were deferred to the candidate.
- Verifier pass 6 (commit f3e71e9, 2026-11-20 ~06:30 IST): read BMA Bylaw 2544 ข้อ 52(6) and ข้อ 53 from the primary PDF and found the builder's "front open space" route misread the clause: it compared the PLOT's road-edge length with 1/6 of the building perimeter (the Bylaw applies 1/6 to the length of the continuous open space along the building, side space included), required the footprint to be 6/12 m from the road edge (not in the clause), and dropped the 6 m internal-road connection. Effect: a 2,241 m2 flag lot on a 20 m road got a 16-floor envelope but 3-floor designs. The sweep test could not catch this because its checks and the designer shared the same function. Fix delegated to the builder with the Thai text quoted.
- Fix for the above (commit 592a29b, ~07:10 IST): open-space route now follows the clause: band of open plot 6/12 m deep along the building, longest continuous run including a road-facing face >= 1/6 of the building's outer perimeter (joined side bands count), connected to the road edge by open plot >= 6 m wide (internal road clause, new param internalRoadMinM with the same source), no distance-to-road test. Flag lot (12x20 m pole, 40x50 m body, 20 m road) went from 3 floors / 3,236 m2 to 16 floors / 14,266 m2. Sweep: 2,120 default designs, 0 failing; routes used: 658 unchanged envelope, 34 front open space, 22 cut back to front the road, 54 capped at 3 storeys. An independent sweep check that does not call the designer's frontage function was added. 109 tests.
- Verifier pass 7 (commit 592a29b): confirmed the reworked route matches ข้อ 52(6)/53; found the direct-access width was measured along an oblique building face (a 4 m pole could pass as 6 m), the 3-storey cap note quoted the wrong attempt, and a Terra Draw midpoint insert could throw at the 60-vertex cap. Fixed in d9a658e (112 tests). Verifier's verdict: submit-ready once that fix landed.
- Baseline reached 2026-11-20 ~07:50 IST (about 6 h into the 48 h): 16 commits, 112 tests, 7 verifier passes.

## 10. Deployment (2026-11-21, ~14:35 UTC, about 5h 20m before the deadline)
- Public repo: https://github.com/arjun-kshirsagar/bangkok-plot-envelope (18 commits at push time).
- Live: https://bangkok-plot-envelope.vercel.app, Vercel production via CLI from `app/`, anonymous GET 200, no deployment protection.
- Before pushing, the MCP access key (the 32-character code from the personal brief PDF link) was found embedded in the saved brief and start response since the first commit. History was rewritten to replace it with a placeholder (`git filter-branch`), so public hashes differ from the local pre-rewrite history kept under `refs/original/`. Decision logged in docs/DECISIONS.md.
- The server added a required `access_key` parameter to every MCP tool between the first session and 2026-11-21; `time_left` without it returns an error explaining where the key is.
- Verifier pass 8 (2026-11-21, live site, fresh headless Chrome profile): every brief requirement present on the deployed URL; no JS exceptions; blockers were a missing root README and the always-failing Overpass road-width lookup (overpass-api.de 406 without CORS headers, kumi.systems timeout). Fixed: root README + repo description/homepage; third Overpass endpoint and clearer fallback notice; low-rise cap named when it binds; attribution moved clear of the panel; krisdika.go.th (certificate error) replaced by ocs.go.th; consistent m² / ≥ / ≤; tile-loading status first.
- Verifier pass 9 (live, after the polish deploy): all six fixes confirmed on the live site, no regression; two leftover ASCII operator strings fixed afterwards. The Overpass lookup still fails from the browser (all three endpoints), so hand-drawn plots keep the 12 m default with the notice after about 20 s.

## 11. Final-hour changes (2026-11-21, 19:10-19:25 UTC, after the first submission at 18:49 UTC)
- Road-width lookup: the three Overpass mirrors are raced in parallel with a 3 s timeout (was sequential, about 18 s worst case) (commits 2f13866, c5a13b6). A same-origin Vercel function `app/api/overpass.js` joins the race and forwards only the exact road query inside a Bangkok bounding box (commit c7ffd01; DEC last row, 2026-11-21).
- Measured on the live site at 19:21 UTC: `/api/overpass` deployed and validating (400 on a bad query), but all three mirrors timed out from Vercel as well (502 after 4.4 s), and overpass-api.de `/api/status` returned 502. So at deploy time hand-drawn plots still fall back to the 12 m default, after about 4.5 s. Whether the proxy returns real widths once the mirrors recover was not observed.
- Break-test pass (engine and URL level, no browser): self-intersecting, sliver, tiny, 2 km square, 60-vertex star, duplicate/collinear vertices, bad road widths and about 25 malformed share URLs. No crash and no NaN reachable from the UI. One bug fixed: a 1-floor courtyard was offered when the ring alone exceeded the GFA cap (600 x 100 m condo plot, 6 m road: 12,531 m2 ring vs 10,000 m2 cap) (commit fa5ae85). Not exercised: fast dragging, switching type mid-drag.
- "Working" lines: a collapsed formula under coverage, height cap, max floors, GFA cap, GFA in envelope, open space and the selected design's GFA; a line is hidden unless its formula reproduces the displayed number (commit 4c81def). Worked example renders "12,800 m² = plot 1,600.0 m² × FAR 8" and "36.0 m = 2 × (road 12 m + front setback 6 m)".
- Verification: one read-only verifier per stage (road race: ship; working lines and courtyard fix: ship, no defects). Tests 119 passed in 12 files; build clean; production deployed 19:20 UTC.
