/**
 * Rule pipeline entry point. Phase 3 fills in the stages; for now this is a typed
 * stub that returns an empty result so the store, URL state and UI can already
 * depend on its shape. Pure module.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import type { BuildingType } from '../rules'

export interface PipelineInputs {
  /** Plot polygon in WGS84, or null when nothing is drawn. */
  plot: Polygon | null
  /** Index of the road-facing edge in the plot's outer ring, or null if not picked yet. */
  frontEdgeIndex: number | null
  /** Width of the road the front edge faces, metres. */
  roadWidthM: number
  buildingType: BuildingType
}

/** Every stage returns geometry plus one-line annotations explaining what changed and why. */
export interface StageResult {
  id: string
  label: string
  geometry: Polygon | MultiPolygon | null
  annotations: string[]
}

export interface Envelope {
  footprint: Polygon | MultiPolygon
  footprintAreaM2: number
  maxHeightM: number
  maxFloors: number
  maxGfaM2: number
  /** Which rule is binding (height, FAR or OSR). */
  bindingRule: string
}

export interface PipelineResult {
  stages: StageResult[]
  envelope: Envelope | null
  annotations: string[]
}

export const EMPTY_PIPELINE_RESULT: PipelineResult = { stages: [], envelope: null, annotations: [] }

export function runPipeline(inputs: PipelineInputs): PipelineResult {
  if (!inputs.plot) return EMPTY_PIPELINE_RESULT
  return {
    stages: [],
    envelope: null,
    annotations: ['Rule pipeline not wired yet (Phase 3).'],
  }
}
