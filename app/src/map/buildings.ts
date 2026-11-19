/**
 * 3D building data: checks whether the vector tiles carry heights and, if not,
 * fetches buildings from the Overpass API for the current view.
 */
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { buildingHeightFromTags, buildingMinHeightFromTags, type BuildingTags } from '../engine/osm'
import type { BuildingsSource } from '../store/types'
import { BUILDING_3D_LAYER_ID } from './mapStyle'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const OVERPASS_SOURCE_ID = 'osm-buildings-overpass'
const OVERPASS_LAYER_ID = 'osm-buildings-overpass-3d'
const OVERPASS_MIN_ZOOM = 15
const OVERPASS_TIMEOUT_MS = 20000
const OVERPASS_DEBOUNCE_MS = 700
const MAX_IDLE_CHECKS = 12

/**
 * After tiles load, inspects the rendered building features once. If most carry
 * `render_height` we keep the tile layer; otherwise the Overpass fallback is enabled.
 */
export function startBuildingHeightCheck(map: MapLibreMap, onResult: (source: BuildingsSource) => void): () => void {
  let checks = 0
  let done = false
  const onIdle = () => {
    if (done) return
    checks++
    if (!map.getLayer(BUILDING_3D_LAYER_ID)) {
      finish('overpass')
      return
    }
    const features = map.queryRenderedFeatures({ layers: [BUILDING_3D_LAYER_ID] })
    if (features.length === 0) {
      if (checks >= MAX_IDLE_CHECKS) {
        console.info('[buildings] no building features rendered after several idles; enabling Overpass fallback')
        finish('overpass')
      }
      return
    }
    const withHeight = features.filter((f) => {
      const h = f.properties?.render_height
      return typeof h === 'number' && h > 0
    }).length
    const ratio = withHeight / features.length
    console.info(
      `[buildings] ${features.length} building features in view, ${withHeight} with render_height (${Math.round(ratio * 100)}%). ` +
        (ratio >= 0.5 ? 'Using OpenFreeMap tile heights.' : 'Enabling Overpass fallback.'),
    )
    finish(ratio >= 0.5 ? 'tiles' : 'overpass')
  }
  const finish = (source: BuildingsSource) => {
    done = true
    map.off('idle', onIdle)
    if (source === 'overpass') {
      enableOverpassFallback(map, onResult)
    } else {
      onResult(source)
    }
  }
  map.on('idle', onIdle)
  return () => {
    done = true
    map.off('idle', onIdle)
  }
}

function enableOverpassFallback(map: MapLibreMap, onResult: (source: BuildingsSource) => void): void {
  if (map.getLayer(BUILDING_3D_LAYER_ID)) map.setLayoutProperty(BUILDING_3D_LAYER_ID, 'visibility', 'none')
  if (!map.getSource(OVERPASS_SOURCE_ID)) {
    map.addSource(OVERPASS_SOURCE_ID, { type: 'geojson', data: emptyCollection() })
    map.addLayer({
      id: OVERPASS_LAYER_ID,
      type: 'fill-extrusion',
      source: OVERPASS_SOURCE_ID,
      minzoom: 14,
      paint: {
        'fill-extrusion-height': ['get', 'heightM'],
        'fill-extrusion-base': ['get', 'minHeightM'],
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'heightM'], 0, '#e3e0da', 30, '#cfcbc4', 100, '#b9b5ae'],
        'fill-extrusion-opacity': 0.9,
      },
    })
  }

  const cache = new Map<string, FeatureCollection>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  const refresh = () => {
    if (map.getZoom() < OVERPASS_MIN_ZOOM) return
    const b = map.getBounds()
    const key = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(4)).join(',')
    const cached = cache.get(key)
    if (cached) {
      setData(map, cached)
      return
    }
    controller?.abort()
    controller = new AbortController()
    fetchOverpassBuildings(key, controller.signal)
      .then((fc) => {
        cache.set(key, fc)
        setData(map, fc)
        onResult('overpass')
      })
      .catch((err: unknown) => {
        if (controller?.signal.aborted) return
        console.warn('[buildings] Overpass fetch failed', err)
        onResult('overpass-failed')
      })
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(refresh, OVERPASS_DEBOUNCE_MS)
  }
  map.on('moveend', schedule)
  schedule()
}

function setData(map: MapLibreMap, fc: FeatureCollection): void {
  const src = map.getSource(OVERPASS_SOURCE_ID) as GeoJSONSource | undefined
  src?.setData(fc)
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

interface OverpassWay {
  type: 'way'
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

interface OverpassResponse {
  elements: Array<OverpassWay | { type: string }>
}

async function fetchOverpassBuildings(bbox: string, signal: AbortSignal): Promise<FeatureCollection> {
  const query = `[out:json][timeout:25];way["building"](${bbox});out geom;`
  let lastError: unknown = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(OVERPASS_TIMEOUT_MS)]),
      })
      if (!res.ok) throw new Error(`Overpass ${endpoint} responded ${res.status}`)
      const json = (await res.json()) as OverpassResponse
      return overpassToGeoJSON(json)
    } catch (err) {
      if (signal.aborted) throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('Overpass unavailable')
}

export function overpassToGeoJSON(json: OverpassResponse): FeatureCollection {
  const features: Feature<Polygon>[] = []
  for (const el of json.elements) {
    if (el.type !== 'way') continue
    const way = el as OverpassWay
    const ring = way.geometry
    if (!ring || ring.length < 4) continue
    const coords = ring.map((p) => [p.lon, p.lat])
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first)
    const tags = (way.tags ?? {}) as BuildingTags
    const { heightM, source } = buildingHeightFromTags(tags)
    features.push({
      type: 'Feature',
      id: way.id,
      properties: { heightM, minHeightM: buildingMinHeightFromTags(tags), heightSource: source },
      geometry: { type: 'Polygon', coordinates: [coords] },
    })
  }
  return { type: 'FeatureCollection', features }
}
