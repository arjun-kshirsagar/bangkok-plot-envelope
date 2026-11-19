/**
 * Rule types. The zone rule JSON (bangkok-<zone>.json) is authored by the research
 * track; every number in it must carry a `source`. This file only holds shared types.
 */

export type BuildingType = 'condo' | 'lowRiseResidential'

export interface BuildingTypeOption {
  id: BuildingType
  label: string
  description: string
}

export const BUILDING_TYPES: readonly BuildingTypeOption[] = [
  { id: 'condo', label: 'Condominium (high-rise residential)', description: 'Residential building, typically >= 23 m, large-building rules apply.' },
  { id: 'lowRiseResidential', label: 'Low-rise residential', description: 'Residential building under 23 m.' },
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
