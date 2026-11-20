/**
 * BMA-BL-2544 ข้อ 53 "fronting the public way" geometry. Pure module.
 *
 * The building line facing the road is the sum of the footprint's outer-ring edges that
 * (a) face the road: outward normal within `maxAngleDeg` (default 30 deg) of the front
 * edge's outward normal, and (b) have their midpoint within `maxDistM` of the front edge
 * line. Summing every such edge (instead of only the edges at the nearest distance) keeps
 * jagged or stepped footprints from collapsing to one short edge.
 */
import type { Position } from 'geojson'
import { dropClosingPoint, pointToSegmentDistance, ringPerimeter, ringToSegmentDistance, signedRingArea, segmentLength } from './geometry'
import { openCorridorSpace } from './offset'
import { ruleNumber } from '../rules/loadRules'
import type { ZoneRules } from '../rules/types'

export interface FrontageResult {
  /** Shortest distance from the footprint to the front (road) edge segment, metres. */
  distanceM: number
  /** Total length of road-facing footprint edges, metres. */
  lineM: number
  /** Outer perimeter of the footprint, metres. */
  perimeterM: number
}

export function frontage(
  outerRing: Position[],
  front: [Position, Position],
  maxDistM: number,
  maxAngleDeg = 30,
): FrontageResult {
  const ring = dropClosingPoint(outerRing)
  const distanceM = ringToSegmentDistance(ring, front[0], front[1])
  const perimeterM = ringPerimeter(ring)
  const [a, b] = front
  const fl = segmentLength(a, b)
  if (fl === 0 || ring.length < 3) return { distanceM, lineM: 0, perimeterM }
  // Unit normal of the front edge pointing away from the footprint (towards the road).
  let nx = -(b[1] - a[1]) / fl
  let ny = (b[0] - a[0]) / fl
  let cx = 0
  let cy = 0
  for (const p of ring) {
    cx += p[0]
    cy += p[1]
  }
  cx /= ring.length
  cy /= ring.length
  if ((cx - a[0]) * nx + (cy - a[1]) * ny > 0) {
    nx = -nx
    ny = -ny
  }
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180)
  const ccw = signedRingArea(ring) > 0
  let lineM = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const len = segmentLength(p, q)
    if (len === 0) continue
    // Outward normal of a ring edge: right-hand normal for CCW rings, left-hand for CW.
    const ex = (q[0] - p[0]) / len
    const ey = (q[1] - p[1]) / len
    const ox = ccw ? ey : -ey
    const oy = ccw ? -ex : ex
    if (ox * nx + oy * ny < cosMax) continue
    const mx = (p[0] + q[0]) / 2
    const my = (p[1] + q[1]) / 2
    // Distance of the midpoint from the front edge LINE (positive on the plot side).
    const d = -((mx - a[0]) * nx + (my - a[1]) * ny)
    if (d <= maxDistM) lineM += len
  }
  return { distanceM, lineM, perimeterM }
}

/** True when the footprint counts as fronting the public way: line > fraction x perimeter and distance <= maxDist. */
export function isFronting(fr: FrontageResult, minFractionOfPerimeter: number, maxDistM: number): boolean {
  return fr.lineM > minFractionOfPerimeter * fr.perimeterM && fr.distanceM <= maxDistM + 1e-6
}

/** ข้อ 52(6) / 53 numbers from the rules JSON (bma-frontage). */
export interface FrontageParams {
  triggerStoreys: number
  triggerHeightM: number
  exemptStoreys: number
  minFraction: number
  maxDistM: number
  frontOpenM: number
  frontOpenTallM: number
  tierStoreys: number
  openFraction: number
  /** Internal road joining the front open space to the public way, minimum width (m). */
  internalRoadM: number
}

export function frontageParams(rules: ZoneRules): FrontageParams {
  const n = (k: string) => ruleNumber(rules, 'bma-frontage', k)
  return {
    triggerStoreys: n('triggerStoreys'),
    triggerHeightM: n('triggerHeightM'),
    exemptStoreys: n('exemptResidentialMaxStoreys'),
    minFraction: n('frontingLineMinFractionOfPerimeter'),
    maxDistM: n('frontingLineMaxDistanceFromWayM'),
    frontOpenM: n('frontOpenSpaceM'),
    frontOpenTallM: n('frontOpenSpaceIfGt3StoreysM'),
    tierStoreys: n('frontOpenSpaceTierStoreys'),
    openFraction: n('frontOpenContinuousFractionOfPerimeter'),
    internalRoadM: n('internalRoadMinM'),
  }
}

