import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { polygonToWgs84, toMetric, type LngLat, type XY } from './projection'
import { runPipeline, roadSetbackM, boundarySetbackM, isHighRiseEnvelope, type Envelope, type PipelineInputs } from './pipeline'
import { plotAreaM2 } from './plot'
import { ZONE_RULES, buildingTypeRules } from '../rules'
import { booleanWithin } from '@turf/turf'

const ORIGIN: LngLat = [100.5724, 13.7363]

function metricPlot(offsets: XY[]): Polygon {
  const [x0, y0] = toMetric(ORIGIN)
  const ring: XY[] = offsets.map(([dx, dy]) => [x0 + dx, y0 + dy])
  ring.push(ring[0])
  return polygonToWgs84({ type: 'Polygon', coordinates: [ring] })
}

const SQUARE_40 = metricPlot([
  [0, 0],
  [40, 0],
  [40, 40],
  [0, 40],
])

const L_SHAPE = metricPlot([
  [0, 0],
  [60, 0],
  [60, 30],
  [30, 30],
  [30, 60],
  [0, 60],
])

const CONCAVE_7 = metricPlot([
  [0, 0],
  [70, 0],
  [70, 30],
  [50, 30],
  [50, 12],
  [30, 12],
  [30, 50],
])

const SLIVER = metricPlot([
  [0, 0],
  [60, 0],
  [60, 9],
  [0, 9],
])

function inputs(plot: Polygon, over: Partial<PipelineInputs> = {}): PipelineInputs {
  return { plot, frontEdgeIndex: 0, roadWidthM: 12, buildingType: 'condo', floorToFloorM: 3.0, ...over }
}

describe('rule lookups', () => {
  it('road setback tiers follow MR-55 ข้อ 41', () => {
    expect(roadSetbackM(ZONE_RULES, 4).m).toBeCloseTo(4, 6) // 6 - 2 (tier 2 beats 3 - 2 = 1)
    expect(roadSetbackM(ZONE_RULES, 8).m).toBeCloseTo(2, 6) // 6 - 4
    expect(roadSetbackM(ZONE_RULES, 12).m).toBeCloseTo(1.2, 6) // W/10
    expect(roadSetbackM(ZONE_RULES, 20).m).toBeCloseTo(2, 6)
    expect(roadSetbackM(ZONE_RULES, 30).m).toBeCloseTo(2, 6)
  })

  it('boundary setback combines openings and perimeter rules by height', () => {
    const condo = buildingTypeRules(ZONE_RULES, 'condo')
    expect(boundarySetbackM(ZONE_RULES, condo, 8).m).toBe(2)
    expect(boundarySetbackM(ZONE_RULES, condo, 14).m).toBe(3)
    expect(boundarySetbackM(ZONE_RULES, condo, 21).m).toBe(3)
  })
})

describe('worked example from docs/RESEARCH.md (40 x 40 m, 12 m road, condo)', () => {
  const result = runPipeline(inputs(SQUARE_40), ZONE_RULES)
  const env = result.envelope!

  it('switches to the high-rise regime and reproduces 784 m2 / 36 m / 12 floors / 9,408 m2', () => {
    expect(result.ok).toBe(true)
    expect(result.regime).toBe('highRise')
    expect(env.footprintAreaM2).toBeCloseTo(784, 1)
    expect(env.maxHeightM).toBeCloseTo(36, 6)
    expect(env.maxFloors).toBe(12)
    expect(env.heightM).toBeCloseTo(36, 6)
    expect(env.gfaM2).toBeCloseTo(9408, 1)
    expect(env.maxGfaM2).toBeCloseTo(12800, 3)
    expect(env.bindingRule).toBe('height')
    expect(env.openSpaceM2).toBeCloseTo(816, 1)
    // 30% of plot = 480 m2 governs; OSR 4% of the actual GFA (9,408 m2) is 376 m2.
    // (RESEARCH.md quotes 512 m2 = 4% of the FAR cap; the engine uses the GFA actually built.)
    expect(env.openSpaceRequiredM2).toBeCloseTo(480, 3)
  })

  it('shows the capped standard alternative: 1,120 m2, 7 floors, 21 m, 7,840 m2', () => {
    const capped = result.alternatives.find((a) => a.label.startsWith('Standard regime, kept'))!
    // The shrink search stops within 0.5 m2 under the 1,120 m2 target, hence the tolerances.
    expect(Math.abs(capped.footprintAreaM2 - 1120)).toBeLessThan(0.6)
    expect(capped.maxFloors).toBe(7)
    expect(capped.heightM).toBeCloseTo(21, 6)
    expect(Math.abs(capped.gfaM2 - 7840)).toBeLessThan(5)
  })

  it('reports the road and boundary setbacks as 6 m with MR-33 sources', () => {
    const road = result.stages.find((s) => s.id === 'roadSetback')!
    const boundary = result.stages.find((s) => s.id === 'boundarySetback')!
    expect(road.numbers.frontSetbackM).toBe(6)
    expect(boundary.numbers.boundarySetbackM).toBe(6)
    expect(road.sources).toContain('mr33-clearance')
    expect(road.annotations.join(' ')).toMatch(/MR-33/)
  })
})

