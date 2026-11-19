/**
 * Road width lookup for the front edge: OpenFreeMap tiles first (instant, has
 * class and name but no width/lanes), then Overpass for `width` / `lanes` tags.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { LngLat } from '../engine/projection'
import { METRES_PER_LANE, ROAD_HIGHWAY_CLASSES, roadWidthFromTags, type RoadTags } from '../engine/osm'
import type { RoadWidthSource } from '../store/types'
import { layerIdsForSourceLayers } from './mapStyle'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const TILE_QUERY_RADIUS_PX = 30
const OVERPASS_RADIUS_M = 30
/** Per-endpoint budget; Overpass mirrors are often slow or return 5xx. */
const OVERPASS_TIMEOUT_MS = 8000

/** OpenMapTiles `class` values that are roads (not paths, tracks or rail). */
const TILE_ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'])

export interface TileRoadInfo {
  cls: string
  name: string | null
  widthM: number | null
  widthSource: 'width' | 'lanes' | null
}

/** Nearest road rendered by the tiles around a point. Synchronous. */
export function roadInfoFromTiles(map: MapLibreMap, point: LngLat): TileRoadInfo | null {
  const layers = layerIdsForSourceLayers(map, ['transportation', 'transportation_name'])
  if (layers.length === 0) return null
  const p = map.project(point)
  const r = TILE_QUERY_RADIUS_PX
  const features = map.queryRenderedFeatures(
    [
      [p.x - r, p.y - r],
      [p.x + r, p.y + r],
    ],
    { layers },
  )
  let cls: string | null = null
  let name: string | null = null
  let widthM: number | null = null
  let widthSource: 'width' | 'lanes' | null = null
  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>
    const c = typeof props.class === 'string' ? props.class : null
    if (c && TILE_ROAD_CLASSES.has(c) && !cls) cls = c
    const n = pickName(props)
    if (n && !name) name = n
    if (widthM === null) {
      const fromTags = roadWidthFromTags({
        width: typeof props.width === 'string' || typeof props.width === 'number' ? String(props.width) : undefined,
        lanes: typeof props.lanes === 'string' || typeof props.lanes === 'number' ? String(props.lanes) : undefined,
      })
      if (fromTags) {
        widthM = fromTags.widthM
        widthSource = fromTags.source
      }
    }
  }
  if (!cls && !name) return null
  return { cls: cls ?? 'road', name, widthM, widthSource }
}

function pickName(props: Record<string, unknown>): string | null {
  for (const key of ['name:en', 'name_en', 'name:latin', 'name']) {
    const v = props[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}

export interface RoadWidthLookup {
  widthM: number | null
  source: RoadWidthSource
  roadInfo: string | null
}

interface OverpassWay {
  type: string
  tags?: Record<string, string>
}

/** Nearest OSM highway way to a point via Overpass, with width / lanes tags. */
async function overpassRoadNear(point: LngLat, signal: AbortSignal): Promise<RoadTags | null> {
  const [lng, lat] = point
  const query = `[out:json][timeout:20];way["highway"](around:${OVERPASS_RADIUS_M},${lat.toFixed(6)},${lng.toFixed(6)});out tags;`
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
      const json = (await res.json()) as { elements: OverpassWay[] }
      const roads = json.elements
        .map((e) => (e.tags ?? {}) as RoadTags)
        .filter((t) => t.highway && ROAD_HIGHWAY_CLASSES.has(t.highway))
      if (roads.length === 0) return null
      // Prefer ways that actually carry a width or lanes tag.
      const scored = roads
        .map((t) => ({ t, score: (t.width ? 2 : 0) + (t.lanes ? 1 : 0) }))
        .sort((a, b) => b.score - a.score)
      return scored[0].t
    } catch (err) {
      if (signal.aborted) throw err
      lastError = err
    }
  }
  throw lastError ?? new Error('Overpass unavailable')
}

/**
 * Resolves the road width for an edge midpoint. Returns the tile-based result
 * immediately via `onTiles`, then the Overpass refinement via the promise.
 */
export async function resolveRoadWidth(
  map: MapLibreMap,
  midpoint: LngLat,
  signal: AbortSignal,
  onTiles: (lookup: RoadWidthLookup) => void,
): Promise<RoadWidthLookup> {
  const tile = roadInfoFromTiles(map, midpoint)
  const tileLabel = tile ? [tile.name, tile.cls].filter(Boolean).join(' · ') : null
  if (tile?.widthM) {
    const lookup: RoadWidthLookup = {
      widthM: tile.widthM,
      roadInfo: tileLabel,
      source: {
        kind: tile.widthSource === 'width' ? 'osm-width' : 'osm-lanes',
        detail: tile.widthSource === 'width' ? 'OSM `width` tag (vector tile).' : `OSM \`lanes\` x ${METRES_PER_LANE} m (vector tile).`,
      },
    }
    onTiles(lookup)
    return lookup
  }
  onTiles({
    widthM: null,
    roadInfo: tileLabel,
    source: { kind: 'lookup', detail: 'Looking up the nearest OSM road in Overpass…' },
  })

  try {
    const tags = await overpassRoadNear(midpoint, signal)
    const name = tags ? (tags['name:en'] ?? tags.name ?? null) : null
    const info = tags ? [name ?? tile?.name ?? null, tags.highway ?? tile?.cls ?? null].filter(Boolean).join(' · ') || tileLabel : tileLabel
    const fromTags = tags ? roadWidthFromTags(tags) : null
    if (fromTags) {
      return {
        widthM: fromTags.widthM,
        roadInfo: info,
        source: {
          kind: fromTags.source === 'width' ? 'osm-width' : 'osm-lanes',
          detail:
            fromTags.source === 'width'
              ? `OSM \`width=${tags?.width}\` on the nearest highway (Overpass).`
              : `OSM \`lanes=${tags?.lanes}\` x ${METRES_PER_LANE} m on the nearest highway (Overpass).`,
        },
      }
    }
    return {
      widthM: null,
      roadInfo: info,
      source: {
        kind: 'default',
        detail: tags
          ? 'Nearest OSM road has no `width` or `lanes` tag. Default 12 m kept; edit if known.'
          : 'No OSM road within 30 m of the edge midpoint. Default 12 m kept; edit if known.',
      },
    }
  } catch (err) {
    if (signal.aborted) throw err
    return {
      widthM: null,
      roadInfo: tileLabel,
      source: { kind: 'default', detail: 'Overpass unreachable; default 12 m kept. Edit if known.' },
    }
  }
}
