/**
 * Derived state. Everything the UI and map show is computed from the store here,
 * so there is nothing to "recalculate" manually.
 */
import { useMemo } from 'react'
import { ringCentroid } from '../engine/geometry'
import { plotAreaM2, plotEdges, outerRing, validatePlot, type PlotEdge, type PlotValidation } from '../engine/plot'
import { EMPTY_PIPELINE_RESULT, runPipeline, type PipelineResult } from '../engine/pipeline'
import { ringToMetric, toWgs84, type LngLat } from '../engine/projection'
import { ZONE_BBOX, ZONE_RULES, findSubzone, type SubzoneProps } from '../rules'
import { generateDesignSet, type UnavailableTemplate } from '../designs/templates'
import type { Design } from '../designs/types'
import { evaluateChecks } from '../checks/evaluate'
import type { ChecklistResult } from '../checks/types'
import { useAppStore, type AppState } from './useAppStore'

/**
 * Plot area in m2, planar in UTM 47N (the same frame the rule pipeline uses, so
 * FAR x area stays consistent with the envelope). Null when nothing is drawn.
 */
export function usePlotArea(): number | null {
  const plot = useAppStore((s) => s.plot)
  return useMemo(() => (plot && (plot.coordinates[0]?.length ?? 0) >= 4 ? plotAreaM2(plot) : null), [plot])
}

export function usePlotEdges(): PlotEdge[] {
  const plot = useAppStore((s) => s.plot)
  return useMemo(() => (plot ? plotEdges(plot) : []), [plot])
}

export function useFrontEdge(): PlotEdge | null {
  const edges = usePlotEdges()
  const index = useAppStore((s) => s.frontEdgeIndex)
  return index === null ? null : (edges[index] ?? null)
}

export function usePlotValidation(): PlotValidation {
  const plot = useAppStore((s) => s.plot)
  return useMemo(() => validatePlot(plot), [plot])
}

export interface ZoneCheck {
  centroid: LngLat
  /** Sub-zone containing the plot centroid (the one used), or null when outside Y.10. */
  subzone: SubzoneProps | null
  /** Distinct sub-zones (or 'outside Y.10') touched by the plot's vertices, when more than one. */
  straddles: string[] | null
  /** Some vertex lies outside the mapped Y.10 area (bounding box of all sub-zones). */
  outsideMapArea: boolean
}

/** Which Y.10 sub-zone (if any) contains the plot centroid, and whether the plot straddles a boundary. */
export function selectZone(state: Pick<AppState, 'plot'>): ZoneCheck | null {
  const plot = state.plot
  if (!plot || !validatePlot(plot).ok) return null
  const ring = outerRing(plot)
  const c = ringCentroid(ringToMetric(ring))
  const centroid = toWgs84(c)
  const codes = new Set<string>()
  let outsideMapArea = false
  for (const p of ring) {
    codes.add(findSubzone([p[0], p[1]])?.code ?? 'outside Y.10')
    if (p[0] < ZONE_BBOX[0] || p[0] > ZONE_BBOX[2] || p[1] < ZONE_BBOX[1] || p[1] > ZONE_BBOX[3]) outsideMapArea = true
  }
  return { centroid, subzone: findSubzone(centroid), straddles: codes.size > 1 ? [...codes].sort() : null, outsideMapArea }
}

export function useZone(): ZoneCheck | null {
  const plot = useAppStore((s) => s.plot)
  return useMemo(() => selectZone({ plot }), [plot])
}

type PipelineKey = Pick<AppState, 'plot' | 'frontEdgeIndex' | 'roadWidthM' | 'buildingType' | 'floorToFloorM'>

/** One result shared by React and the map: a last-args cache keyed on the input references. */
let pipelineCache: { key: PipelineKey; result: PipelineResult } | null = null

function sameKey(a: PipelineKey, b: PipelineKey): boolean {
  return (
    a.plot === b.plot &&
    a.frontEdgeIndex === b.frontEdgeIndex &&
    a.roadWidthM === b.roadWidthM &&
    a.buildingType === b.buildingType &&
    a.floorToFloorM === b.floorToFloorM
  )
}

