# Envelope BKK — Bangkok plot feasibility

**Live:** https://bangkok-plot-envelope.vercel.app · **App code and full README:** [`app/`](app/README.md)

A 48-hour hiring assignment for General Machines / Silicon Bricks. Draw a plot on a real 3D map
of Sukhumvit (Bangkok zone **ย.10 / Y.10**), pick the edge that faces the road, set the road
right-of-way and a building type. The tool shows the applicable regulations (FAR, OSR, setbacks,
height) with their sources, carves the buildable envelope rule by rule on the real plot outline
among real OpenStreetMap buildings, generates concept massings inside it and scores each one
against a pass/fail checklist. Everything updates live; the scene lives in the URL hash so a link
reproduces it. Indicative only, not a permit assessment.

Try it: open the live link and click **Load example plot**, or open the
[worked example](https://bangkok-plot-envelope.vercel.app/#plot=100.57240373,13.73630204;100.57277357,13.73629968;100.57277598,13.73666123;100.57240614,13.73666359&front=0&road=12&type=condo)
(40 × 40 m plot on a 12 m soi).

## Run locally

```
cd app
npm install
npm run dev        # http://localhost:5173
npm test           # 112 Vitest tests: engine, designs, checks, rules, URL state, perf
npm run build
```

No API keys, no backend. Tiles and building heights from OpenFreeMap (OpenStreetMap data).

## Repo map

| Path | What |
|---|---|
| `app/` | Vite + React + TypeScript app. `src/engine` pure rule pipeline, `src/designs` massings, `src/checks` checklist, `src/map` MapLibre + deck.gl + Terra Draw, `src/store` state and URL hash, `src/ui` |
| `rules/` | `bangkok-zone.json`: every FAR, OSR, setback and height value with its source document and clause; `bangkok-zone-y10.geojson`: the zone polygons |
| `docs/SOURCES.md` | The regulation documents used, with clause numbers and links; primary Thai PDFs in `docs/sources/` |
| `docs/DECISIONS.md` | Dated log of every ambiguity and the call made |
| `docs/RESEARCH.md` | Rule research notes and the worked example |
| `docs/DEPLOY.md` | How it is deployed |
| `IMPLEMENTATION.md`, `AGENTS.md` | Phase plan and the guide the AI agents worked under |
| `assignment/` | The brief as received from the MCP server |

## How it was built

Planned and built with Claude Code in an orchestrator / builder / fresh read-only verifier
pattern: a builder agent implemented each phase, a new verifier agent with no prior context
audited it (rules against the primary PDFs, geometry against an independent raster erosion,
designs against a 2,120-case sweep), and the orchestrator committed per stage. Decisions and
verifier findings are in `docs/DECISIONS.md` and `docs/WRITEUP_FACTS.md`.
