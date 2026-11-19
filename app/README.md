# Bangkok plot feasibility (app)

Vite + React + TypeScript. Draw a plot on a real 3D map of Sukhumvit (zone Y.10,
Phrom Phong - Thong Lo), pick the road-facing edge and a building type; the rule
pipeline (`src/engine/pipeline.ts`) carves the buildable envelope rule by rule
(road setback, boundary setback, 2x-road height cap, FAR 8, 30% open space / OSR 4%,
MR-33 high-rise regime) and renders it as an extruded volume. Rules live in
`src/rules/bangkok-zone.json` (a byte-identical copy of `../rules/bangkok-zone.json`,
enforced by a test); every number cites its clause.

```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (engine, store)
npm run build      # static build in dist/
```

Layout: `src/engine` (pure geometry, UTM 47N frame, tested), `src/rules` (rule types,
zone JSON), `src/designs`, `src/checks`, `src/map` (MapLibre, Terra Draw, deck.gl,
Overpass fallback), `src/store` (Zustand, selectors, URL hash state), `src/ui`.

Scene state lives in the URL hash (`#plot=…&front=…&road=…&type=…&f2f=…&view=…`), so a
link reproduces the plot, inputs and camera. Hash input is validated (Bangkok bbox,
non-self-intersecting plot, clamped camera). In dev, `window.__store` exposes the store.

Worked example (docs/RESEARCH.md, 40 x 40 m, 12 m road, condo -> 784 m2, 36 m, 12 floors, 9,408 m2):
`#plot=100.5724,13.7363;100.5727699,13.7363;100.5727699,13.73666175;100.5724,13.73666175&front=0&road=12&type=condo`
