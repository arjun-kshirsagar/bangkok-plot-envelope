import { describe, expect, it } from 'vitest'
import { runPipeline, type PipelineInputs } from '../engine/pipeline'
import type { XY } from '../engine/projection'
import { metricPlot, starPoints } from './fixtures'
import { ZONE_RULES } from '../rules'
import type { BuildingType } from '../rules/types'
import { generateDesigns } from './templates'
import { evaluateChecks } from '../checks/evaluate'

const rect = (w: number, h: number): XY[] => [[0, 0], [w, 0], [w, h], [0, h]]

const PLOTS: Record<string, XY[]> = {
  '40x40': rect(40, 40),
  '70x70': rect(70, 70),
  '100x100': rect(100, 100),
  '25x60': rect(25, 60),
  'concave 10-gon': [[0, 0], [80, 0], [80, 25], [62, 25], [62, 45], [80, 45], [80, 70], [0, 70], [0, 40], [20, 32]],
  '60-star': starPoints(),
}
const ROADS = [6, 8, 12, 20, 30]
const TYPES: BuildingType[] = ['condo', 'lowRiseResidential']

describe('every DEFAULT design passes every non-informational check', () => {
  for (const [name, pts] of Object.entries(PLOTS)) {
    const plot = metricPlot(pts)
    for (const type of TYPES) {
      it(`${name}, ${type}, roads ${ROADS.join('/')} m`, () => {
        for (const road of ROADS) {
          const inp: PipelineInputs = { plot, frontEdgeIndex: 0, roadWidthM: road, buildingType: type, floorToFloorM: 3.0 }
          const pipeline = runPipeline(inp, ZONE_RULES)
          const designs = generateDesigns(pipeline, ZONE_RULES, inp)
          for (const d of designs) {
            const c = evaluateChecks(d, pipeline, ZONE_RULES, inp)
            const failing = c.rows.filter((r) => !r.pass && !r.informational).map((r) => `${r.label}: ${r.actual} vs ${r.allowed}`)
            expect(failing, `${name} / ${road} m / ${type} / ${d.id}`).toEqual([])
            if (pipeline.envelope) expect(d.gfaM2).toBeLessThanOrEqual(pipeline.envelope.gfaCapM2 + 0.5)
          }
        }
      })
    }
  }
})
