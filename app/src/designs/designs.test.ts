import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { runPipeline, type PipelineInputs } from '../engine/pipeline'
import { polygonToWgs84, toMetric, type LngLat, type XY } from '../engine/projection'
import { polygonArea } from '../engine/offset'
import { ZONE_RULES } from '../rules'
import { generateDesigns, hasMinWidth } from './templates'
import { evaluateChecks } from '../checks/evaluate'

const ORIGIN: LngLat = [100.5724, 13.7363]

function metricPlot(offsets: XY[]): Polygon {
  const [x0, y0] = toMetric(ORIGIN)
  const ring: XY[] = offsets.map(([dx, dy]) => [x0 + dx, y0 + dy])
  ring.push(ring[0])
  return polygonToWgs84({ type: 'Polygon', coordinates: [ring] })
}

const SQUARE_40 = metricPlot([[0, 0], [40, 0], [40, 40], [0, 40]])
const SQUARE_70 = metricPlot([[0, 0], [70, 0], [70, 70], [0, 70]])

function inputs(plot: Polygon, over: Partial<PipelineInputs> = {}): PipelineInputs {
  return { plot, frontEdgeIndex: 0, roadWidthM: 12, buildingType: 'condo', floorToFloorM: 3.0, ...over }
}

function run(inp: PipelineInputs, overrides = {}) {
  const pipeline = runPipeline(inp, ZONE_RULES)
  const designs = generateDesigns(pipeline, ZONE_RULES, inp, overrides)
  return { pipeline, designs, checks: designs.map((d) => evaluateChecks(d, pipeline, ZONE_RULES, inp)) }
}

describe('design templates on the worked example (40 x 40 m, 12 m road, condo)', () => {
  const inp = inputs(SQUARE_40)
  const { pipeline, designs, checks } = run(inp)

  it('produces slab and podium-tower (courtyard needs > 1,500 m2 footprint) and all pass every check', () => {
    expect(designs.map((d) => d.id)).toEqual(['slab', 'podiumTower'])
    checks.forEach((c, i) => {
      expect(c.pass, `${designs[i].id}: ${c.rows.filter((r) => !r.pass).map((r) => r.label).join(', ')}`).toBe(true)
      expect(c.passed).toBe(c.total)
      expect(c.total).toBeGreaterThanOrEqual(8)
    })
  })

  it('slab GFA equals the envelope GFA', () => {
    const slab = designs.find((d) => d.id === 'slab')!
    expect(slab.gfaM2).toBeCloseTo(pipeline.envelope!.gfaM2, 3)
    expect(slab.floors).toBe(12)
    expect(slab.heightM).toBeCloseTo(36, 6)
    expect(slab.footprintAreaM2).toBeCloseTo(784, 1)
  })

  it('podium + tower keeps the GFA target and the tower is at least 12 m wide', () => {
    const pt = designs.find((d) => d.id === 'podiumTower')!
    const env = pipeline.envelope!
    const target = Math.min(env.maxGfaM2, env.gfaM2)
    expect(pt.gfaM2).toBeLessThanOrEqual(env.maxGfaM2 + 0.5)
    if (pt.limitedBy !== 'thinness') expect(pt.gfaM2).toBeGreaterThanOrEqual(0.9 * target - 1)
    expect(pt.blocks).toHaveLength(2)
    const tower = pt.blocks[1]
    expect(tower.baseM).toBeCloseTo(6, 6)
    expect(hasMinWidth(tower.footprint, 12)).toBe(true)
    expect(pt.limitedBy).toBe('height')
    expect(pt.floors).toBe(12)
  })

  it('override floors to max + 3 fails the height row and only the height row', () => {
    const { designs: d2, checks: c2 } = run(inp, { slab: { floors: 15 } })
    const slab = d2.find((d) => d.id === 'slab')!
    const c = c2[d2.indexOf(slab)]
    expect(slab.floors).toBe(15)
    expect(slab.limitedBy).toBe('override')
    const failing = c.rows.filter((r) => !r.pass).map((r) => r.ruleId)
    expect(failing).toEqual(['mr55-height-road'])
    expect(c.pass).toBe(false)
  })

  it('ignoring setbacks fails the setback and MR-33 rows', () => {
    const { designs: d3, checks: c3 } = run(inp, { slab: { ignoreSetbacks: true } })
    const slab = d3.find((d) => d.id === 'slab')!
    const c = c3[d3.indexOf(slab)]
    const failing = c.rows.filter((r) => !r.pass).map((r) => r.label)
    expect(failing).toContain('Road setback')
    expect(failing).toContain('Boundary setback')
    expect(failing).toContain('High-rise 6 m clearance')
    expect(failing).toContain('Open space 30% of plot')
  })
})

