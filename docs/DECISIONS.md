# Decisions log

One entry per ambiguity or judgement call. Newest at the bottom.

| Date (UTC) | Decision | Options considered | Reason |
|---|---|---|---|
| 2026-11-19 | Build a thin slice of both TestFit (massing) and Archistar (compliance): few rules, exact, two or three parametric massings | Full generative solver; broad multi-zone rule coverage | Brief says one zone done properly; 48h; accuracy on few rules beats breadth |
| 2026-11-19 | Static frontend only, OSM data fetched at runtime | Backend with cached tiles / PostGIS | Nothing to break on demo day, free hosting, brief needs only a browser |
| 2026-11-19 | Stack: Vite + React + TS, MapLibre + OpenFreeMap tiles, deck.gl, Terra Draw, turf, Zustand, Vitest | Three.js from scratch; CesiumJS; Mapbox (needs key) | Fastest path to real OSM 3D buildings with no API key |
