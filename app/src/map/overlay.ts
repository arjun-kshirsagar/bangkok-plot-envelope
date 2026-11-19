/**
 * deck.gl overlay interleaved with the MapLibre scene. Phase 3 turns pipeline
 * stages and the envelope into extruded PolygonLayers here.
 */
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Layer } from '@deck.gl/core'
import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import type { PipelineResult } from '../engine/pipeline'

export function createOverlay(map: MapLibreMap): MapboxOverlay {
  const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
  map.addControl(overlay as unknown as IControl)
  return overlay
}

export function buildPipelineLayers(_result: PipelineResult): Layer[] {
  return []
}
