/**
 * Derived state. Everything the UI and map show is computed from the store here,
 * so there is nothing to "recalculate" manually.
 */
import { useMemo } from 'react'
import { ringCentroid } from '../engine/geometry'
import { plotAreaM2, plotEdges, outerRing, validatePlot, type PlotEdge, type PlotValidation } from '../engine/plot'
import { EMPTY_PIPELINE_RESULT, runPipeline, type PipelineResult } from '../engine/pipeline'
import { ringToMetric, toWgs84, type LngLat } from '../engine/projection'
import { ZONE_RULES, findSubzone, type SubzoneProps } from '../rules'
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
  subzone: SubzoneProps | null
}

/** Which Y.10 sub-zone (if any) contains the plot centroid. */
export function selectZone(state: Pick<AppState, 'plot'>): ZoneCheck | null {
  const plot = state.plot
  if (!plot || !validatePlot(plot).ok) return null
  const c = ringCentroid(ringToMetric(outerRing(plot)))
  const centroid = toWgs84(c)
  return { centroid, subzone: findSubzone(centroid) }
}

export function useZone(): ZoneCheck | null {
  const plot = useAppStore((s) => s.plot)
  return useMemo(() => selectZone({ plot }), [plot])
}

export function selectPipeline(state: AppState): PipelineResult {
  if (!validatePlot(state.plot).ok) return EMPTY_PIPELINE_RESULT
  return runPipeline(
    {
      plot: state.plot,
      frontEdgeIndex: state.frontEdgeIndex,
      roadWidthM: state.roadWidthM,
      buildingType: state.buildingType,
      floorToFloorM: state.floorToFloorM,
    },
    ZONE_RULES,
  )
}

export function usePipelineResult(): PipelineResult {
  const plot = useAppStore((s) => s.plot)
  const frontEdgeIndex = useAppStore((s) => s.frontEdgeIndex)
  const roadWidthM = useAppStore((s) => s.roadWidthM)
  const buildingType = useAppStore((s) => s.buildingType)
  const floorToFloorM = useAppStore((s) => s.floorToFloorM)
  return useMemo(() => {
    if (!validatePlot(plot).ok) return EMPTY_PIPELINE_RESULT
    return runPipeline({ plot, frontEdgeIndex, roadWidthM, buildingType, floorToFloorM }, ZONE_RULES)
  }, [plot, frontEdgeIndex, roadWidthM, buildingType, floorToFloorM])
}
