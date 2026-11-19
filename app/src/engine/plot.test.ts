import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { nearestEdge, outerRing, plotAreaM2, plotEdges, remapFrontEdge, validatePlot } from './plot'
import { polygonToWgs84, toMetric, toWgs84, type LngLat, type XY } from './projection'

const ORIGIN: LngLat = [100.561, 13.737]

/** Builds a WGS84 polygon from metric offsets (metres east, metres north) around ORIGIN. */
function metricPlot(offsets: XY[]): Polygon {
  const [x0, y0] = toMetric(ORIGIN)
  const ring: XY[] = offsets.map(([dx, dy]) => [x0 + dx, y0 + dy])
  ring.push(ring[0])
  return polygonToWgs84({ type: 'Polygon', coordinates: [ring] })
}

function pointAt(dx: number, dy: number): LngLat {
  const [x0, y0] = toMetric(ORIGIN)
  return toWgs84([x0 + dx, y0 + dy])
}

const RECT = metricPlot([
  [0, 0],
  [40, 0],
  [40, 25],
  [0, 25],
])

describe('plot edges', () => {
  it('has one edge per vertex, with metric lengths and bearings', () => {
    const edges = plotEdges(RECT)
    expect(edges).toHaveLength(4)
    expect(edges[0].lengthM).toBeCloseTo(40, 3)
    expect(edges[1].lengthM).toBeCloseTo(25, 3)
    expect(edges[0].bearingDeg).toBeCloseTo(90, 0)
    expect(edges[1].bearingDeg).toBeCloseTo(0, 0)
    expect(outerRing(RECT)).toHaveLength(4)
  })

  it('computes planar area and ignores the closing point', () => {
    expect(plotAreaM2(RECT)).toBeCloseTo(1000, 2)
  })

  it('finds the nearest edge to a point', () => {
    const southHit = nearestEdge(RECT, pointAt(20, -3))
    expect(southHit?.index).toBe(0)
    expect(southHit?.distanceM).toBeCloseTo(3, 2)
    const westHit = nearestEdge(RECT, pointAt(-2, 12))
    expect(westHit?.index).toBe(3)
  })
})

describe('remapFrontEdge', () => {
  it('keeps the index when the vertex count is unchanged', () => {
    const moved = metricPlot([
      [0, 0],
      [45, 0],
      [45, 25],
      [0, 25],
    ])
    expect(remapFrontEdge(RECT, 2, moved)).toBe(2)
  })

  it('follows the same physical edge when a vertex is inserted before it', () => {
    // Insert a vertex on the south edge; the old north edge (index 2) becomes index 3.
    const withExtra = metricPlot([
      [0, 0],
      [20, 0],
      [40, 0],
      [40, 25],
      [0, 25],
    ])
    expect(remapFrontEdge(RECT, 2, withExtra)).toBe(3)
    expect(remapFrontEdge(RECT, 0, withExtra)).toBe(0)
  })

  it('clears the index when the plot is removed', () => {
    expect(remapFrontEdge(RECT, 1, null)).toBeNull()
    expect(remapFrontEdge(RECT, null, RECT)).toBeNull()
  })
})

describe('validatePlot', () => {
  it('accepts a simple rectangle and a concave L', () => {
    expect(validatePlot(RECT).ok).toBe(true)
    const L = metricPlot([
      [0, 0],
      [40, 0],
      [40, 15],
      [20, 15],
      [20, 30],
      [0, 30],
    ])
    expect(validatePlot(L).ok).toBe(true)
    expect(plotAreaM2(L)).toBeCloseTo(40 * 15 + 20 * 15, 1)
  })

  it('rejects a self-intersecting bow-tie and degenerate rings', () => {
    const bowTie = metricPlot([
      [0, 0],
      [40, 25],
      [40, 0],
      [0, 25],
    ])
    const v = validatePlot(bowTie)
    expect(v.ok).toBe(false)
    expect(validatePlot(null).ok).toBe(false)
    expect(validatePlot(metricPlot([[0, 0], [10, 0]])).ok).toBe(false)
  })
})
