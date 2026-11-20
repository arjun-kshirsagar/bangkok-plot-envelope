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
import { closeRing, dropClosingPoint, ringArea, ringPerimeter, signedRingArea } from './geometry'

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
export function edgeStrip(a: [number, number], b: [number, number], d: number, shortenA = 0, shortenB = shortenA): MetricRing {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0 || d <= 0) return []
  const safe = len > 4 * (Math.abs(shortenA) + Math.abs(shortenB))
  const sA = safe ? shortenA : 0
  const sB = safe ? shortenB : 0
  const ux = dx / len
  const uy = dy / len
  const a2: [number, number] = [a[0] + ux * sA, a[1] + uy * sA]
  const b2: [number, number] = [b[0] - ux * sB, b[1] - uy * sB]
  const nx = -uy * d
  const ny = ux * d
  return [
    [a2[0] + nx, a2[1] + ny],
    [b2[0] + nx, b2[1] + ny],
    [b2[0] - nx, b2[1] - ny],
    [a2[0] - nx, a2[1] - ny],
  ]
}

const CIRCLE_SEGMENTS = 12

/**
 * Polygon circumscribing the circle of radius d around c (so every point of the true
 * disk is removed; conservative), sampled with a phase offset so vertices avoid
 * axis-aligned corners.
 */
export function circle(c: [number, number], d: number, segments = CIRCLE_SEGMENTS, phase = Math.PI / segments): MetricRing {
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
}

/** Keeps the largest polygon of a multipolygon. */
export function largestPiece(mp: MetricMultiPolygon): ErodeResult {
  if (mp.length === 0) return { polygon: null, pieces: 0, droppedAreaM2: 0 }
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
  if (bestArea < 1e-6) return { polygon: null, pieces: 0, droppedAreaM2: 0 }
  return { polygon: mp[best], pieces: mp.length, droppedAreaM2: total - bestArea }
}

function translate(poly: MetricPolygon, dx: number, dy: number): MetricPolygon {
  return poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as [number, number]))
}

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
export interface ErodeOptions {
  /** Reserved for future tuning; erosion no longer computes render bands (see `bandPolygon`). */
  withRemoved?: boolean
}

