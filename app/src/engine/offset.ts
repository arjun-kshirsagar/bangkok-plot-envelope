/**
 * Inward offsets (erosion) of a plot in the metric frame. Pure module.
 *
 * The law says "every part of the building must be at least d from the boundary /
 * road". That is exactly the erosion of the plot by d along each edge, so the
 * footprint is the plot minus, for every edge i, the stadium (capsule) of radius
 * d_i around that edge segment. Per-edge distances (road vs boundary) fall out
 * naturally, concave plots work, and corners are handled by the end caps.
 * Boolean work is done by polygon-clipping (Martinez), which is robust on
 * metre-scale coordinates.
 */
import type { Position } from 'geojson'
import * as pcModule from 'polygon-clipping'
import type { MultiPolygon as PcMultiPolygon, Polygon as PcPolygon, Ring as PcRing } from 'polygon-clipping'
import { closeRing, dropClosingPoint, ringArea } from './geometry'

type PcApi = {
  difference: typeof pcModule.difference
  intersection: typeof pcModule.intersection
  union: typeof pcModule.union
}
// The package ships a default export at runtime but declares named exports in its typings.
const pc: PcApi = ((pcModule as unknown as { default?: PcApi }).default ?? (pcModule as unknown as PcApi))

export type MetricRing = PcRing
export type MetricPolygon = PcPolygon
export type MetricMultiPolygon = PcMultiPolygon

export function toMetricRing(ring: Position[]): MetricRing {
  return dropClosingPoint(ring).map((p) => [p[0], p[1]] as [number, number])
}

export function polygonArea(poly: MetricPolygon): number {
  if (poly.length === 0) return 0
  let a = ringArea(poly[0])
  for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i])
  return Math.max(0, a)
}

export function multiPolygonArea(mp: MetricMultiPolygon): number {
  return mp.reduce((s, p) => s + polygonArea(p), 0)
}

/**
 * Rectangle of half-width d around segment a-b (no end caps), pulled in by
 * `shorten` at both ends so its end sides do not pass exactly through the plot
 * vertices (which would stack several clip edges on one point and upset the
 * sweep-line). The vertex circle is circumscribed, so it still covers the gap.
 */
export function edgeStrip(a: [number, number], b: [number, number], d: number, shorten = 0): MetricRing {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0 || d <= 0) return []
  const s = len > 4 * shorten ? shorten : 0
  const ux = dx / len
  const uy = dy / len
  const a2: [number, number] = [a[0] + ux * s, a[1] + uy * s]
  const b2: [number, number] = [b[0] - ux * s, b[1] - uy * s]
  const nx = -uy * d
  const ny = ux * d
  return [
    [a2[0] + nx, a2[1] + ny],
    [b2[0] + nx, b2[1] + ny],
    [b2[0] - nx, b2[1] - ny],
    [a2[0] - nx, a2[1] - ny],
  ]
}

/**
 * Polygon circumscribing the circle of radius d around c (so every point of the true
 * disk is removed; conservative), sampled with a phase offset so vertices avoid
 * axis-aligned corners.
 */
export function circle(c: [number, number], d: number, segments = 24, phase = Math.PI / segments): MetricRing {
  const r = d / Math.cos(Math.PI / segments)
  const pts: MetricRing = []
  for (let i = 0; i < segments; i++) {
    const t = phase + (2 * Math.PI * i) / segments
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
  }
  return pts
}

/** Stadium (rectangle + semicircular caps) of radius d around segment a-b. Kept for tests / tooling. */
export function capsule(a: [number, number], b: [number, number], d: number, capSegments = 12): MetricRing {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0 || d <= 0) return []
  const ux = dx / len
  const uy = dy / len
  const base = Math.atan2(uy, ux)
  const pts: MetricRing = []
  for (let i = 0; i <= capSegments; i++) {
    const t = base + Math.PI / 2 - (Math.PI * i) / capSegments
    pts.push([b[0] + d * Math.cos(t), b[1] + d * Math.sin(t)])
  }
  for (let i = 0; i <= capSegments; i++) {
    const t = base - Math.PI / 2 - (Math.PI * i) / capSegments
    pts.push([a[0] + d * Math.cos(t), a[1] + d * Math.sin(t)])
  }
  return pts
}

export interface ErodeResult {
  /** Largest remaining piece, or null when the offsets consume the polygon. */
  polygon: MetricPolygon | null
  /** Number of pieces the erosion produced (1 is the normal case). */
  pieces: number
  /** Area of the pieces dropped when more than one remained. */
  droppedAreaM2: number
  /** The part of the input the offsets removed (plot ∩ union of clips), for rendering bands. */
  removed: MetricMultiPolygon
}

/** Keeps the largest polygon of a multipolygon. */
export function largestPiece(mp: MetricMultiPolygon): ErodeResult {
  if (mp.length === 0) return { polygon: null, pieces: 0, droppedAreaM2: 0, removed: [] }
  let best = 0
  let bestArea = -1
  let total = 0
  mp.forEach((p, i) => {
    const a = polygonArea(p)
    total += a
    if (a > bestArea) {
      bestArea = a
      best = i
    }
  })
  if (bestArea < 1e-6) return { polygon: null, pieces: 0, droppedAreaM2: 0, removed: [] }
  return { polygon: mp[best], pieces: mp.length, droppedAreaM2: total - bestArea, removed: [] }
}

function translate(poly: MetricPolygon, dx: number, dy: number): MetricPolygon {
  return poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as [number, number]))
}

