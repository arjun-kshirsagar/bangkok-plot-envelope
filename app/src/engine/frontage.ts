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
import { dropClosingPoint, ringPerimeter, ringToSegmentDistance, signedRingArea, segmentLength } from './geometry'
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
  }
}

/** True when ข้อ 52(6) / 53 applies at all: > 2 storeys or > 8 m, and not residential <= 3 storeys. */
export function frontageApplies(p: FrontageParams, floors: number, heightM: number): boolean {
  return (floors > p.triggerStoreys || heightM > p.triggerHeightM + 1e-6) && floors > p.exemptStoreys
}

export interface FrontageVerdict {
  fr: FrontageResult
  /** ข้อ 53: the building fronts the public way. */
  fronting: boolean
  /** ข้อ 52(6) alternative: front open space of `needDepthM` between the building and the road, over >= 1/6 of the perimeter. */
  openSpaceRoute: boolean
  needDepthM: number
  frontEdgeM: number
  pass: boolean
}

/**
 * Verdict for one footprint. The ข้อ 52(6) route is modelled as: the footprint stays at least
 * the front open-space depth (6 m, 12 m above 3 storeys) from the road edge, and the road edge
 * (the width of that open space) is at least 1/6 of the building's outer perimeter. The 6 m
 * internal road it must connect through is not needed when the open space adjoins the road.
 */
export function frontageVerdict(outerRing: Position[], front: [Position, Position], floors: number, p: FrontageParams): FrontageVerdict {
  const fr = frontage(outerRing, front, p.maxDistM)
  const fronting = isFronting(fr, p.minFraction, p.maxDistM)
  const needDepthM = floors > p.tierStoreys ? p.frontOpenTallM : p.frontOpenM
  const frontEdgeM = segmentLength(front[0], front[1])
  const openSpaceRoute = fr.distanceM >= needDepthM - 0.05 && frontEdgeM >= p.openFraction * fr.perimeterM - 1e-6
  return { fr, fronting, openSpaceRoute, needDepthM, frontEdgeM, pass: fronting || openSpaceRoute }
}
