import { describe, expect, it } from 'vitest'
import { buildingHeightFromTags, parseCountTag, parseLengthTag, roadWidthFromTags } from './osm'

describe('OSM tag parsing', () => {
  it('parses lengths with and without units', () => {
    expect(parseLengthTag('25')).toBe(25)
    expect(parseLengthTag('25 m')).toBe(25)
    expect(parseLengthTag('25.5m')).toBe(25.5)
    expect(parseLengthTag('10 ft')).toBeCloseTo(3.048, 3)
    expect(parseLengthTag('tall')).toBeNull()
    expect(parseLengthTag(undefined)).toBeNull()
  })

  it('parses counts', () => {
    expect(parseCountTag('3')).toBe(3)
    expect(parseCountTag('2;3')).toBe(2)
    expect(parseCountTag('x')).toBeNull()
  })

  it('derives building height: height, else levels x 3.5, else 12', () => {
    expect(buildingHeightFromTags({ height: '40 m', 'building:levels': '3' })).toEqual({ heightM: 40, source: 'height' })
    expect(buildingHeightFromTags({ 'building:levels': '4' })).toEqual({ heightM: 14, source: 'levels' })
    expect(buildingHeightFromTags({})).toEqual({ heightM: 12, source: 'default' })
  })

  it('derives road width: width, else lanes x 3.5, else null', () => {
    expect(roadWidthFromTags({ width: '18', lanes: '2' })).toEqual({ widthM: 18, source: 'width' })
    expect(roadWidthFromTags({ lanes: '4' })).toEqual({ widthM: 14, source: 'lanes' })
    expect(roadWidthFromTags({ highway: 'residential' })).toBeNull()
  })
})
