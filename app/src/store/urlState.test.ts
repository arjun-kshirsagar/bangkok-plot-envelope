import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { decodeScene, encodeScene, type UrlScene } from './urlState'

const plot: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [100.5610001, 13.7370001],
      [100.5620002, 13.7370001],
      [100.5620002, 13.7380003],
      [100.5610001, 13.7380003],
      [100.5610001, 13.7370001],
    ],
  ],
}

describe('URL scene state', () => {
  it('round-trips plot, inputs and view through the hash', () => {
    const scene: UrlScene = {
      plot,
      frontEdgeIndex: 2,
      roadWidthM: 16.5,
      buildingType: 'lowRiseResidential',
      view: { zoom: 16.5, lat: 13.737, lng: 100.561, pitch: 55, bearing: -20 },
    }
    const hash = encodeScene(scene)
    expect(hash).toContain('plot=')
    expect(hash).toContain('front=2')
    expect(hash).toContain('type=lowRiseResidential')
    const back = decodeScene(`#${hash}`)
    expect(back.plot).toEqual(plot)
    expect(back.frontEdgeIndex).toBe(2)
    expect(back.roadWidthM).toBe(16.5)
    expect(back.buildingType).toBe('lowRiseResidential')
    expect(back.view).toEqual(scene.view)
  })

  it('ignores garbage and returns an empty scene', () => {
    const back = decodeScene('#plot=abc&front=-1&road=nope&type=castle&view=1/2')
    expect(back.plot).toBeNull()
    expect(back.frontEdgeIndex).toBeNull()
    expect(back.roadWidthM).toBeNull()
    expect(back.buildingType).toBeNull()
    expect(back.view).toBeNull()
  })

  it('encodes nothing for an empty scene', () => {
    expect(encodeScene({ plot: null, frontEdgeIndex: null, roadWidthM: null, buildingType: null, view: null })).toBe('')
  })
})
