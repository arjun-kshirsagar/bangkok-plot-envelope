import { describe, expect, it } from 'vitest'
import { runPipeline, type PipelineInputs } from '../engine/pipeline'
import { frontage as rawFrontage } from '../engine/frontage'
import { ZONE_RULES } from '../rules'
import { generateDesigns } from '../designs/templates'
import { metricPlot, starPoints } from '../designs/fixtures'
import { containedWithin, evaluateChecks, frontage } from './evaluate'
import type { MetricPolygon } from '../engine/offset'

const rect = (w: number, h: number) => metricPlot([[0, 0], [w, 0], [w, h], [0, h]])
const inputs = (plot: ReturnType<typeof metricPlot>, over: Partial<PipelineInputs> = {}): PipelineInputs => ({
  plot,
  frontEdgeIndex: 0,
  roadWidthM: 12,
  buildingType: 'condo',
  floorToFloorM: 3,
  ...over,
})

describe('boundary setback uses the design height (standard regime)', () => {
  it('a low-rise slab overridden to 12 m fails the boundary row with 3 m required', () => {
    // 16 x 20 m: the 2 m low-rise boundary setback leaves > 30% open, so no open-space shrink.
    const inp = inputs(rect(16, 20), { buildingType: 'lowRiseResidential' })
    const pipeline = runPipeline(inp, ZONE_RULES)
    expect(pipeline.metric!.boundarySetbackM).toBe(2)
    const def = generateDesigns(pipeline, ZONE_RULES, inp).find((d) => d.id === 'slab')!
    const ok = evaluateChecks(def, pipeline, ZONE_RULES, inp).rows.find((r) => r.label === 'Boundary setback')!
    expect(ok.pass).toBe(true)
    const tall = generateDesigns(pipeline, ZONE_RULES, inp, { slab: { floors: 4 } }).find((d) => d.id === 'slab')!
    expect(tall.heightM).toBeCloseTo(12, 6)
    const row = evaluateChecks(tall, pipeline, ZONE_RULES, inp).rows.find((r) => r.label === 'Boundary setback')!
    expect(row.pass).toBe(false)
    expect(row.allowed).toBe('>= 3 m')
    expect(row.note).toMatch(/needs 3 m/)
  })
})

describe('containment', () => {
  const region: MetricPolygon = [[[0, 0], [40, 0], [40, 40], [0, 40]]]
  it('rejects a local 0.3 m x 10 m bump that the area slack alone would absorb', () => {
    const bump: MetricPolygon = [[[0, 0], [40, 0], [40, 15], [40.3, 15], [40.3, 25], [40, 25], [40, 40], [0, 40]]]
    expect(containedWithin(bump, region)).toBe(false)
  })
  it('accepts float noise under 5 cm and a polygon strictly inside', () => {
    const noisy: MetricPolygon = [[[0, 0], [40.03, 0], [40.03, 40], [0, 40]]]
    expect(containedWithin(noisy, region)).toBe(true)
    expect(containedWithin([[[5, 5], [35, 5], [35, 35], [5, 35]]], region)).toBe(true)
  })
  it('rejects an edge cutting across a reflex corner even when all vertices are inside', () => {
    const L: MetricPolygon = [[[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]]]
    const tri: MetricPolygon = [[[2, 2], [38, 18], [18, 38]]]
    // (38,18) and (18,38) are inside the L, but the edge between them crosses the notch.
    expect(containedWithin(tri, L)).toBe(false)
  })
})

describe('GFA cap row in the narrow-road hold', () => {
  it('names the 10,000 m2 extra-large hold, not the 18 m road tier', () => {
    const inp = inputs(rect(100, 100), { roadWidthM: 8 })
    const pipeline = runPipeline(inp, ZONE_RULES)
    expect(pipeline.envelope!.gfaCapNote).toMatch(/10,000 m2/)
    const designs = generateDesigns(pipeline, ZONE_RULES, inp)
    for (const d of designs) {
      const row = evaluateChecks(d, pipeline, ZONE_RULES, inp).rows.find((r) => r.ruleId === 'highrise-threshold')!
      expect(row, d.id).toBeDefined()
      expect(row.requirement).toMatch(/MR-33 ข้อ 1/)
      expect(row.requirement).not.toMatch(/under 18 m/)
      expect(row.pass).toBe(true)
      expect(d.gfaM2).toBeLessThan(10000)
    }
  })
})