describe('tower on podium when FAR binds (40 x 40 m, 30 m road)', () => {
  it('rises to the height cap on a slimmer tower with GFA at the FAR cap', () => {
    const inp = inputs(SQUARE_40, { roadWidthM: 30 })
    const { pipeline, designs, checks } = run(inp)
    expect(pipeline.envelope!.bindingRule).toBe('far')
    const pt = designs.find((d) => d.id === 'podiumTower')!
    expect(pt.limitedBy).toBe('far')
    expect(pt.floors).toBe(pipeline.envelope!.floorsByHeight)
    expect(pt.gfaM2).toBeLessThanOrEqual(pipeline.envelope!.maxGfaM2 + 0.5)
    expect(pt.gfaM2).toBeGreaterThanOrEqual(0.98 * pipeline.envelope!.maxGfaM2)
    expect(pt.blocks[1].areaM2).toBeLessThan(pt.blocks[0].areaM2)
    expect(checks[designs.indexOf(pt)].pass).toBe(true)
  })
})

describe('courtyard template', () => {
  it('returns null on a small plot and a ring with a hole on a large one', () => {
    expect(run(inputs(SQUARE_40)).designs.some((d) => d.id === 'courtyard')).toBe(false)
    const { pipeline, designs, checks } = run(inputs(SQUARE_70))
    const court = designs.find((d) => d.id === 'courtyard')!
    expect(court).toBeDefined()
    expect(court.footprint).toHaveLength(2)
    expect(court.footprintAreaM2).toBeCloseTo(58 * 58 - 38 * 38, 0)
    expect(court.floors).toBeLessThanOrEqual(pipeline.envelope!.maxFloors)
    expect(court.gfaM2).toBeLessThanOrEqual(pipeline.envelope!.maxGfaM2)
    expect(polygonArea(court.blocks[0].footprint)).toBeCloseTo(court.footprintAreaM2, 6)
    expect(checks[designs.indexOf(court)].pass).toBe(true)
  })
})

describe('frontage check (ข้อ 53 fronting, else ข้อ 52(6) front open space)', () => {
  const [x0, y0] = toMetric(ORIGIN)
  const rectAt = (x1: number, y1: number, x2: number, y2: number) => [[[x0 + x1, y0 + y1], [x0 + x2, y0 + y1], [x0 + x2, y0 + y2], [x0 + x1, y0 + y2]] as [number, number][]]

  it('a building 25 m back on a straight-fronted plot passes by a 12 m front open space band reaching the road', () => {
    const inp = inputs(metricPlot([[0, 0], [40, 0], [40, 80], [0, 80]]))
    const { pipeline, designs } = run(inp)
    const slab = designs.find((d) => d.id === 'slab')!
    const block = { ...slab, floors: 12, heightM: 36, footprint: rectAt(6, 25, 34, 60) }
    const row = evaluateChecks(block, pipeline, ZONE_RULES, inp).rows.find((r) => r.ruleId === 'bma-frontage')!
    expect(row.pass).toBe(true)
    expect(row.note).toMatch(/Does not front the road/)
    expect(row.note).toMatch(/Uses the ข้อ 52\(6\) front open space: 12 m band, 28 m along the building \(needs >= 21 m\), connected by a straight open path at least 6 m wide/)
  })

  it('fails when the band along the building is shorter than 1/6 of its perimeter, with the numbers', () => {
    const inp = inputs(metricPlot([[0, 0], [15, 0], [15, 80], [0, 80]]))
    const { pipeline } = run(inp)
    const block = { ...run(inputs(metricPlot([[0, 0], [40, 0], [40, 80], [0, 80]]))).designs[0], floors: 12, heightM: 36, footprint: rectAt(3, 25, 12, 65) }
    const row = evaluateChecks(block, pipeline, ZONE_RULES, inp).rows.find((r) => r.ruleId === 'bma-frontage')!
    expect(row.pass).toBe(false)
    expect(row.note).toMatch(/No ข้อ 52\(6\) front open space either: 12 m band 9 m long \(needs >= 16.3 m\)/)
  })

  it('a flag lot (12 m x 20 m pole, 40 x 50 m body, 20 m road) keeps the full height via the front open space and the pole', () => {
    const flag = metricPlot([[0, 0], [12, 0], [12, 20], [26, 20], [26, 70], [-14, 70], [-14, 20], [0, 20]])
    const inp = inputs(flag, { roadWidthM: 20 })
    const { pipeline, designs, checks } = run(inp)
    expect(Math.round(pipeline.metric!.plotAreaM2)).toBe(2240)
    const env = pipeline.envelope!
    const slab = designs.find((d) => d.id === 'slab')!
    expect(slab.floors).toBe(env.maxFloors)
    expect(slab.floors).toBeGreaterThan(3)
    expect(slab.notes.join(' ')).toMatch(/Uses the ข้อ 52\(6\) front open space/)
    expect(slab.notes.join(' ')).toMatch(/connected (by a straight open path|through an open corridor) at least 6 m wide/)
    checks.forEach((c, i) => expect(c.pass, designs[i].id).toBe(true))
  })

  it('a 15 x 80 m lot on its short edge either goes above 3 storeys or says why with numbers', () => {
    const inp = inputs(metricPlot([[0, 0], [15, 0], [15, 80], [0, 80]]))
    const { designs } = run(inp)
    for (const d of designs) {
      if (d.floors <= 3 && d.floorsCap !== undefined) expect(d.notes.join(' ')).toMatch(/needs >= \d/)
    }
  })
})

