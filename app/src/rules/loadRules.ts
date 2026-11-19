import rawRules from './bangkok-zone.json'
import type { BuildingType, BuildingTypeRules, RuleEntry, ZoneRules } from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function assertNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`rules: ${path} must be a number`)
  return v
}

/** Validates the fields the engine depends on and returns the typed rule set. */
export function loadRules(raw: unknown): ZoneRules {
  if (!isRecord(raw) || !isRecord(raw.zone) || !isRecord(raw.thresholds) || !isRecord(raw.buildingTypes) || !Array.isArray(raw.rules)) {
    throw new Error('rules: malformed rules file')
  }
  assertNumber(raw.zone.far, 'zone.far')
  assertNumber(raw.zone.osrPercent, 'zone.osrPercent')
  assertNumber(raw.thresholds.highRiseHeightM, 'thresholds.highRiseHeightM')
  assertNumber(raw.thresholds.extraLargeGfaM2, 'thresholds.extraLargeGfaM2')
  for (const type of ['condo', 'lowRiseResidential'] as const) {
    const bt = raw.buildingTypes[type]
    if (!isRecord(bt) || !isRecord(bt.setbacks) || !isRecord(bt.setbacks.standard)) throw new Error(`rules: buildingTypes.${type} malformed`)
    assertNumber(bt.floorToFloorM, `buildingTypes.${type}.floorToFloorM`)
    assertNumber(bt.openSpacePlotPercentMin, `buildingTypes.${type}.openSpacePlotPercentMin`)
    assertNumber(bt.setbacks.standard.boundaryM, `buildingTypes.${type}.setbacks.standard.boundaryM`)
  }
  for (const r of raw.rules as unknown[]) {
    if (!isRecord(r) || typeof r.id !== 'string' || typeof r.source !== 'string' || !r.source.trim()) {
      throw new Error('rules: every rule needs an id and a source')
    }
  }
  return raw as unknown as ZoneRules
}

export const ZONE_RULES: ZoneRules = loadRules(rawRules)

export function getRule(rules: ZoneRules, id: string): RuleEntry {
  const r = rules.rules.find((x) => x.id === id)
  if (!r) throw new Error(`rules: missing rule ${id}`)
  return r
}

export function ruleNumber(rules: ZoneRules, id: string, key: string): number {
  const v = getRule(rules, id).params[key]
  return assertNumber(v, `${id}.params.${key}`)
}

export function buildingTypeRules(rules: ZoneRules, type: BuildingType): BuildingTypeRules {
  const bt = rules.buildingTypes[type]
  if (!bt) throw new Error(`rules: no building type ${type}`)
  return bt
}
