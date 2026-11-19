import { describe, expect, it } from 'vitest'
import { area as turfArea } from '@turf/turf'
import type { Polygon } from 'geojson'
import { polygonToWgs84, toMetric, toWgs84, type LngLat, type XY } from './projection'
import { plotAreaM2 } from './plot'

const ASOK: LngLat = [100.561, 13.737]

describe('UTM 47N projection', () => {
  it('projects Bangkok into the expected UTM 47N range', () => {
    const [x, y] = toMetric(ASOK)
    expect(x).toBeGreaterThan(600_000)
    expect(x).toBeLessThan(700_000)
    expect(y).toBeGreaterThan(1_500_000)
    expect(y).toBeLessThan(1_540_000)
  })

  it('round-trips WGS84 -> UTM -> WGS84 within 1e-8 degrees', () => {
    const points: LngLat[] = [ASOK, [100.5, 13.75], [100.6, 13.7], [100.55, 13.72]]
    for (const p of points) {
      const back = toWgs84(toMetric(p))
      expect(Math.abs(back[0] - p[0])).toBeLessThan(1e-8)
      expect(Math.abs(back[1] - p[1])).toBeLessThan(1e-8)
    }
  })

  it('a 100 m x 100 m square measures ~10,000 m2 planar and geodesic', () => {
    const [x0, y0] = toMetric(ASOK)
    const squareMetric: XY[] = [
      [x0, y0],
      [x0 + 100, y0],
      [x0 + 100, y0 + 100],
      [x0, y0 + 100],
      [x0, y0],
    ]
    const polyMetric: Polygon = { type: 'Polygon', coordinates: [squareMetric] }
    const polyWgs = polygonToWgs84(polyMetric)

    const planar = plotAreaM2(polyWgs)
    expect(planar).toBeCloseTo(10_000, 3)

    // turf.area uses a spherical earth (R = 6371008.8 m); UTM is ellipsoidal with a
    // grid scale of ~0.9999 here. At Bangkok's latitude the two disagree by ~0.4%,
    // which is why the engine and UI use the planar UTM figure, not turf.
    const geodesic = turfArea({ type: 'Feature', properties: {}, geometry: polyWgs })
    expect(Math.abs(geodesic - 10_000) / 10_000).toBeLessThan(0.005)
    expect(Math.abs(geodesic - planar) / planar).toBeLessThan(0.005)
  })

  it('a 100 m edge is ~100 m long on the ground', () => {
    const [x0, y0] = toMetric(ASOK)
    const a = toWgs84([x0, y0])
    const b = toWgs84([x0 + 100, y0])
    const dLng = ((b[0] - a[0]) * Math.PI) / 180
    const lat = (a[1] * Math.PI) / 180
    const groundM = 6_371_008.8 * Math.cos(lat) * dLng
    expect(Math.abs(groundM - 100)).toBeLessThan(0.5)
  })
})
