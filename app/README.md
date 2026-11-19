# Bangkok plot feasibility (app)

Vite + React + TypeScript. Draw a plot on a real 3D map of Sukhumvit / Asok, pick the
road-facing edge and a building type; the rule pipeline (Phase 3) turns that into a
buildable envelope and concept massings.

```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest (engine, store)
npm run build      # static build in dist/
```

Layout: `src/engine` (pure geometry, UTM 47N frame, tested), `src/rules` (rule types,
zone JSON), `src/designs`, `src/checks`, `src/map` (MapLibre, Terra Draw, deck.gl,
Overpass fallback), `src/store` (Zustand, selectors, URL hash state), `src/ui`.

Scene state lives in the URL hash (`#plot=…&front=…&road=…&type=…&view=…`), so a link
reproduces the plot, inputs and camera. In dev, `window.__store` exposes the store.
