import { describe, expect, it } from 'vitest'
import { erodePolygon, erodeToArea, polygonArea, polygonIntersectionArea, type MetricPolygon, type MetricRing } from './offset'
import { pointToSegmentDistance } from './geometry'

const X0 = 668_000
const Y0 = 1_519_000

function poly(pts: [number, number][]): MetricPolygon {
  return [pts.map(([x, y]) => [X0 + x, Y0 + y] as [number, number])]
}

const RECT = poly([
  [0, 0],
  [40, 0],
  [40, 40],
  [0, 40],
])

const L_SHAPE = poly([
  [0, 0],
  [40, 0],
  [40, 15],
  [20, 15],
  [20, 30],
  [0, 30],
])

/** Concave 7-gon with a deep notch. */
const SEVEN = poly([
  [0, 0],
  [50, 0],
  [50, 20],
  [35, 20],
  [35, 8],
  [20, 8],
  [20, 35],
])

const SLIVER = poly([
  [0, 0],
  [60, 0],
  [60, 10],
  [0, 10],
])

function minDistanceToBoundary(point: [number, number], ring: MetricRing): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, pointToSegmentDistance(point, ring[i], ring[(i + 1) % ring.length]))
  }
  return best
}

function assertEveryVertexAtLeast(result: MetricPolygon, source: MetricPolygon, d: number) {
  for (const v of result[0]) expect(minDistanceToBoundary(v, source[0])).toBeGreaterThanOrEqual(d - 1e-6)
}

describe('erodePolygon', () => {
  it('rectangle with 6 m all round gives the exact 28 x 28 m core', () => {
    const r = erodePolygon(RECT, 6)
    expect(r.polygon).not.toBeNull()
    expect(polygonArea(r.polygon!)).toBeCloseTo(784, 3)
    expect(r.pieces).toBe(1)
  })

  it('rectangle with per-edge distances (front 1.2 m, others 3 m) gives 34 x 35.8 m', () => {
    const r = erodePolygon(RECT, [1.2, 3, 3, 3])
    expect(polygonArea(r.polygon!)).toBeCloseTo(34 * 35.8, 2)
  })

  it('edges with zero distance are left alone', () => {
    const r = erodePolygon(RECT, [5, 0, 0, 0])
    expect(polygonArea(r.polygon!)).toBeCloseTo(40 * 35, 3)
  })

  it('L-shape: mitred rectilinear area plus the corner the distance rule gives back', () => {
    const d = 3
    const r = erodePolygon(L_SHAPE, d)
    // Mitred (CAD) erosion: [3,37]x[3,12] + [3,17]x[3,27] - overlap [3,17]x[3,12] = 306 + 336 - 126 = 516.
    // The distance rule only removes the quarter disk of radius d around the reflex vertex, so the
    // d x d square at that corner is buildable except for the quarter disk: + d^2 (1 - pi/4).
    const expected = 516 + d * d * (1 - Math.PI / 4)
    expect(Math.abs(polygonArea(r.polygon!) - expected)).toBeLessThan(0.2)
    expect(polygonArea(r.polygon!)).toBeGreaterThan(516)
    assertEveryVertexAtLeast(r.polygon!, L_SHAPE, d)
    expect(polygonIntersectionArea(r.polygon!, L_SHAPE)).toBeCloseTo(polygonArea(r.polygon!), 3)
  })

  it('concave 7-gon stays inside the plot and clear of every edge', () => {
    const d = 4
    const r = erodePolygon(SEVEN, d)
    expect(r.polygon).not.toBeNull()
    const a = polygonArea(r.polygon!)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(polygonArea(SEVEN))
    assertEveryVertexAtLeast(r.polygon!, SEVEN, d)
    expect(polygonIntersectionArea(r.polygon!, SEVEN)).toBeCloseTo(a, 3)
  })

  it('a sliver narrower than twice the setback vanishes', () => {
    const r = erodePolygon(SLIVER, 6)
    expect(r.polygon).toBeNull()
    expect(r.pieces).toBe(0)
  })

  it('keeps the largest piece when the erosion splits the plot', () => {
    // Dumbbell: two 30 x 30 squares joined by a 10 m wide neck.
    const dumbbell = poly([
      [0, 0],
      [30, 0],
      [30, 10],
      [50, 10],
      [50, 0],
      [80, 0],
      [80, 30],
      [50, 30],
      [50, 20],
      [30, 20],
      [30, 30],
      [0, 30],
    ])
    const r = erodePolygon(dumbbell, 6)
    expect(r.pieces).toBe(2)
    // Each square erodes to 18 x 18 = 324 plus the lens at the neck mouth that stays >= 6 m from both
    // neck corners: integral_{sqrt(11)}^{6} (10 - 2 sqrt(36 - u^2)) du = 7.95 m2.
    const expected = 324 + 7.95
    expect(Math.abs(polygonArea(r.polygon!) - expected)).toBeLessThan(1)
    expect(Math.abs(r.droppedAreaM2 - expected)).toBeLessThan(1)
  })
})

describe('erodeToArea', () => {
  it('finds the uniform offset that hits a target area', () => {
    const target = 0.7 * 1600
    const r = erodeToArea(RECT, target)
    expect(r.polygon).not.toBeNull()
    expect(polygonArea(r.polygon!)).toBeCloseTo(target, 0)
    // 40 - 2d = sqrt(1120) -> d ~ 3.27
    expect(r.offsetM).toBeCloseTo((40 - Math.sqrt(target)) / 2, 2)
  })

  it('returns the input unchanged when it is already small enough', () => {
    expect(erodeToArea(RECT, 2000).offsetM).toBe(0)
  })
})
