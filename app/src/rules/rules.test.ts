import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ZONE_RULES, getRule, ruleNumber } from './loadRules'
import { ZONE_BBOX, ZONE_SUBZONES, findSubzone, thaiDigitsToLatin } from './zone'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// In an app-only checkout (e.g. Vercel with root directory app/) the repo-root files are absent: skip those comparisons.
const hasRoot = (p: string) => existsSync(here(p))

describe('rules files', () => {
  it.skipIf(!hasRoot('../../../rules/bangkok-zone.json'))('app copy of bangkok-zone.json is byte-identical to the repo-root copy', () => {
    const app = readFileSync(here('./bangkok-zone.json'))
    const root = readFileSync(here('../../../rules/bangkok-zone.json'))
    expect(app.equals(root)).toBe(true)
  })

  it.skipIf(!hasRoot('../../../docs/SOURCES.md'))('app copy of docs/SOURCES.md (shown in the sources modal) is byte-identical to the repo-root copy', () => {
    const app = readFileSync(here('./SOURCES.md'))
    const root = readFileSync(here('../../../docs/SOURCES.md'))
    expect(app.equals(root)).toBe(true)
  })

  it.skipIf(!hasRoot('../../../rules/bangkok-zone-y10.geojson'))('app copy of bangkok-zone-y10 (.json, Vite cannot import .geojson) is byte-identical to the repo-root .geojson', () => {
    const app = readFileSync(here('./bangkok-zone-y10.json'))
    const root = readFileSync(here('../../../rules/bangkok-zone-y10.geojson'))
    expect(app.equals(root)).toBe(true)
  })

  it('loads Y.10 with FAR 8 / OSR 4 and every rule sourced', () => {
    expect(ZONE_RULES.zone.code).toBe('Y.10')
    expect(ZONE_RULES.zone.far).toBe(8)
    expect(ZONE_RULES.zone.osrPercent).toBe(4)
    expect(ZONE_RULES.rules.length).toBeGreaterThanOrEqual(20)
    for (const r of ZONE_RULES.rules) expect(r.source.length).toBeGreaterThan(5)
    expect(ruleNumber(ZONE_RULES, 'mr33-clearance', 'fromBoundaryM')).toBe(6)
    expect(getRule(ZONE_RULES, 'mr55-height-road').params.multiplier).toBe(2)
  })
})

describe('zone geometry', () => {
  it('has seven sub-zones with Latin codes and one interior ring', () => {
    expect(ZONE_SUBZONES.features).toHaveLength(7)
    const codes = ZONE_SUBZONES.features.map((f) => f.properties.code).sort()
    expect(codes).toContain('Y.10-4')
    expect(codes).toContain('Y.10-7')
    const withHole = ZONE_SUBZONES.features.find((f) => f.geometry.coordinates.length > 1)
    expect(withHole?.properties.code).toBe('Y.10-7')
    expect(thaiDigitsToLatin('ย.๑๐-๔')).toBe('ย.10-4')
  })

  it('classifies points: inside Y.10-4, outside at Asok, and inside the Y.10-7 hole as outside', () => {
    expect(findSubzone([100.5724, 13.7363])?.code).toBe('Y.10-4')
    expect(findSubzone([100.561, 13.737])).toBeNull()
    const y107 = ZONE_SUBZONES.features.find((f) => f.properties.code === 'Y.10-7')!
    const hole = y107.geometry.coordinates[1]
    const cx = hole.reduce((s, p) => s + p[0], 0) / hole.length
    const cy = hole.reduce((s, p) => s + p[1], 0) / hole.length
    // The hole's vertex-average lies inside the hole for this near-convex ring.
    expect(findSubzone([cx, cy])?.code ?? null).not.toBe('Y.10-7')
    expect(ZONE_BBOX[0]).toBeLessThan(ZONE_BBOX[2])
    expect(ZONE_BBOX[1]).toBeLessThan(ZONE_BBOX[3])
  })
})
