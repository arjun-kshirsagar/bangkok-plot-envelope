/**
 * Local metric frame for Bangkok: WGS84 (EPSG:4326) <-> UTM zone 47N (EPSG:32647).
 *
 * All offsets, lengths and areas in the engine are computed in this frame, in
 * metres. GeoJSON at the store / map boundary stays in WGS84. Never buffer in degrees.
 *
 * Pure module: no DOM, React or map imports.
 */
import proj4 from 'proj4'
import type { Polygon, Position } from 'geojson'

export const WGS84 = 'EPSG:4326'
/** UTM 47N on the WGS84 datum. Zone 47 spans 96E to 102E; Bangkok sits near 100.5E. */
export const EPSG_32647 = '+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs +type=crs'

const converter = proj4(WGS84, EPSG_32647)

/** [longitude, latitude] in degrees. */
export type LngLat = [number, number]
/** [easting, northing] in metres (UTM 47N). */
export type XY = [number, number]

export function toMetric(p: LngLat | Position): XY {
  const [x, y] = converter.forward([p[0], p[1]])
  return [x, y]
}

export function toWgs84(p: XY | Position): LngLat {
  const [lng, lat] = converter.inverse([p[0], p[1]])
  return [lng, lat]
}

export function ringToMetric(ring: Position[]): XY[] {
  return ring.map((p) => toMetric(p))
}

export function ringToWgs84(ring: Position[]): LngLat[] {
  return ring.map((p) => toWgs84(p))
}

export function polygonToMetric(poly: Polygon): Polygon {
  return { type: 'Polygon', coordinates: poly.coordinates.map((r) => ringToMetric(r)) }
}

export function polygonToWgs84(poly: Polygon): Polygon {
  return { type: 'Polygon', coordinates: poly.coordinates.map((r) => ringToWgs84(r)) }
}