describe('pipeline invariants', () => {
  const cases: Array<[string, PipelineInputs]> = [
    ['square condo', inputs(SQUARE_40)],
    ['square condo narrow road', inputs(SQUARE_40, { roadWidthM: 6 })],
    ['square condo wide road', inputs(SQUARE_40, { roadWidthM: 30, floorToFloorM: 2.8 })],
    ['L-shape condo', inputs(L_SHAPE, { frontEdgeIndex: 1 })],
    ['concave 7-gon condo', inputs(CONCAVE_7, { frontEdgeIndex: 0, roadWidthM: 16 })],
    ['L-shape low-rise', inputs(L_SHAPE, { buildingType: 'lowRiseResidential', roadWidthM: 8 })],
    ['square low-rise', inputs(SQUARE_40, { buildingType: 'lowRiseResidential' })],
  ]

  for (const [name, inp] of cases) {
    it(`holds for ${name}`, () => {
      const r = runPipeline(inp, ZONE_RULES)
      expect(r.ok).toBe(true)
      const e = r.envelope!
      const A = plotAreaM2(inp.plot!)
      const far = ZONE_RULES.zone.far
      const openFrac = buildingTypeRules(ZONE_RULES, inp.buildingType).openSpacePlotPercentMin / 100
      // GFA never exceeds FAR x area
      expect(e.gfaM2).toBeLessThanOrEqual(far * A + 1e-6)
      expect(e.gfaM2).toBeCloseTo(e.maxFloors * e.footprintAreaM2, 6)
      // footprint respects the open-space floor and the OSR
      expect(e.footprintAreaM2).toBeLessThanOrEqual((1 - openFrac) * A + 0.5)
      expect(e.openSpaceM2).toBeGreaterThanOrEqual((ZONE_RULES.zone.osrPercent / 100) * e.gfaM2 - 0.5)
      // built height never exceeds the cap
      expect(e.maxFloors * inp.floorToFloorM).toBeLessThanOrEqual(e.maxHeightM + 1e-6)
      expect(e.heightM).toBeCloseTo(e.maxFloors * inp.floorToFloorM, 9)
      // footprint polygon sits inside the plot
      expect(booleanWithin(e.footprint!, inp.plot!)).toBe(true)
      // regime consistency
      if (r.regime === 'standard' && inp.buildingType === 'condo') {
        expect(e.heightM).toBeLessThan(ZONE_RULES.thresholds.highRiseHeightM)
        expect(e.gfaM2).toBeLessThan(ZONE_RULES.thresholds.extraLargeGfaM2)
      }
      if (inp.buildingType === 'lowRiseResidential') {
        expect(r.regime).toBe('standard')
        expect(e.maxFloors).toBeLessThanOrEqual(3)
        expect(e.heightM).toBeLessThanOrEqual(10)
      }
      // every stage cites at least one rule id that exists
      for (const st of r.stages) {
        for (const id of st.sources) expect(ZONE_RULES.rules.some((rule) => rule.id === id) || id === 'plot').toBe(true)
      }
    })
  }

  it('a 9 m sliver cannot take the MR-33 band, so it falls back to a standard building under 23 m', () => {
    const r = runPipeline(inputs(SLIVER), ZONE_RULES)
    expect(r.ok).toBe(true)
    expect(r.regime).toBe('standard')
    expect(r.regimeReason).toMatch(/consumes this plot/)
    expect(r.envelope!.heightM).toBeLessThan(23)
    expect(r.envelope!.gfaM2).toBeLessThan(10000)
  })

  it('a 4 m sliver is consumed by the standard setbacks (1.2 m + 3 m) and reported, not crashed', () => {
    const thin = metricPlot([
      [0, 0],
      [60, 0],
      [60, 4],
      [0, 4],
    ])
    const r = runPipeline(inputs(thin), ZONE_RULES)
    expect(r.ok).toBe(false)
    expect(r.envelope).toBeNull()
    const env = r.stages.find((s) => s.id === 'envelope')!
    expect(env.annotations.join(' ')).toMatch(/consume/)
  })

  it('needs a front edge before it runs', () => {
    const r = runPipeline(inputs(SQUARE_40, { frontEdgeIndex: null }), ZONE_RULES)
    expect(r.ok).toBe(false)
    expect(r.stages).toHaveLength(1)
    expect(r.annotations[0]).toMatch(/front/i)
  })

  it('handles the share-link square (slightly rotated in UTM) that broke the sweep-line', () => {
    const urlPlot: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [100.5724, 13.7363],
          [100.5727699, 13.7363],
          [100.5727699, 13.73666175],
          [100.5724, 13.73666175],
          [100.5724, 13.7363],
        ],
      ],
    }
    const r = runPipeline(inputs(urlPlot), ZONE_RULES)
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).not.toMatch(/Geometry engine/)
    expect(r.envelope!.maxFloors).toBe(12)
    expect(r.envelope!.footprintAreaM2).toBeGreaterThan(770)
    expect(r.envelope!.footprintAreaM2).toBeLessThan(800)
    // Random-ish rotations and shapes must never throw.
    for (let k = 1; k <= 12; k++) {
      const ang = (k * 13 * Math.PI) / 180
      const rot = ([x, y]: XY): XY => [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)]
      const base: XY[] = [[0, 0], [45, 0], [45, 18], [28, 18], [28, 40], [0, 40]]
      const pts: XY[] = base.map(rot)
      const res = runPipeline(inputs(metricPlot(pts), { roadWidthM: 6 + k, frontEdgeIndex: k % 6 }), ZONE_RULES)
      expect(res.warnings.join(' ')).not.toMatch(/Geometry engine/)
      expect(res.ok).toBe(true)
    }
  })

  it('floor-to-floor changes floors, not the height cap', () => {
    const a = runPipeline(inputs(SQUARE_40, { floorToFloorM: 3.0 }), ZONE_RULES).envelope!
    const b = runPipeline(inputs(SQUARE_40, { floorToFloorM: 3.5 }), ZONE_RULES).envelope!
    expect(a.maxHeightM).toBeCloseTo(b.maxHeightM, 9)
    expect(b.maxFloors).toBeLessThan(a.maxFloors)
    expect(b.heightM).toBeLessThanOrEqual(b.maxHeightM)
  })

  it('a small plot on a narrow soi stays in the standard regime', () => {
    const small = metricPlot([
      [0, 0],
      [16, 0],
      [16, 20],
      [0, 20],
    ])
    const r = runPipeline(inputs(small, { roadWidthM: 6 }), ZONE_RULES)
    expect(r.ok).toBe(true)
    expect(r.regime).toBe('standard')
    const e = r.envelope!
    // road 6 m: tier 2 -> 6 - 3 = 3 m from the edge; height cap 2 x (6 + 3) = 18 m -> 6 floors
    expect(r.stages.find((s) => s.id === 'roadSetback')!.numbers.frontSetbackM).toBeCloseTo(3, 6)
    expect(e.maxHeightM).toBeCloseTo(18, 6)
    expect(e.maxFloors).toBe(6)
  })
})

