/**
 * Y.10 sub-zone polygons from BMA's ArcGIS layer (see docs/DECISIONS.md: approximate,
 * +/- 50-100 m, never parcel-accurate). Point-in-polygon honours interior rings.
 */
import { booleanPointInPolygon } from '@turf/turf'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import rawZones from './bangkok-zone-y10.json'

export interface SubzoneProps {
  zone: string
  subzone: string
  /** Latin-digit code, e.g. "Y.10-4" (from the Thai-numeral `subzone`). */
  code: string
  far: number
  osrPercent: number
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'

export function thaiDigitsToLatin(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
}

function toCode(subzone: string): string {
  return thaiDigitsToLatin(subzone).replace(/^ย\./, 'Y.')
}

interface RawProps {
  zone: string
  subzone: string
  far: number
  osrPercent: number
}

const raw = rawZones as unknown as FeatureCollection<Polygon, RawProps>

export const ZONE_SUBZONES: FeatureCollection<Polygon, SubzoneProps> = {
  type: 'FeatureCollection',
  features: raw.features.map((f): Feature<Polygon, SubzoneProps> => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      zone: f.properties.zone,
      subzone: f.properties.subzone,
      code: toCode(f.properties.subzone),
      far: f.properties.far,
      osrPercent: f.properties.osrPercent,
    },
  })),
}

function computeBbox(): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const f of ZONE_SUBZONES.features) {
    for (const ring of f.geometry.coordinates) {
      for (const [x, y] of ring) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > n) n = y
      }
    }
  }
  return [w, s, e, n]
}

/** [west, south, east, north] of all Y.10 sub-zones. */
export const ZONE_BBOX: [number, number, number, number] = computeBbox()

/** Sub-zone ย.10-4 centre (rules JSON zone.approxBounds.center). */
export const ZONE_CENTER: [number, number] = [100.5724, 13.7363]

export function findSubzone(point: [number, number]): SubzoneProps | null {
  for (const f of ZONE_SUBZONES.features) {
    if (booleanPointInPolygon(point, f)) return f.properties
  }
  return null
}
