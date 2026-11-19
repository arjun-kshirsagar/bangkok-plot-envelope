/**
 * Rule types and the loaded Y.10 rule set. The zone rule JSON is authored by the
 * research track; every number in it carries a `source`.
 */
export type { BuildingType, Regime, ZoneRules, RuleEntry, BuildingTypeRules } from './types'
export { ZONE_RULES, loadRules, getRule, ruleNumber, buildingTypeRules } from './loadRules'
export { ZONE_SUBZONES, ZONE_BBOX, ZONE_CENTER, findSubzone, thaiDigitsToLatin, type SubzoneProps } from './zone'

import type { BuildingType } from './types'

export interface BuildingTypeOption {
  id: BuildingType
  label: string
  description: string
}

export const BUILDING_TYPES: readonly BuildingTypeOption[] = [
  {
    id: 'condo',
    label: 'Condominium (อาคารอยู่อาศัยรวม)',
    description: 'Apartment / condo block. Switches to the MR-33 high-rise regime at 23 m or 10,000 m2.',
  },
  {
    id: 'lowRiseResidential',
    label: 'Low-rise residential (<= 3 storeys)',
    description: 'House / townhouse, max 3 storeys and 10 m. Standard regime only.',
  },
]

export const DEFAULT_BUILDING_TYPE: BuildingType = 'condo'

export function isBuildingType(v: unknown): v is BuildingType {
  return v === 'condo' || v === 'lowRiseResidential'
}

/** A regulation value with its citation. `assumed` marks values not found in a source document. */
export interface SourcedValue<T> {
  value: T
  source: string
  assumed?: boolean
}