describe('boundary setback uses the built height', () => {
  it('a 3-storey house on a 6 m soi is 9.0 m, so the openings rule gives 2 m (footprint 240 m2), not 3 m', () => {
    const plot = metricPlot([
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ])
    const r = runPipeline(inputs(plot, { roadWidthM: 6, buildingType: 'lowRiseResidential' }), ZONE_RULES)
    expect(r.ok).toBe(true)
    const boundary = r.stages.find((s) => s.id === 'boundarySetback')!
    expect(boundary.numbers.boundarySetbackM).toBe(2)
    expect(r.stages.find((s) => s.id === 'roadSetback')!.numbers.frontSetbackM).toBeCloseTo(3, 6)
    expect(r.envelope!.heightM).toBeCloseTo(9, 6)
    // (20 - 2 - 2) x (20 - 3 - 2) = 16 x 15 = 240
    expect(r.envelope!.footprintAreaM2).toBeCloseTo(240, 0)
  })

  it('a condo built to 18 m on the same soi still gets 3 m', () => {
    const r = runPipeline(inputs(metricPlot([[0, 0], [16, 0], [16, 20], [0, 20]]), { roadWidthM: 6 }), ZONE_RULES)
    expect(r.envelope!.heightM).toBeCloseTo(18, 6)
    expect(r.stages.find((s) => s.id === 'boundarySetback')!.numbers.boundarySetbackM).toBe(3)
  })
})

