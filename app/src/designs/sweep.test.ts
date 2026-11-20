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
  return (line > perim / 8 && minDist <= 20 + 1e-6) || openFace
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