/** True when ข้อ 52(6) / 53 applies at all: > 2 storeys or > 8 m, and not residential <= 3 storeys. */
export function frontageApplies(p: FrontageParams, floors: number, heightM: number): boolean {
  return (floors > p.triggerStoreys || heightM > p.triggerHeightM + 1e-6) && floors > p.exemptStoreys
}

export interface OpenSpaceResult {
  /** Required depth of the front open space: 6 m, 12 m above 3 storeys. */
  needDepthM: number
  /** Longest continuous run of open band (front face plus connected sides) along the building, m. */
  bandM: number
  /** Required run: 1/6 of the building's outer perimeter. */
  needBandM: number
  /** The band reaches the public way through open plot at least 6 m wide. */
  connected: boolean
  /** How it connects, for the panel: 'directly' or 'through a >= 6 m corridor'. */
  connection: string
  pass: boolean
}

export interface FrontageVerdict {
  fr: FrontageResult
  /** ข้อ 53: the building fronts the public way. */
  fronting: boolean
  /** ข้อ 52(6): front open space (null when the building fronts the way and it was not needed). */
  open: OpenSpaceResult | null
  needDepthM: number
  pass: boolean
}

function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Search / sampling parameters of the open-space test (engineering choices, not rule values). */
const BAND_STEP_M = 0.5
const CORRIDOR_HALF_WIDTH_M = 2.95 // corridor test radius: a >= 6 m wide internal road, 5 cm float slack
const ROAD_CORRIDOR_M = 6 // default only; callers pass rules JSON bma-frontage.internalRoadMinM

/**
 * BMA-BL-2544 ข้อ 52(6) front open space for a building that does not front the public way.
 * (a) Band: at every sample (every 0.5 m) along the building's outer ring, the strip running
 *     outward from the face to `needDepthM` must lie in the plot and outside the building
 *     (checked at 0.3 m, every 1 m and at the full depth).
 * (b) The longest continuous run of such samples (front face plus connected side bands; the
 *     clause allows side open space joined to the front to count) must include a face that
 *     looks towards the road and be >= 1/6 of the outer perimeter.
 * (c) The band must reach the public way through open plot at least `corridorM` wide: directly,
 *     when >= corridorM of the run has a clear straight path to the front edge, or else through the
 *     corridor space (plot eroded by half the width, minus the building dilated by it).
 */
