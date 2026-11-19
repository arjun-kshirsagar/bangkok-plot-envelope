# Envelope BKK — Bangkok plot feasibility

Draw a plot on a real 3D map of Sukhumvit (zone **ย.10 / Y.10**, Phrom Phong – Thong Lo),
pick the edge that faces the road, set the road right-of-way and a building type. The
app carves the buildable envelope rule by rule, generates concept massings inside it
and scores each one against a pass/fail checklist. Everything is live: drag a vertex
and the envelope, designs and checklist follow.

Indicative only, not a permit assessment.

## Run

```
npm install
npm run dev        # http://localhost:5173 (use 127.0.0.1 if localhost resolves to IPv6)
npm test           # vitest: engine, designs, checks, rules, URL state, perf
npm run build      # static build in dist/ (deploy: ../docs/DEPLOY.md)
```

No API keys, no backend. Vector tiles and building heights come from OpenFreeMap
(OpenStreetMap data); road width lookups ask the Overpass API and fall back gracefully.

## Stack

Vite + React + TypeScript (strict) · MapLibre GL 5 (OpenFreeMap Liberty style, `fill-extrusion`
buildings) · deck.gl 9 `MapboxOverlay` (interleaved) for envelope and design volumes ·
Terra Draw (MapLibre adapter) for plot drawing and vertex editing · proj4 (WGS84 ↔ UTM 47N) ·
polygon-clipping for setback erosion · Zustand for state · Vitest.

## How the envelope is computed

Rules live in `src/rules/bangkok-zone.json` (a byte-identical copy of `../rules/bangkok-zone.json`,
enforced by a test); every number cites a document ID in `../docs/SOURCES.md` and a clause.

1. **Plot** — WGS84 polygon projected to UTM 47N; all geometry below is in metres.
2. **Road setback** — MR-55 ข้อ 41 / BMA ข้อ 50 tiers by right-of-way (W < 10 m: 6 − W/2 from the edge;
   10–20 m: W/10; > 20 m: 2 m), on the front edge only.
3. **Height cap** — MR-55 ข้อ 44: 2 × (right-of-way + front setback), applied as a flat cap; floors =
   floor(cap / floor-to-floor).
4. **Boundary setback** — MR-55 ข้อ 50 (walls with openings: 2 m ≤ 9 m, 3 m to 23 m) combined with
   BMA ข้อ 55 (1 m / 2 m all round), evaluated at the built height.
5. **FAR** — zone FAR 8 × plot area (BMA-CP ข้อ 17); the MR-33 ข้อ 2 road tier caps GFA at 30,000 m² on
   roads under 18 m.
6. **Open space** — ≥ 30 % of the plot (BMA ข้อ 52(1), MR-33 ข้อ 6) and OSR ≥ 4 % of the GFA actually
   built (BMA-CP ข้อ 17(2)); the footprint is shrunk by a further uniform offset when needed.
7. **Regime** — if the standard-regime result reaches 23 m or 10,000 m² the building is อาคารสูง /
   ขนาดใหญ่พิเศษ and MR-33 applies (6 m clearance all round, 10 m road with 12 m frontage, fire road);
   the envelope is recomputed and both routes are shown. No high-rise on roads under 10 m.

Setbacks are true distance erosions (plot minus a strip per edge and a disc per reflex vertex),
so concave plots and different per-edge distances just work. Concept designs (slab, tower on
podium, courtyard) are built from the same plot + offsets, and the checklist re-evaluates each
design in the regime the design itself triggers.

## Layout

`src/engine` (pure geometry + rule pipeline, tested) · `src/rules` (typed loader, zone polygons) ·
`src/designs` (massing templates) · `src/checks` (checklist rows) · `src/map` (MapLibre, Terra Draw,
deck.gl, zone layer, Overpass fallback) · `src/store` (Zustand, selectors, URL hash state) · `src/ui`.

The scene lives in the URL hash (`#plot=…&front=…&road=…&type=…&f2f=…&design=…&view=…`), so a link
reproduces the plot, inputs, selected design and camera. Worked example (40 × 40 m, 12 m soi, condo →
784 m² footprint, 36 m, 12 floors, 9,408 m² GFA):

`#plot=100.5724,13.7363;100.5727699,13.7363;100.5727699,13.73666175;100.5724,13.73666175&front=0&road=12&type=condo`

Decisions and assumptions: `../docs/DECISIONS.md`. Research notes and worked example: `../docs/RESEARCH.md`.
Sources: `../docs/SOURCES.md` (also shown in-app under "Sources & assumptions").
