/**
 * OSM tag parsing helpers. Pure module.
 */

export const DEFAULT_BUILDING_HEIGHT_M = 12
export const METRES_PER_LEVEL = 3.5
export const METRES_PER_LANE = 3.5

/** Parses an OSM `height`-like tag ("25", "25 m", "25.5m", "80 ft", "80'"). Returns null if unparseable. */
export function parseLengthTag(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  const s = raw.trim().toLowerCase().replace(',', '.')
  const m = /^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|'|)$/.exec(s)
  if (!m) return null
  const value = parseFloat(m[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = m[2]
  if (unit === 'ft' || unit === 'feet' || unit === "'") return value * 0.3048
  return value
}

/** Parses an integer-like tag such as `building:levels` or `lanes` ("3", "2;3" -> 2). */
export function parseCountTag(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  const m = /^(\d+(?:\.\d+)?)/.exec(raw.trim())
  if (!m) return null
  const v = parseFloat(m[1])
  return Number.isFinite(v) && v > 0 ? v : null
}

export interface BuildingTags {
  height?: string
  'building:levels'?: string
  min_height?: string
  'building:min_level'?: string
}

/** Height rule from IMPLEMENTATION.md: `height`, else levels x 3.5 m, else 12 m. */
export function buildingHeightFromTags(tags: BuildingTags): { heightM: number; source: 'height' | 'levels' | 'default' } {
  const h = parseLengthTag(tags.height)
  if (h !== null) return { heightM: h, source: 'height' }
  const levels = parseCountTag(tags['building:levels'])
  if (levels !== null) return { heightM: levels * METRES_PER_LEVEL, source: 'levels' }
  return { heightM: DEFAULT_BUILDING_HEIGHT_M, source: 'default' }
}

export function buildingMinHeightFromTags(tags: BuildingTags): number {
  const h = parseLengthTag(tags.min_height)
  if (h !== null) return h
  const lvl = parseCountTag(tags['building:min_level'])
  return lvl !== null ? lvl * METRES_PER_LEVEL : 0
}

export interface RoadTags {
  width?: string
  lanes?: string
  highway?: string
  name?: string
  'name:en'?: string
}

/** Road width from OSM tags: `width` if present, else lanes x 3.5 m, else null. */
export function roadWidthFromTags(tags: RoadTags): { widthM: number; source: 'width' | 'lanes' } | null {
  const w = parseLengthTag(tags.width)
  if (w !== null) return { widthM: w, source: 'width' }
  const lanes = parseCountTag(tags.lanes)
  if (lanes !== null) return { widthM: lanes * METRES_PER_LANE, source: 'lanes' }
  return null
}

/** Highway classes that count as a road a plot can face. Footways, paths and steps are excluded. */
export const ROAD_HIGHWAY_CLASSES: ReadonlySet<string> = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
])
