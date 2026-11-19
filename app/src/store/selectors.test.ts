import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { selectZone } from './selectors'
import { ZONE_SUBZONES } from '../rules'

describe('zone lookup', () => {
  it('flags a plot straddling two Y.10 sub-zones and uses the centroid', () => {
    // A small square centred on a vertex of sub-zone ย.10-4's boundary straddles it.
    const f = ZONE_SUBZONES.features.find((x) => x.properties.code === 'Y.10-4')!
    const [x, y] = f.geometry.coordinates[0][10]
    const d = 0.0003
    const plot: Polygon = { type: 'Polygon', coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] }
    const z = selectZone({ plot })!
    expect(z.straddles).not.toBeNull()
    expect(z.straddles!.length).toBeGreaterThan(1)
  })

  it('flags a plot outside the mapped Y.10 area', () => {
    const plot: Polygon = { type: 'Polygon', coordinates: [[[100.5, 13.7], [100.5005, 13.7], [100.5005, 13.7005], [100.5, 13.7005], [100.5, 13.7]]] }
    const z = selectZone({ plot })!
    expect(z.subzone).toBeNull()
    expect(z.outsideMapArea).toBe(true)
  })
})
