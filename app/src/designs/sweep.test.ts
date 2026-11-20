import { describe, expect, it } from 'vitest'
import { runPipeline, type PipelineInputs } from '../engine/pipeline'
import { ZONE_RULES } from '../rules'
import type { BuildingType } from '../rules/types'
import { generateDesignSet } from './templates'
import { evaluateChecks } from '../checks/evaluate'
import { metricPlot, starPoints, SWEEP_PLOTS } from './fixtures'
import type { XY } from '../engine/projection'
import type { Design } from './types'
import type { Position } from 'geojson'

// Independent frontage check (does not call engine/frontage): every default design taller than
// 3 storeys either fronts the road by a plain re-implementation of the ข้อ 53 test, or has open
// plot in front of a road-facing face to the ข้อ 52(6) depth.
function pip(p: Position, ring: Position[]): boolean {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (ring[i][1] > p[1] !== ring[j][1] > p[1] && p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c
  }
  return c
}
function segDist(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
function independentFrontageOk(d: Design, plot: Position[], fi: number): boolean {
  if (d.floors <= 3) return true
  const F = d.footprint[0]
  const a = plot[fi]
  const b = plot[(fi + 1) % plot.length]
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  let nx = (b[1] - a[1]) / L
  let ny = -(b[0] - a[0]) / L
  const cx = plot.reduce((t, p) => t + p[0], 0) / plot.length
  const cy = plot.reduce((t, p) => t + p[1], 0) / plot.length
  if ((cx - a[0]) * nx + (cy - a[1]) * ny > 0) [nx, ny] = [-nx, -ny] // nx, ny: towards the road
  let area2 = 0
  for (let i = 0; i < F.length; i++) area2 += F[i][0] * F[(i + 1) % F.length][1] - F[(i + 1) % F.length][0] * F[i][1]
  let perim = 0
  let line = 0
  let minDist = Infinity
  let openFace = false
  const depth = d.floors > 3 ? 12 : 6
  for (let i = 0; i < F.length; i++) {
    const p = F[i]
    const q = F[(i + 1) % F.length]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len === 0) continue
    perim += len
    minDist = Math.min(minDist, segDist(p, a, b), segDist(q, a, b))
    const ox = area2 > 0 ? (q[1] - p[1]) / len : -(q[1] - p[1]) / len
    const oy = area2 > 0 ? -(q[0] - p[0]) / len : (q[0] - p[0]) / len
    if (ox * nx + oy * ny < Math.cos(Math.PI / 6)) continue
    const mx = (p[0] + q[0]) / 2
    const my = (p[1] + q[1]) / 2
    if ((a[0] - mx) * nx + (a[1] - my) * ny <= 20) line += len
    const pts = [0.25, 0.5, 0.75].flatMap((t) => [depth / 2, depth - 0.1].map((k) => [p[0] + (q[0] - p[0]) * t + ox * k, p[1] + (q[1] - p[1]) * t + oy * k]))
    if (pts.every((pt) => pip(pt, plot) && !pip(pt, F))) openFace = true
  }
  if (line > perim / 8 && minDist <= 20 + 1e-6) return true
  return openFace && openRunAndAccessOk(F, plot, a, b, nx, ny, area2 > 0, depth, perim)
}

