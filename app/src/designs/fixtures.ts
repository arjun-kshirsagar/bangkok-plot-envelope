/** Shared test plots (metric offsets around a Sukhumvit origin). Test-only helpers, no app imports. */
import type { Polygon } from 'geojson'
import { polygonToWgs84, toMetric, type LngLat, type XY } from '../engine/projection'

export const ORIGIN: LngLat = [100.5724, 13.7363]

export function metricPlot(offsets: XY[]): Polygon {
  const [x0, y0] = toMetric(ORIGIN)
  const ring: XY[] = offsets.map(([dx, dy]) => [x0 + dx, y0 + dy])
  ring.push(ring[0])
  return polygonToWgs84({ type: 'Polygon', coordinates: [ring] })
}

export function starPoints(n = 60, rOut = 60, rIn = 44): XY[] {
  const pts: XY[] = []
  for (let i = 0; i < n; i++) {
    const ang = (2 * Math.PI * i) / n
    const r = i % 2 === 0 ? rOut : rIn
    pts.push([r * Math.cos(ang), r * Math.sin(ang)])
  }
  return pts
}

