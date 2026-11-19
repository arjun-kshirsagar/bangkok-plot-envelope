/**
 * Highlights the picked front edge (and the edge under the cursor while picking)
 * as line layers on top of the drawn plot.
 */
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { PlotEdge } from '../engine/plot'

const FRONT_SOURCE = 'plot-front-edge'
const FRONT_LAYER = 'plot-front-edge-line'
const HOVER_SOURCE = 'plot-edge-hover'
const HOVER_LAYER = 'plot-edge-hover-line'

export const FRONT_EDGE_COLOR = '#f59e0b'
export const HOVER_EDGE_COLOR = '#ffffff'

export interface EdgeHighlighter {
  setFront: (edge: PlotEdge | null) => void
  setHover: (edge: PlotEdge | null) => void
}

function edgeToCollection(edge: PlotEdge | null): FeatureCollection {
  if (!edge) return { type: 'FeatureCollection', features: [] }
  const f: Feature<LineString> = {
    type: 'Feature',
    properties: { index: edge.index },
    geometry: { type: 'LineString', coordinates: [edge.start, edge.end] },
  }
  return { type: 'FeatureCollection', features: [f] }
}

export function createEdgeHighlighter(map: MapLibreMap): EdgeHighlighter {
  map.addSource(FRONT_SOURCE, { type: 'geojson', data: edgeToCollection(null) })
  map.addSource(HOVER_SOURCE, { type: 'geojson', data: edgeToCollection(null) })
  map.addLayer({
    id: HOVER_LAYER,
    type: 'line',
    source: HOVER_SOURCE,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': HOVER_EDGE_COLOR, 'line-width': 8, 'line-opacity': 0.9, 'line-dasharray': [1, 1] },
  })
  map.addLayer({
    id: FRONT_LAYER,
    type: 'line',
    source: FRONT_SOURCE,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': FRONT_EDGE_COLOR, 'line-width': 7, 'line-opacity': 0.95 },
  })
  return {
    setFront: (edge) => (map.getSource(FRONT_SOURCE) as GeoJSONSource | undefined)?.setData(edgeToCollection(edge)),
    setHover: (edge) => (map.getSource(HOVER_SOURCE) as GeoJSONSource | undefined)?.setData(edgeToCollection(edge)),
  }
}