const CIRCLE_SEGMENTS = 24
/** Sampling phases and strip shortenings (metres) tried in turn when polygon-clipping hits a degenerate configuration. */
const PHASES = [Math.PI / CIRCLE_SEGMENTS, Math.PI / CIRCLE_SEGMENTS / 3, Math.PI / CIRCLE_SEGMENTS / 7, 0.011]
const SHORTENS = [0.001, 0.0023, 0.0007, 0.0041]
const ATTEMPTS: Array<[number, number]> = SHORTENS.flatMap((sh) => PHASES.map((ph): [number, number] => [ph, sh]))

/**
 * Erodes `poly` by `distances[i]` along outer-ring edge i (edge i runs from
 * vertex i to vertex i+1). A single number applies to every edge. Edges with a
 * non-positive distance are left alone. Holes in the input are preserved as-is.
 *
 * Implementation: subtract one rectangle per edge plus one circle per vertex
 * (radius = the larger of the two adjacent distances). Work is done about a local
 * origin to keep floating-point noise small for the boolean operations.
 */
export function erodePolygon(poly: MetricPolygon, distances: number | number[], _capSegments = 12): ErodeResult {
  if (poly.length === 0 || poly[0].length < 3) return { polygon: null, pieces: 0, droppedAreaM2: 0, removed: [] }
  const outer = dropClosingPoint(poly[0]) as MetricRing
  const n = outer.length
  const ds = typeof distances === 'number' ? new Array<number>(n).fill(distances) : distances
  if (ds.length !== n) throw new Error(`erodePolygon: ${ds.length} distances for ${n} edges`)
  if (!ds.some((d) => d > 0)) return { polygon: poly, pieces: 1, droppedAreaM2: 0, removed: [] }

  const ox = outer[0][0]
  const oy = outer[0][1]
  const local = translate(poly, -ox, -oy)
  const localOuter = local[0]

  let lastError: unknown = null
  for (const [phase, shorten] of ATTEMPTS) {
    const clips: MetricPolygon[] = []
    for (let i = 0; i < n; i++) {
      const d = ds[i]
      if (d > 0) {
        const strip = edgeStrip(localOuter[i], localOuter[(i + 1) % n], d, shorten)
        if (strip.length === 4) clips.push([strip])
      }
      const r = Math.max(ds[(i - 1 + n) % n], ds[i])
      if (r > 0) clips.push([circle(localOuter[i], r, CIRCLE_SEGMENTS, phase)])
    }
    try {
      const result = pc.difference(local, ...clips)
      const best = largestPiece(result)
      // Removed band = plot ∩ union(clips): only crossing edges, so it is robust where
      // (plot - result) would have near-coincident boundaries.
      let removed: MetricMultiPolygon = []
      try {
        removed = pc.intersection(local, pc.union(clips[0], ...clips.slice(1))).map((p) => translate(p, ox, oy))
      } catch {
        removed = []
      }
      return best.polygon ? { ...best, polygon: translate(best.polygon, ox, oy), removed } : { ...best, removed }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('erodePolygon: boolean operation failed')
}

/**
 * Finds the uniform inward offset d (by bisection) such that the eroded polygon's
 * area is `targetAreaM2` (within `toleranceM2`). Returns the polygon and d.
 */
export function erodeToArea(
  poly: MetricPolygon,
  targetAreaM2: number,
  toleranceM2 = 0.25,
): { polygon: MetricPolygon | null; offsetM: number } {
  const start = polygonArea(poly)
  if (targetAreaM2 >= start) return { polygon: poly, offsetM: 0 }
  if (targetAreaM2 <= 0) return { polygon: null, offsetM: Infinity }
  let lo = 0
  // A square of the same area has half-side sqrt(A)/2; eroding by that empties it. Any polygon
  // of area A empties by at most sqrt(A) (generous upper bound).
  let hi = Math.sqrt(start)
  let best: MetricPolygon | null = poly
  let bestD = 0
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const r = erodePolygon(poly, mid)
    const a = r.polygon ? polygonArea(r.polygon) : 0
    if (a > targetAreaM2) {
      lo = mid
      best = r.polygon
      bestD = mid
      if (a - targetAreaM2 <= toleranceM2) break
    } else {
      hi = mid
      if (r.polygon && targetAreaM2 - a <= toleranceM2) {
        best = r.polygon
        bestD = mid
        break
      }
    }
  }
  return { polygon: best, offsetM: bestD }
}

/** a minus b (both may be null), as a multipolygon for rendering bands. */
export function polygonDifference(a: MetricPolygon | null, b: MetricPolygon | null): MetricMultiPolygon {
  if (!a) return []
  if (!b) return [a]
  if (a === b) return []
  const ox = a[0][0][0]
  const oy = a[0][0][1]
  try {
    const out = pc.difference(translate(a, -ox, -oy), translate(b, -ox, -oy))
    return out.map((p) => translate(p, ox, oy))
  } catch {
    // Render-only geometry: never let a degenerate boolean operation break the pipeline.
    return []
  }
}

export function polygonIntersectionArea(a: MetricPolygon, b: MetricPolygon): number {
  const ox = a[0][0][0]
  const oy = a[0][0][1]
  return multiPolygonArea(pc.intersection(translate(a, -ox, -oy), translate(b, -ox, -oy)))
}

/** Closed GeoJSON-style rings for a metric polygon. */
export function closePolygon(poly: MetricPolygon): Position[][] {
  return poly.map((r) => closeRing(r))
}