describe('design regime self-trigger', () => {
  it('flags a standard-envelope design that is overridden above 23 m', () => {
    const small = metricPlot([[0, 0], [16, 0], [16, 20], [0, 20]])
    const inp = inputs(small, { roadWidthM: 6 })
    const { pipeline, designs, checks } = run(inp, { slab: { floors: 9 } })
    expect(pipeline.regime).toBe('standard')
    const slab = designs.find((d) => d.id === 'slab')!
    const c = checks[designs.indexOf(slab)]
    expect(c.designRegime).toBe('highRise')
    const row = c.rows.find((r) => r.label === 'High-rise 6 m clearance')!
    expect(row.pass).toBe(false)
    expect(row.note).toMatch(/pushes itself/)
  })

  it('every design and check is deterministic and never throws across floor overrides', () => {
    const inp = inputs(SQUARE_70, { roadWidthM: 16 })
    for (let f = 1; f <= 20; f += 3) {
      const { designs, checks } = run(inp, { slab: { floors: f }, podiumTower: { floors: f }, courtyard: { floors: f } })
      expect(designs.length).toBe(3)
      checks.forEach((c) => expect(c.total).toBeGreaterThan(0))
    }
  })
})

describe('MR-33 road access tiers shape the envelope and the designs', () => {
  it('70 x 70 m on a 12 m soi: GFA capped at 30,000 m2 and every template passes', () => {
    const inp = inputs(SQUARE_70)
    const { pipeline, designs, checks } = run(inp)
    expect(pipeline.regime).toBe('highRise')
    expect(pipeline.envelope!.gfaCapM2).toBeCloseTo(30000, 0)
    expect(pipeline.envelope!.gfaM2).toBeLessThanOrEqual(30000)
    expect(designs.map((d) => d.id)).toEqual(['slab', 'podiumTower', 'courtyard'])
    checks.forEach((c, i) => {
      expect(c.pass, `${designs[i].id}: ${c.rows.filter((r) => !r.pass).map((r) => `${r.label} ${r.actual} vs ${r.allowed}`).join(', ')}`).toBe(true)
      expect(designs[i].gfaM2).toBeLessThanOrEqual(30000.5)
      expect(designs[i].openSpaceM2).toBeGreaterThanOrEqual(0.04 * designs[i].gfaM2 - 0.5)
    })
  })

  it('70 x 70 m on a 20 m road: full FAR available, podium-tower reaches it within OSR', () => {
    const inp = inputs(SQUARE_70, { roadWidthM: 20 })
    const { pipeline, designs, checks } = run(inp)
    expect(pipeline.envelope!.gfaCapM2).toBeCloseTo(pipeline.envelope!.maxGfaM2, 3)
    checks.forEach((c, i) => expect(c.pass, `${designs[i].id}: ${c.rows.filter((r) => !r.pass).map((r) => r.label).join(', ')}`).toBe(true))
  })

  it('a 70 x 70 m condo on an 8 m soi cannot go high-rise: envelope held under 23 m / 10,000 m2', () => {
    // 40 x 40 m on 8 m stays standard by the height rule alone; 70 x 70 m would cross 10,000 m2 by GFA.
    const small = run(inputs(SQUARE_40, { roadWidthM: 8 }))
    expect(small.pipeline.regime).toBe('standard')
    expect(small.pipeline.warnings).toHaveLength(0)
    const inp = inputs(SQUARE_70, { roadWidthM: 8 })
    const { pipeline, designs, checks } = run(inp)
    expect(pipeline.regime).toBe('standard')
    expect(pipeline.regimeReason).toMatch(/MR-33 ข้อ 2/)
    expect(pipeline.envelope!.heightM).toBeLessThan(23)
    expect(pipeline.envelope!.gfaM2).toBeLessThan(10000)
    expect(pipeline.warnings.join(' ')).toMatch(/not permitted/)
    checks.forEach((c, i) => expect(c.pass, `${designs[i].id}: ${c.rows.filter((r) => !r.pass).map((r) => r.label).join(', ')}`).toBe(true))
  })
})
