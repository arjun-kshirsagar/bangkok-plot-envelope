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


export const rect = (w: number, h: number): XY[] => [[0, 0], [w, 0], [w, h], [0, h]]

/** Test plots (metric offsets). Edge 0 is the first edge of each list. */
export const SWEEP_PLOTS: Record<string, XY[]> = {
  '40x40': rect(40, 40),
  '70x70': rect(70, 70),
  '100x100': rect(100, 100),
  '25x60': rect(25, 60),
  '15x80 (edge 0 short)': rect(15, 80),
  'concave 10-gon': [[0, 0], [80, 0], [80, 25], [62, 25], [62, 45], [80, 45], [80, 70], [0, 70], [0, 40], [20, 32]],
  'funnel (10 m front)': [[0, 0], [10, 0], [35, 40], [35, 70], [-25, 70], [-25, 40]],
  'flag lot': [[0, 0], [10, 0], [10, 20], [60, 20], [60, 100], [-20, 100], [-20, 20], [0, 20]],
  'C-shape 8': [[0, 0], [60, 0], [60, 15], [20, 15], [20, 45], [60, 45], [60, 60], [0, 60]],
  'C-shape 12': [[0, 0], [80, 0], [80, 20], [30, 20], [25, 25], [25, 45], [30, 50], [80, 50], [80, 70], [0, 70], [-10, 50], [-10, 20]],
}
