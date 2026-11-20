import { describe, expect, it } from 'vitest'
import { runPipeline, type PipelineInputs } from '../engine/pipeline'
import { ZONE_RULES } from '../rules'
import type { BuildingType } from '../rules/types'
import { generateDesignSet } from './templates'
import { evaluateChecks } from '../checks/evaluate'
import { metricPlot, starPoints, SWEEP_PLOTS } from './fixtures'
import type { XY } from '../engine/projection'

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