export function erodePolygon(poly: MetricPolygon, distances: number | number[], _options: ErodeOptions = {}): ErodeResult {
  if (poly.length === 0 || poly[0].length < 3) return { polygon: null, pieces: 0, droppedAreaM2: 0 }
  const outer = dropClosingPoint(poly[0]) as MetricRing
  const n = outer.length
  const ds = typeof distances === 'number' ? new Array<number>(n).fill(distances) : distances
  if (ds.length !== n) throw new Error(`erodePolygon: ${ds.length} distances for ${n} edges`)
  if (!ds.some((d) => d > 0)) return { polygon: poly, pieces: 1, droppedAreaM2: 0 }

  const ox = outer[0][0]
  const oy = outer[0][1]
  const local = translate(poly, -ox, -oy)
  const localOuter = local[0]

  // A vertex needs a circle only where the two strips do not already cover the corner:
  // reflex (inward-turning) and collinear vertices, and corners between unequal distances. At convex corners the strips are
  // extended a hair past the vertex instead, which keeps their end sides from crossing
  // exactly at the vertex.
  const orientation = Math.sign(signedRingArea(localOuter)) || 1
  const needsCircle: boolean[] = new Array<boolean>(n)
  for (let i = 0; i < n; i++) {
    const p = localOuter[(i - 1 + n) % n]
    const v = localOuter[i]
    const q = localOuter[(i + 1) % n]
    const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0])
    const lenA = Math.hypot(v[0] - p[0], v[1] - p[1])
    const lenB = Math.hypot(q[0] - v[0], q[1] - v[1])
    const sinTurn = lenA > 0 && lenB > 0 ? cross / (lenA * lenB) : 0
    // At a convex corner the two strips cover every point within d of the vertex only when both
    // adjacent distances are equal; with unequal ones the larger disc pokes past the smaller strip.
    needsCircle[i] = sinTurn * orientation < 1e-3 || Math.abs(ds[(i - 1 + n) % n] - ds[i]) > 1e-9
  }

  let lastError: unknown = null
  for (const [phase, shorten] of ATTEMPTS) {
    const clips: MetricPolygon[] = []
    for (let i = 0; i < n; i++) {
      const d = ds[i]
      const j = (i + 1) % n
      if (d > 0) {
        const strip = edgeStrip(localOuter[i], localOuter[j], d, needsCircle[i] ? shorten : -shorten, needsCircle[j] ? shorten : -shorten)
        if (strip.length === 4) clips.push([strip])
      }
      const r = Math.max(ds[(i - 1 + n) % n], ds[i])
      if (r > 0 && needsCircle[i]) clips.push([circle(localOuter[i], r, CIRCLE_SEGMENTS, phase)])
    }
    try {
      const result = pc.difference(local, ...clips)
      const best = largestPiece(result)
      return best.polygon ? { ...best, polygon: translate(best.polygon, ox, oy) } : best
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('erodePolygon: boolean operation failed')
}

export interface ErodeToAreaResult {
  polygon: MetricPolygon | null
  /** Extra uniform offset added to every base distance. */
  offsetM: number
  areaM2: number
  iterations: number
}

/**
 * Finds the extra uniform inward offset s such that eroding `source` by
 * `baseDistances[i] + s` on every edge gives an area of `targetAreaM2` (within
 * `toleranceM2`, erring on the small side). Erosion composes, so this always
 * erodes the ORIGINAL polygon (plot-sized vertex count) instead of re-eroding an
 * already rounded footprint. The search is bracketed from the first-order estimate
 * s0 = (A - target) / perimeter and solved by regula falsi (Illinois), normally
 * 3-6 erosions.
 *
 * `incremental`: every probe after the first erodes the lower bracket's polygon (which is
 * always non-empty and larger than the target) by the remaining uniform distance instead of
 * eroding the source again. Erosion composes, and arcs are circumscribed, so the result is a
 * (very slightly conservative) subset of the direct erosion; on a many-vertex concave source
 * this is several times faster because the eroded polygon is nearly convex and needs few clips.
 */
export function erodeToArea(
  source: MetricPolygon,
  baseDistances: number | number[],
  targetAreaM2: number,
  toleranceM2 = 0.5,
  maxIterations = 15,
  incremental = false,
  /** Custom erosion at extra offset s (e.g. a memoised or clipped one); defaults to eroding `source`. */
  eroder?: (s: number) => MetricPolygon | null,
): ErodeToAreaResult {
  const n = dropClosingPoint(source[0]).length
  const base = typeof baseDistances === 'number' ? new Array<number>(n).fill(baseDistances) : baseDistances
  // Lower-bracket polygon (offset loS) that incremental probes start from.
  let loS = 0
  let loPoly: MetricPolygon | null = null
  const at = (s: number): { polygon: MetricPolygon | null; area: number } => {
    const r =
      incremental && loPoly && loS > 0 && s > loS
        ? erodePolygon([loPoly[0]], s - loS, { withRemoved: false })
        : eroder
          ? { polygon: eroder(s) }
          : erodePolygon(source, base.map((d) => d + s), { withRemoved: false })
    return { polygon: r.polygon, area: r.polygon ? polygonArea(r.polygon) : 0 }
  }
  const raiseLo = (s: number, poly: MetricPolygon | null) => {
    if (poly && s >= loS) {
      loS = s
      loPoly = poly
    }
  }
  let iterations = 0
  const start = at(0)
  iterations++
  if (!start.polygon || targetAreaM2 >= start.area) return { polygon: start.polygon, offsetM: 0, areaM2: start.area, iterations }
  if (targetAreaM2 <= 0) return { polygon: null, offsetM: Infinity, areaM2: 0, iterations }

  raiseLo(0, start.polygon)
  const perimeter = Math.max(1e-6, ringPerimeter(start.polygon[0]))
  const s0 = (start.area - targetAreaM2) / perimeter
  let lo = 0
  let fLo = start.area - targetAreaM2 // > 0
  let hi = Math.max(1.5 * s0, 0.05)
  let probe = at(hi)
  iterations++
  let fHi = probe.area - targetAreaM2
  let doublings = 0
  while (fHi > 0 && doublings < 8) {
    raiseLo(hi, probe.polygon)
    lo = hi
    fLo = fHi
    hi *= 2
    probe = at(hi)
    iterations++
    fHi = probe.area - targetAreaM2
    doublings++
  }
  let best: { polygon: MetricPolygon | null; area: number; s: number } = { polygon: probe.polygon, area: probe.area, s: hi }
  if (fHi > 0) return { polygon: best.polygon, offsetM: best.s, areaM2: best.area, iterations }
  if (-fHi <= toleranceM2) return { polygon: best.polygon, offsetM: best.s, areaM2: best.area, iterations }

  // Illinois regula falsi on f(s) = area(s) - target, keeping the bracket [lo, hi] with fLo > 0 > fHi.
  let side = 0
  for (let i = 0; i < maxIterations; i++) {
    const s = (lo * fHi - hi * fLo) / (fHi - fLo)
    const r = at(s)
    iterations++
    const f = r.area - targetAreaM2
    if (f <= 0 && (best.area < targetAreaM2 - toleranceM2 || r.area > best.area || best.area > targetAreaM2)) {
      best = { polygon: r.polygon, area: r.area, s }
    }
    if (Math.abs(f) <= toleranceM2 && f <= 0) return { polygon: r.polygon, offsetM: s, areaM2: r.area, iterations }
    if (f > 0) {
      raiseLo(s, r.polygon)
      lo = s
      fLo = f
      if (side === -1) fHi /= 2
      side = -1
    } else {
      hi = s
      fHi = f
      if (side === 1) fLo /= 2
      side = 1
    }
    if (hi - lo < 1e-4) break
  }
  // Fall back to the smallest-area-at-or-under-target seen, else the hi bracket end.
  if (best.area > targetAreaM2 + toleranceM2) {
    const r = at(hi)
    iterations++
    best = { polygon: r.polygon, area: r.area, s: hi }
  }
  return { polygon: best.polygon, offsetM: best.s, areaM2: best.area, iterations }
}

/**
 * Render band between an outer polygon and the polygon eroded from it, as a polygon
 * with a hole (outer ring + inner ring). No boolean operation is needed because the
 * inner polygon is, by construction, inside the outer one. Null inner = whole outer.
 */
export function bandPolygon(outer: MetricPolygon | null, inner: MetricPolygon | null): MetricMultiPolygon {
  if (!outer) return []
  if (!inner) return [[outer[0]]]
  if (outer[0] === inner[0]) return []
  return [[outer[0], inner[0]]]
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

/** a intersect b (computed about a local origin), as a multipolygon. */
export function polygonIntersection(a: MetricPolygon, b: MetricPolygon): MetricMultiPolygon {
  const ox = a[0][0][0]
  const oy = a[0][0][1]
  return pc.intersection(translate(a, -ox, -oy), translate(b, -ox, -oy)).map((p) => translate(p, ox, oy))
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