describe('high-rise recompute guard', () => {
  it('isHighRiseEnvelope follows MR-33 ข้อ 1 thresholds', () => {
    const fake = (heightM: number, gfaM2: number) => ({ heightM, gfaM2 }) as Envelope
    expect(isHighRiseEnvelope(fake(23, 100), 23, 10000)).toBe(true)
    expect(isHighRiseEnvelope(fake(22.9, 100), 23, 10000)).toBe(false)
    expect(isHighRiseEnvelope(fake(10, 10000), 23, 10000)).toBe(true)
    expect(isHighRiseEnvelope(null, 23, 10000)).toBe(false)
  })

  it('whenever the active regime is high-rise, the envelope itself is high-rise (scan of plots and roads)', () => {
    const shapes: XY[][] = [
      [[0, 0], [40, 0], [40, 40], [0, 40]],
      [[0, 0], [30, 0], [30, 50], [0, 50]],
      [[0, 0], [60, 0], [60, 30], [30, 30], [30, 60], [0, 60]],
      [[0, 0], [25, 0], [25, 25], [0, 25]],
    ]
    for (const shape of shapes) {
      for (const W of [10, 12, 16, 20, 30]) {
        const r = runPipeline(inputs(metricPlot(shape), { roadWidthM: W }), ZONE_RULES)
        if (r.regime === 'highRise') expect(isHighRiseEnvelope(r.envelope, 23, 10000)).toBe(true)
      }
    }
  })
})

describe('performance', () => {
  it('a 60-vertex star plot runs the full pipeline in well under a second', async () => {
    const pts: XY[] = []
    for (let i = 0; i < 60; i++) {
      const ang = (2 * Math.PI * i) / 60
      const r = i % 2 === 0 ? 60 : 44
      pts.push([r * Math.cos(ang), r * Math.sin(ang)])
    }
    const star = metricPlot(pts)
    const inp = inputs(star, { roadWidthM: 12 })
    const { generateDesigns } = await import('../designs/templates')
    const { evaluateChecks } = await import('../checks/evaluate')
    // Warm up module code once, then time.
    runPipeline(inp, ZONE_RULES)
    const t0 = performance.now()
    const r = runPipeline(inp, ZONE_RULES)
    const designs = generateDesigns(r, ZONE_RULES, inp)
    designs.forEach((d) => evaluateChecks(d, r, ZONE_RULES, inp))
    const ms = performance.now() - t0
    console.info(`[perf] 60-vertex star: pipeline + ${designs.length} designs + checks in ${ms.toFixed(0)} ms`)
    expect(r.ok).toBe(true)
    expect(ms).toBeLessThan(400)
  })
})