export function selectPipeline(state: PipelineKey): PipelineResult {
  if (pipelineCache && sameKey(pipelineCache.key, state)) return pipelineCache.result
  const key: PipelineKey = {
    plot: state.plot,
    frontEdgeIndex: state.frontEdgeIndex,
    roadWidthM: state.roadWidthM,
    buildingType: state.buildingType,
    floorToFloorM: state.floorToFloorM,
  }
  const result = validatePlot(state.plot).ok ? runPipeline(key, ZONE_RULES) : EMPTY_PIPELINE_RESULT
  pipelineCache = { key, result }
  return result
}

export function usePipelineResult(): PipelineResult {
  const plot = useAppStore((s) => s.plot)
  const frontEdgeIndex = useAppStore((s) => s.frontEdgeIndex)
  const roadWidthM = useAppStore((s) => s.roadWidthM)
  const buildingType = useAppStore((s) => s.buildingType)
  const floorToFloorM = useAppStore((s) => s.floorToFloorM)
  return useMemo(() => selectPipeline({ plot, frontEdgeIndex, roadWidthM, buildingType, floorToFloorM }), [plot, frontEdgeIndex, roadWidthM, buildingType, floorToFloorM])
}

function pipelineInputs(state: Pick<AppState, 'plot' | 'frontEdgeIndex' | 'roadWidthM' | 'buildingType' | 'floorToFloorM'>) {
  return {
    plot: state.plot,
    frontEdgeIndex: state.frontEdgeIndex,
    roadWidthM: state.roadWidthM,
    buildingType: state.buildingType,
    floorToFloorM: state.floorToFloorM,
  }
}

export interface DesignWithChecks {
  design: Design
  checks: ChecklistResult
}

let designsCache: { pipeline: PipelineResult; overrides: AppState['designOverrides']; result: DesignWithChecks[]; unavailable: UnavailableTemplate[] } | null = null

function computeDesigns(state: AppState, pipeline: PipelineResult) {
  if (designsCache && designsCache.pipeline === pipeline && designsCache.overrides === state.designOverrides) return designsCache
  // Mid-drag: keep the last designs (the map hides them) instead of paying for designs + checks per move.
  if (state.plotSettling && designsCache) return designsCache
  let result: DesignWithChecks[] = []
  let unavailable: UnavailableTemplate[] = []
  if (pipeline.ok) {
    const inputs = pipelineInputs(state)
    const set = generateDesignSet(pipeline, ZONE_RULES, inputs, state.designOverrides)
    unavailable = set.unavailable
    result = set.designs.map((design) => ({
      design,
      checks: evaluateChecks(design, pipeline, ZONE_RULES, inputs),
    }))
  }
  designsCache = { pipeline, overrides: state.designOverrides, result, unavailable }
  return designsCache
}

/** All concept designs for the current envelope, each with its checklist (shared cache). */
export function selectDesigns(state: AppState, pipeline: PipelineResult = selectPipeline(state)): DesignWithChecks[] {
  return computeDesigns(state, pipeline).result
}

/** Templates not offered for the current envelope, with the reason (same cache as the designs). */
export function selectUnavailableTemplates(state: AppState, pipeline: PipelineResult = selectPipeline(state)): UnavailableTemplate[] {
  return computeDesigns(state, pipeline).unavailable
}

export function selectSelectedDesign(state: AppState, pipeline?: PipelineResult): DesignWithChecks | null {
  const all = selectDesigns(state, pipeline)
  return all.find((d) => d.design.id === state.selectedDesignId) ?? all[0] ?? null
}

export function useDesigns(): DesignWithChecks[] {
  const pipeline = usePipelineResult()
  const plot = useAppStore((s) => s.plot)
  const frontEdgeIndex = useAppStore((s) => s.frontEdgeIndex)
  const roadWidthM = useAppStore((s) => s.roadWidthM)
  const buildingType = useAppStore((s) => s.buildingType)
  const floorToFloorM = useAppStore((s) => s.floorToFloorM)
  const designOverrides = useAppStore((s) => s.designOverrides)
  const plotSettling = useAppStore((s) => s.plotSettling)
  return useMemo(
    () => selectDesigns({ plot, frontEdgeIndex, roadWidthM, buildingType, floorToFloorM, designOverrides, plotSettling } as AppState, pipeline),
    [pipeline, plot, frontEdgeIndex, roadWidthM, buildingType, floorToFloorM, designOverrides, plotSettling],
  )
}
