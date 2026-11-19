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