describe('tower on podium never exceeds the GFA cap by default', () => {
  it('100 x 100 m on an 8 m road: the podium drops to 1 floor and the total stays under 10,000 m2', () => {
    const inp = inputs(rect(100, 100), { roadWidthM: 8 })
    const pipeline = runPipeline(inp, ZONE_RULES)
    const pt = generateDesigns(pipeline, ZONE_RULES, inp).find((d) => d.id === 'podiumTower')
    if (pt) {
      expect(pt.gfaM2).toBeLessThanOrEqual(pipeline.envelope!.gfaCapM2 + 0.5)
      expect(pt.blocks[0].floors).toBe(1)
      expect(evaluateChecks(pt, pipeline, ZONE_RULES, inp).pass).toBe(true)
    }
  })
})

describe('frontage building line (ข้อ 53)', () => {
  it('sums every road-facing edge within 20 m on a jagged 60-vertex star (not one 0.4 m edge)', () => {
    const inp = inputs(metricPlot(starPoints()))
    const pipeline = runPipeline(inp, ZONE_RULES)
    const ring = pipeline.metric!.plot[0]
    const slab = generateDesigns(pipeline, ZONE_RULES, inp).find((d) => d.id === 'slab')!
    const fr = frontage(slab.footprint, [ring[0], ring[1]], ZONE_RULES)
    expect(fr.lineM).toBeGreaterThan(fr.perimeterM / 8)
    expect(fr.lineM).toBeGreaterThan(20)
    const row = evaluateChecks(slab, pipeline, ZONE_RULES, inp).rows.find((r) => r.ruleId === 'bma-frontage')!
    expect(row.pass).toBe(true)
  })
  it('counts only edges facing the road: a 10 m deep block does not count its rear face', () => {
    const fp: MetricPolygon = [[[0, 5], [30, 5], [30, 15], [0, 15]]]
    const fr = rawFrontage(fp[0], [[0, 0], [30, 0]], 20)
    expect(fr.lineM).toBeCloseTo(30, 6)
    expect(fr.distanceM).toBeCloseTo(5, 6)
  })
  it('a deep narrow plot (25 x 60 m) is cut back so the default designs front the public way', () => {
    const inp = inputs(rect(25, 60))
    const pipeline = runPipeline(inp, ZONE_RULES)
    const designs = generateDesigns(pipeline, ZONE_RULES, inp)
    expect(designs.length).toBeGreaterThan(0)
    for (const d of designs) {
      expect(d.notes.join(' ')).toMatch(/ข้อ 53/)
      expect(d.footprintAreaM2).toBeLessThan(pipeline.envelope!.footprintAreaM2)
      expect(evaluateChecks(d, pipeline, ZONE_RULES, inp).pass).toBe(true)
    }
  })
})

describe('ignore-setbacks override on the tower-on-podium', () => {
  it('does not collapse to a 400 m2 x 1 floor tower (OSR cap skipped) and still fails OSR', () => {
    const inp = inputs(rect(40, 40))
    const pipeline = runPipeline(inp, ZONE_RULES)
    const pt = generateDesigns(pipeline, ZONE_RULES, inp, { podiumTower: { ignoreSetbacks: true } }).find((d) => d.id === 'podiumTower')!
    expect(pt.blocks[0].floors).toBe(2)
    expect(pt.blocks[1].floors).toBeGreaterThan(1)
    const failing = evaluateChecks(pt, pipeline, ZONE_RULES, inp).rows.filter((r) => !r.pass).map((r) => r.ruleId)
    expect(failing).toContain('zone-osr')
  })
})
