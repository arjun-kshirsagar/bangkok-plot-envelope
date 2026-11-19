/**
 * Planar helpers on metric coordinates. Pure module.
 */
import type { Position } from 'geojson'
import type { XY } from './projection'

/** Absolute shoelace area of a ring (closed or open), in the ring's units squared. */
export function ringArea(ring: Position[]): number {
  const pts = dropClosingPoint(ring)
  const n = pts.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return Math.abs(sum) / 2
}

export function segmentLength(a: Position, b: Position): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/** Shortest distance from point p to segment ab. */
export function pointToSegmentDistance(p: Position, a: Position, b: Position): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return segmentLength(p, a)
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const proj: XY = [a[0] + t * abx, a[1] + t * aby]
  return segmentLength(p, proj)
}

/** Compass bearing in degrees (0 = north, 90 = east) of the vector a -> b in a metric frame. */
export function bearingDeg(a: Position, b: Position): number {
  const deg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
  return (deg + 360) % 360
}

export function samePoint(a: Position, b: Position, eps = 1e-12): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps
}

/** Returns the ring without its closing point (if the ring is closed). */
export function dropClosingPoint(ring: Position[]): Position[] {
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) return ring.slice(0, -1)
  return ring
}

/** Returns a closed ring (first point repeated at the end). */
export function closeRing(ring: Position[]): Position[] {
  const open = dropClosingPoint(ring)
  return open.length ? [...open, open[0]] : open
}

/** Signed area (positive = counter-clockwise in a y-up frame). */
export function signedRingArea(ring: Position[]): number {
  const pts = dropClosingPoint(ring)
  const n = pts.length
  if (n < 3) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

/** Area-weighted centroid of a simple ring (metric frame). Falls back to the vertex mean. */
export function ringCentroid(ring: Position[]): XY {
  const pts = dropClosingPoint(ring)
  const n = pts.length
  if (n === 0) return [0, 0]
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    const cross = x1 * y2 - x2 * y1
    a += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  if (Math.abs(a) < 1e-9) {
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** Perimeter of a ring (closed or open). */
export function ringPerimeter(ring: Position[]): number {
  const pts = dropClosingPoint(ring)
  let sum = 0
  for (let i = 0; i < pts.length; i++) sum += segmentLength(pts[i], pts[(i + 1) % pts.length])
  return sum
}

/** Shortest distance between two segments a1-a2 and b1-b2 (planar). */
export function segmentToSegmentDistance(a1: Position, a2: Position, b1: Position, b2: Position): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0
  return Math.min(
    pointToSegmentDistance(a1, b1, b2),
    pointToSegmentDistance(a2, b1, b2),
    pointToSegmentDistance(b1, a1, a2),
    pointToSegmentDistance(b2, a1, a2),
  )
}

function orient(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

export function segmentsIntersect(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const d1 = orient(b1, b2, a1)
  const d2 = orient(b1, b2, a2)
  const d3 = orient(a1, a2, b1)
  const d4 = orient(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Shortest distance from any edge of a ring to a segment. */
export function ringToSegmentDistance(ring: Position[], a: Position, b: Position): number {
  const pts = dropClosingPoint(ring)
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, segmentToSegmentDistance(pts[i], pts[(i + 1) % pts.length], a, b))
  }
  return best
}
