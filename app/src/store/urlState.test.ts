import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { decodeScene, encodeScene, inBangkok, type UrlScene } from './urlState'

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
      floorToFloorM: 3.2,
      view: { zoom: 16.5, lat: 13.737, lng: 100.561, pitch: 55, bearing: 340 },
      design: 'podiumTower',
      designOverrides: { floors: 15, ignoreSetbacks: true },
    }
    const hash = encodeScene(scene)
    expect(hash).toContain('plot=')
    expect(hash).toContain('front=2')
    expect(hash).toContain('type=lowRiseResidential')
    expect(hash).toContain('f2f=3.2')
    const back = decodeScene(`#${hash}`)
    expect(back.plot).toEqual(plot)
    expect(back.frontEdgeIndex).toBe(2)
    expect(back.roadWidthM).toBe(16.5)
    expect(back.buildingType).toBe('lowRiseResidential')
    expect(back.floorToFloorM).toBe(3.2)
    expect(back.view).toEqual(scene.view)
    expect(back.design).toBe('podiumTower')
    expect(back.designOverrides).toEqual({ floors: 15, ignoreSetbacks: true })
  })

  it('ignores garbage and returns an empty scene', () => {
    const back = decodeScene('#plot=abc&front=-1&road=nope&type=castle&f2f=9&view=1/2')
    expect(back.plot).toBeNull()
    expect(back.frontEdgeIndex).toBeNull()
    expect(back.roadWidthM).toBeNull()
    expect(back.buildingType).toBeNull()
    expect(back.floorToFloorM).toBeNull()
    expect(back.view).toBeNull()
    expect(decodeScene('#design=castle&dfl=3').design).toBeNull()
    expect(decodeScene('#road=0.0001').roadWidthM).toBeNull()
    expect(decodeScene('#road=250').roadWidthM).toBeNull()
    expect(decodeScene('#road=1').roadWidthM).toBe(1)
  })

  it('rejects plots outside Bangkok, self-intersecting plots and out-of-range front indices', () => {
    expect(decodeScene('#plot=1,2;3,4;5,6&front=0').plot).toBeNull()
    expect(decodeScene('#plot=1,2;3,4;5,6&front=0').frontEdgeIndex).toBeNull()
    expect(inBangkok(100.56, 13.74)).toBe(true)
    expect(inBangkok(1, 2)).toBe(false)
    // bow-tie
    const bow = decodeScene('#plot=100.561,13.737;100.562,13.738;100.562,13.737;100.561,13.738')
    expect(bow.plot).toBeNull()
    // front index beyond the edge count is dropped but the plot is kept
    const far = decodeScene('#plot=100.561,13.737;100.562,13.737;100.562,13.738;100.561,13.738&front=9')
    expect(far.plot).not.toBeNull()
    expect(far.frontEdgeIndex).toBeNull()
  })

  it('clamps or drops absurd views', () => {
    expect(decodeScene('#view=16/500/100.56/55/0').view).toBeNull()
    const v = decodeScene('#view=99/13.73/100.56/120/-20').view!
    expect(v.zoom).toBe(24)
    expect(v.pitch).toBe(75)
    expect(v.bearing).toBe(340)
  })

  it('encodes nothing for an empty scene', () => {
    expect(encodeScene({ plot: null, frontEdgeIndex: null, roadWidthM: null, buildingType: null, floorToFloorM: null, view: null, design: null, designOverrides: null })).toBe('')
  })
})

describe('worked example link', () => {
  it('is an exact 40 m UTM square: 1,600 m2 plot, 784 m2 footprint, 12 floors, 9,408 m2 GFA (also after re-encoding)', async () => {
    const { WORKED_EXAMPLE_HASH } = await import('../ui/example')
    const { runPipeline } = await import('../engine/pipeline')
    const { ZONE_RULES } = await import('../rules')
    const first = decodeScene(WORKED_EXAMPLE_HASH)
    for (const s of [first, decodeScene(`#${encodeScene({ ...first, view: null, design: null, designOverrides: null } as UrlScene)}`)]) {
      const r = runPipeline({ plot: s.plot!, frontEdgeIndex: s.frontEdgeIndex!, roadWidthM: s.roadWidthM!, buildingType: s.buildingType!, floorToFloorM: 3 }, ZONE_RULES)
      expect(Math.round(r.metric!.plotAreaM2)).toBe(1600)
      expect(Math.round(r.envelope!.footprintAreaM2)).toBe(784)
      expect(r.envelope!.maxFloors).toBe(12)
      expect(Math.round(r.envelope!.gfaM2)).toBe(9408)
    }
  })
})
