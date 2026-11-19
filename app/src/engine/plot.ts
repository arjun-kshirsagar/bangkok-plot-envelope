/**
 * Plot helpers: edges, areas, nearest-edge picking, validation. Pure module.
 * Input polygons are GeoJSON in WGS84; metric quantities use the UTM 47N frame.
 */
import type { Polygon, Position } from 'geojson'
import { kinks } from '@turf/turf'
import {
  bearingDeg,
  dropClosingPoint,
  pointToSegmentDistance,
  ringArea,
  samePoint,
  segmentLength,
} from './geometry'
import { ringToMetric, toMetric, toWgs84, type LngLat } from './projection'

export interface PlotEdge {
  /** Index of the edge = index of its start vertex in the (unclosed) outer ring. */
  index: number
  start: LngLat
  end: LngLat
  midpoint: LngLat
  lengthM: number
  /** Compass bearing of the edge direction, degrees. */
  bearingDeg: number
}

/** Outer ring without the closing point, with consecutive duplicate vertices removed. */
export function outerRing(plot: Polygon): Position[] {
  const ring = plot.coordinates[0] ?? []
  const open = dropClosingPoint(ring)
  const out: Position[] = []
  for (const p of open) {
    if (out.length === 0 || !samePoint(out[out.length - 1], p, 1e-9)) out.push(p)
  }
  return out
}

/** Plot area in square metres (planar, UTM 47N). */
export function plotAreaM2(plot: Polygon): number {
  const outer = ringArea(ringToMetric(outerRing(plot)))
  let holes = 0
  for (let i = 1; i < plot.coordinates.length; i++) holes += ringArea(ringToMetric(plot.coordinates[i]))
  return Math.max(0, outer - holes)
}

export function plotPerimeterM(plot: Polygon): number {
  return plotEdges(plot).reduce((s, e) => s + e.lengthM, 0)
}

export function plotEdges(plot: Polygon): PlotEdge[] {
  const ring = outerRing(plot)
  if (ring.length < 2) return []
  const metric = ringToMetric(ring)
  const edges: PlotEdge[] = []
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    const a = metric[i]
    const b = metric[j]
    const mid = toWgs84([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
    edges.push({
      index: i,
      start: [ring[i][0], ring[i][1]],
      end: [ring[j][0], ring[j][1]],
      midpoint: mid,
      lengthM: segmentLength(a, b),
      bearingDeg: bearingDeg(a, b),
    })
  }
  return edges
}

/** The edge of the plot closest to a WGS84 point, with the planar distance in metres. */
export function nearestEdge(plot: Polygon, point: LngLat): { index: number; distanceM: number } | null {
  const ring = outerRing(plot)
  if (ring.length < 2) return null
  const metric = ringToMetric(ring)
  const p = toMetric(point)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = pointToSegmentDistance(p, metric[i], metric[(i + 1) % ring.length])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best < 0 ? null : { index: best, distanceM: bestD }
}

/**
 * Keeps the front edge pointing at the same physical edge after the ring changes.
 * If the vertex count is unchanged the index is kept; otherwise the edge of the
 * new ring whose midpoint is closest to the old front edge midpoint is chosen.
 */
export function remapFrontEdge(prevPlot: Polygon | null, prevIndex: number | null, nextPlot: Polygon | null): number | null {
  if (prevIndex === null || !nextPlot) return null
  const nextEdges = plotEdges(nextPlot)
  if (nextEdges.length === 0) return null
  if (!prevPlot) return prevIndex < nextEdges.length ? prevIndex : null
  const prevEdges = plotEdges(prevPlot)
  const prevEdge = prevEdges[prevIndex]
  if (!prevEdge) return null
  if (prevEdges.length === nextEdges.length) return prevIndex
  const target = toMetric(prevEdge.midpoint)
  let best = 0
  let bestD = Infinity
  for (const e of nextEdges) {
    const d = segmentLength(target, toMetric(e.midpoint))
    if (d < bestD) {
      bestD = d
      best = e.index
    }
  }
  return best
}

export type PlotValidation = { ok: true } | { ok: false; reason: string }

export function validatePlot(plot: Polygon | null): PlotValidation {
  if (!plot) return { ok: false, reason: 'No plot drawn yet.' }
  const ring = outerRing(plot)
  if (ring.length < 3) return { ok: false, reason: 'A plot needs at least three vertices.' }
  if (plotAreaM2(plot) < 1) return { ok: false, reason: 'Plot area is zero.' }
  const selfIntersections = kinks({ type: 'Polygon', coordinates: [[...ring, ring[0]]] })
  if (selfIntersections.features.length > 0) {
    return { ok: false, reason: 'Plot outline crosses itself. Move the vertices so the edges do not intersect.' }
  }
  return { ok: true }
}