export function openSpaceRoute(
  footprintOuter: Position[],
  plotOuter: Position[],
  front: [Position, Position],
  needDepthM: number,
  openFraction: number,
  corridorM = ROAD_CORRIDOR_M,
): OpenSpaceResult {
  const F = dropClosingPoint(footprintOuter)
  const P = dropClosingPoint(plotOuter)
  const perimeter = ringPerimeter(F)
  const needBandM = openFraction * perimeter
  const fail = (bandM: number): OpenSpaceResult => ({ needDepthM, bandM, needBandM, connected: false, connection: 'not connected', pass: false })
  if (F.length < 3) return fail(0)
  const [a, b] = front
  const fl = segmentLength(a, b)
  // Road-facing unit normal of the front edge (away from the plot interior).
  let nfx = -(b[1] - a[1]) / fl
  let nfy = (b[0] - a[0]) / fl
  let cx = 0
  let cy = 0
  for (const q of P) {
    cx += q[0] / P.length
    cy += q[1] / P.length
  }
  if ((cx - a[0]) * nfx + (cy - a[1]) * nfy > 0) {
    nfx = -nfx
    nfy = -nfy
  }
  const ccw = signedRingArea(F) > 0
  const open = (q: Position) => pointInRing(q, P) && !pointInRing(q, F)
  const depths: number[] = [0.3]
  for (let d = 1; d < needDepthM - 0.05; d += 1) depths.push(d)
  depths.push(needDepthM - 0.05)

  interface Sample { x: number; y: number; nx: number; ny: number; ok: boolean; facing: boolean; len: number }
  const samples: Sample[] = []
  for (let i = 0; i < F.length; i++) {
    const p = F[i]
    const q = F[(i + 1) % F.length]
    const len = segmentLength(p, q)
    if (len === 0) continue
    const ex = (q[0] - p[0]) / len
    const ey = (q[1] - p[1]) / len
    const nx = ccw ? ey : -ey
    const ny = ccw ? -ex : ex
    const k = Math.max(1, Math.round(len / BAND_STEP_M))
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k
      const x = p[0] + (q[0] - p[0]) * t
      const y = p[1] + (q[1] - p[1]) * t
      const ok = depths.every((d) => open([x + nx * d, y + ny * d]))
      samples.push({ x, y, nx, ny, ok, facing: nx * nfx + ny * nfy > 0.5, len: len / k })
    }
  }
  // Longest circular run of ok samples that contains a road-facing sample.
  const n = samples.length
  let best: Sample[] = []
  const start = samples.findIndex((s) => !s.ok)
  if (start === -1) best = samples
  else {
    let run: Sample[] = []
    for (let k = 1; k <= n; k++) {
      const s = samples[(start + k) % n]
      if (s.ok) run.push(s)
      if (!s.ok || k === n) {
        if (run.some((r) => r.facing) && run.reduce((t, r) => t + r.len, 0) > best.reduce((t, r) => t + r.len, 0)) best = run
        run = []
      }
    }
  }
  const bandM = best.reduce((t, r) => t + r.len, 0)
  if (bandM < needBandM - 1e-6) return fail(bandM)

  // (c) Direct: rays from facing band samples straight to the front edge through open plot.
  const rayHitsFront = (s: Sample): boolean => {
    // Ray s + t * nf against segment a + u * (b - a): cross-product solution.
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const den = nfx * ey - nfy * ex
    if (Math.abs(den) < 1e-9) return false
    const wx = a[0] - s.x
    const wy = a[1] - s.y
    const t = (wx * ey - wy * ex) / den
    const u = (wx * nfy - wy * nfx) / den
    if (!(t > 0) || u < 0 || u > 1) return false
    for (let d = 0.3; d < t - 0.3; d += 1) if (!open([s.x + nfx * d, s.y + nfy * d])) return false
    return true
  }
  let clear = 0
  let longestClear = 0
  for (const s of best) {
    if (s.facing && rayHitsFront(s)) {
      clear += s.len
      longestClear = Math.max(longestClear, clear)
    } else clear = 0
  }
  if (longestClear >= corridorM - 1e-6) return { needDepthM, bandM, needBandM, connected: true, connection: `by a straight open path at least ${corridorM} m wide to the road edge`, pass: true }

  // (c) Corridor: the band's middle (needDepth / 2 out from a facing face) and the front edge in one component.
  const mid = best.filter((s) => s.facing)[Math.floor(best.filter((s) => s.facing).length / 2)]
  if (!mid) return fail(bandM)
  const half = CORRIDOR_HALF_WIDTH_M * (corridorM / ROAD_CORRIDOR_M)
  const centre: Position = [mid.x + mid.nx * Math.max(half, needDepthM / 2), mid.y + mid.ny * Math.max(half, needDepthM / 2)]
  const space = openCorridorSpace([P as [number, number][]], F as [number, number][], half)
  const comp = space.find((poly) => pointInRing(centre, poly[0]) && !poly.slice(1).some((h) => pointInRing(centre, h)))
  const reaches = comp ? comp[0].some((v) => pointToSegmentDistance(v, a, b) <= half + 0.2) : false
  return reaches
    ? { needDepthM, bandM, needBandM, connected: true, connection: `through an open corridor at least ${corridorM} m wide`, pass: true }
    : fail(bandM)
}

/**
 * Verdict for one footprint: ข้อ 53 fronting, else the ข้อ 52(6) front open space (computed
 * only when needed).
 */
export function frontageVerdict(outerRing: Position[], plotRing: Position[], front: [Position, Position], floors: number, p: FrontageParams): FrontageVerdict {
  const fr = frontage(outerRing, front, p.maxDistM)
  const fronting = isFronting(fr, p.minFraction, p.maxDistM)
  const needDepthM = floors > p.tierStoreys ? p.frontOpenTallM : p.frontOpenM
  const open = fronting ? null : openSpaceRoute(outerRing, plotRing, front, needDepthM, p.openFraction, p.internalRoadM)
  return { fr, fronting, open, needDepthM, pass: fronting || Boolean(open?.pass) }
}