/** Plain re-implementation of the ข้อ 52(6) run (>= P/6 incl. joined sides) and a 1 m grid flood fill for the 6 m access. */
function openRunAndAccessOk(F: Position[], plot: Position[], a: Position, b: Position, nx: number, ny: number, ccw: boolean, depth: number, perim: number): boolean {
  const open = (x: number, y: number) => pip([x, y], plot) && !pip([x, y], F)
  const samples: { x: number; y: number; ox: number; oy: number; ok: boolean; facing: boolean; len: number }[] = []
  for (let i = 0; i < F.length; i++) {
    const p = F[i]
    const q = F[(i + 1) % F.length]
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (len === 0) continue
    const ox = ccw ? (q[1] - p[1]) / len : -(q[1] - p[1]) / len
    const oy = ccw ? -(q[0] - p[0]) / len : (q[0] - p[0]) / len
    const k = Math.max(1, Math.round(len / 0.5))
    for (let j = 0; j < k; j++) {
      const x = p[0] + ((q[0] - p[0]) * (j + 0.5)) / k
      const y = p[1] + ((q[1] - p[1]) * (j + 0.5)) / k
      let ok = true
      for (let dd = 0.3; dd <= depth - 0.05 + 1e-9; dd += 0.5) if (!open(x + ox * dd, y + oy * dd)) ok = false
      samples.push({ x, y, ox, oy, ok, facing: ox * nx + oy * ny > 0.5, len: len / k })
    }
  }
  // Longest circular run with a road-facing sample.
  const n = samples.length
  let best: typeof samples = []
  for (let i = 0; i < n; i++) {
    if (!samples[i].ok || samples[(i - 1 + n) % n].ok) continue
    const run: typeof samples = []
    for (let k = 0; k < n && samples[(i + k) % n].ok; k++) run.push(samples[(i + k) % n])
    if (run.some((r) => r.facing) && run.length > best.length) best = run
  }
  if (samples.every((x) => x.ok)) best = samples
  if (best.reduce((t, r) => t + r.len, 0) < perim / 6 - 1e-6) return false
  // Grid flood fill at 1 m over cells >= 2.9 m from the plot boundary and the building.
  const xs = plot.map((p) => p[0])
  const ys = plot.map((p) => p[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const W = Math.ceil(Math.max(...xs) - x0) + 1
  const H = Math.ceil(Math.max(...ys) - y0) + 1
  const minD = (x: number, y: number, ring: Position[]) => {
    let m = Infinity
    for (let i = 0; i < ring.length; i++) m = Math.min(m, segDist([x, y], ring[i], ring[(i + 1) % ring.length]))
    return m
  }
  const free = new Uint8Array(W * H)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + i + 0.5
      const y = y0 + j + 0.5
      if (open(x, y) && minD(x, y, plot) >= 2.9 && minD(x, y, F) >= 2.9) free[j * W + i] = 1
    }
  const seen = new Uint8Array(W * H)
  const stack: number[] = []
  for (let c = 0; c < W * H; c++) if (free[c] && segDist([x0 + (c % W) + 0.5, y0 + Math.floor(c / W) + 0.5], a, b) <= 3.6) { seen[c] = 1; stack.push(c) }
  while (stack.length) {
    const c = stack.pop()!
    const i = c % W
    const j = Math.floor(c / W)
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di
      const jj = j + dj
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue
      const cc = jj * W + ii
      if (free[cc] && !seen[cc]) { seen[cc] = 1; stack.push(cc) }
    }
  }
  // Some facing band sample, at mid-depth, sits in (or next to) a reached cell.
  return best.some((r) => {
    if (!r.facing) return false
    const x = r.x + r.ox * Math.max(3, depth / 2)
    const y = r.y + r.oy * Math.max(3, depth / 2)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const i = Math.floor(x - x0) + di
        const j = Math.floor(y - y0) + dj
        if (i >= 0 && j >= 0 && i < W && j < H && seen[j * W + i]) return true
      }
    return false
  })
}

const ROADS = [6, 8, 10, 12, 20, 30]
// The rules JSON defines an office type, but the app models condo and low-rise only (BuildingType).
const TYPES: BuildingType[] = ['condo', 'lowRiseResidential']

function sweep(name: string, pts: XY[], edges: number[]) {
  const plot = metricPlot(pts)
  const failures: string[] = []
  let designs = 0
  for (const type of TYPES) {
    for (const front of edges) {
      for (const road of ROADS) {
        const inp: PipelineInputs = { plot, frontEdgeIndex: front, roadWidthM: road, buildingType: type, floorToFloorM: 3.0 }
        const pipeline = runPipeline(inp, ZONE_RULES)
        const set = generateDesignSet(pipeline, ZONE_RULES, inp)
        for (const u of set.unavailable) {
          expect(u.reason.length).toBeGreaterThan(10)
          if (/geometry engine/.test(u.reason)) failures.push(`${name} / ${type} / edge ${front} / ${road} m / ${u.id}: ${u.reason}`)
        }
        for (const d of set.designs) {
          designs++
          const c = evaluateChecks(d, pipeline, ZONE_RULES, inp)
          const bad = c.rows.filter((r) => !r.pass && !r.informational).map((r) => `${r.label}: ${r.actual} vs ${r.allowed}`)
          if (pipeline.envelope && d.gfaM2 > pipeline.envelope.gfaCapM2 + 0.5) bad.push('GFA over cap')
          if (!independentFrontageOk(d, pipeline.metric!.plot[0], front)) bad.push('independent frontage check')
          if (bad.length) failures.push(`${name} / ${type} / edge ${front} / ${road} m / ${d.id}: ${bad.join('; ')}`)
        }
      }
    }
  }
  return { failures, designs }
}

describe('every DEFAULT design passes every non-informational check (every front edge)', () => {
  for (const [name, pts] of Object.entries(SWEEP_PLOTS)) {
    it(name, () => {
      const { failures, designs } = sweep(name, pts, pts.map((_, i) => i))
      console.info(`[sweep] ${name}: ${designs} default designs, ${failures.length} failing`)
      expect(failures).toEqual([])
    }, 60000)
  }
  it('60-vertex star (edges 0, 1, 15, 30)', () => {
    const { failures, designs } = sweep('60-star', starPoints(), [0, 1, 15, 30])
    console.info(`[sweep] 60-star: ${designs} default designs, ${failures.length} failing`)
    expect(failures).toEqual([])
  }, 60000)
})
