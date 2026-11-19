import type { Map as MapLibreMap } from 'maplibre-gl'
import { ZONE_CENTER } from '../rules'
import type { MapView } from '../store/types'

/** OpenFreeMap "Liberty" style: free OSM vector tiles, no API key. */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** Sub-zone ย.10-4 (Sukhumvit Soi 31-55, north side), Bangkok. */
export const INITIAL_VIEW: MapView = { lng: ZONE_CENTER[0], lat: ZONE_CENTER[1], zoom: 16.3, pitch: 55, bearing: -20 }

/** OpenMapTiles building layer in the Liberty style. */
export const BUILDING_3D_LAYER_ID = 'building-3d'
export const BUILDING_SOURCE_LAYER = 'building'

/**
 * Makes sure a fill-extrusion building layer exists and looks the way we want.
 * The Liberty style already ships `building-3d` driven by `render_height`; if a
 * style ever lacks it we add our own on the same source layer.
 */
export function ensureBuildings3D(map: MapLibreMap): void {
  const existing = map.getLayer(BUILDING_3D_LAYER_ID)
  if (!existing) {
    const source = findVectorSourceWithLayer(map, BUILDING_SOURCE_LAYER)
    if (!source) return
    map.addLayer({
      id: BUILDING_3D_LAYER_ID,
      type: 'fill-extrusion',
      source,
      'source-layer': BUILDING_SOURCE_LAYER,
      minzoom: 14,
      filter: ['!', ['has', 'hide_3d']],
      paint: {
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-color': '#d6d3cd',
        'fill-extrusion-opacity': 0.85,
      },
    })
  }
  // The style's own expressions are bare `get`s, which warn on features missing the
  // attribute; make them null-safe.
  map.setPaintProperty(BUILDING_3D_LAYER_ID, 'fill-extrusion-height', ['coalesce', ['get', 'render_height'], 5])
  map.setPaintProperty(BUILDING_3D_LAYER_ID, 'fill-extrusion-base', ['coalesce', ['get', 'render_min_height'], 0])
  // Slightly cooler, height-graded tone so towers read as towers.
  map.setPaintProperty(BUILDING_3D_LAYER_ID, 'fill-extrusion-color', [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'render_height'], 0],
    0, '#e3e0da',
    30, '#cfcbc4',
    100, '#b9b5ae',
  ])
  map.setPaintProperty(BUILDING_3D_LAYER_ID, 'fill-extrusion-opacity', 0.9)
  map.setPaintProperty(BUILDING_3D_LAYER_ID, 'fill-extrusion-vertical-gradient', true)
}

function findVectorSourceWithLayer(map: MapLibreMap, sourceLayer: string): string | null {
  const style = map.getStyle()
  for (const layer of style.layers) {
    if ('source-layer' in layer && layer['source-layer'] === sourceLayer && 'source' in layer && typeof layer.source === 'string') {
      return layer.source
    }
  }
  return null
}

/** Layer ids whose source-layer is one of the given OpenMapTiles layers. */
export function layerIdsForSourceLayers(map: MapLibreMap, sourceLayers: readonly string[]): string[] {
  const style = map.getStyle()
  const wanted = new Set(sourceLayers)
  return style.layers
    .filter((l) => 'source-layer' in l && typeof l['source-layer'] === 'string' && wanted.has(l['source-layer']))
    .map((l) => l.id)
}

/** Id of the first symbol (label) layer, so our geometry can sit under labels. */
export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id
}

/** Ground resolution at the current view, metres per CSS pixel (512 px tiles). */
export function metresPerPixel(map: MapLibreMap): number {
  const lat = map.getCenter().lat
  return (40075016.686 * Math.abs(Math.cos((lat * Math.PI) / 180))) / (512 * Math.pow(2, map.getZoom()))
}
