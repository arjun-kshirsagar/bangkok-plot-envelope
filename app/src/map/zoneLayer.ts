/**
 * Y.10 sub-zone outlines and labels (approximate BMA GIS boundaries).
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ZONE_SUBZONES } from '../rules'
import { BUILDING_3D_LAYER_ID } from './mapStyle'

const SOURCE_ID = 'zone-y10'
export const ZONE_FILL_LAYER = 'zone-y10-fill'
export const ZONE_LINE_LAYER = 'zone-y10-line'
export const ZONE_LABEL_LAYER = 'zone-y10-label'
export const ZONE_COLOR = '#9a6b3f'

export function addZoneLayers(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return
  map.addSource(SOURCE_ID, { type: 'geojson', data: ZONE_SUBZONES })
  const below = map.getLayer(BUILDING_3D_LAYER_ID) ? BUILDING_3D_LAYER_ID : undefined
  map.addLayer(
    {
      id: ZONE_FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      paint: { 'fill-color': ZONE_COLOR, 'fill-opacity': 0.08 },
    },
    below,
  )
  map.addLayer(
    {
      id: ZONE_LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ZONE_COLOR, 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [3, 2] },
    },
    below,
  )
  map.addLayer({
    id: ZONE_LABEL_LAYER,
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'text-field': ['get', 'code'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-letter-spacing': 0.05,
      'symbol-placement': 'point',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': ZONE_COLOR,
      'text-halo-color': 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.5,
    },
  })
}
