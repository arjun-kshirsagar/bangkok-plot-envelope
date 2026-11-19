/**
 * Types for rules/bangkok-zone.json (authored by the research track; every
 * number there carries a `source`). The loader in loadRules.ts validates the
 * fields the engine depends on.
 */

export type BuildingType = 'condo' | 'lowRiseResidential'
export type Regime = 'standard' | 'highRise'

export interface PerimeterOpenTier {
  heightMaxM: number
  m: number
}

export interface StandardSetbacks {
  boundaryM: number
  boundaryIfHeightLe9mM?: number
  boundaryIfHeightGt9mM?: number
  perimeterOpenByHeight: PerimeterOpenTier[]
  perimeterOpenRule: string
  roadSetbackRule: string
}

export interface HighRiseSetbacks {
  boundaryM: number
  roadM: number
  perimeterOpenM: number
}

export interface BuildingTypeRules {
  label: string
  regime: string
  floorToFloorM: number
  floorToFloorMinM: number
  maxStoreys?: number
  maxHeightM?: number
  openSpacePlotPercentMin: number
  setbacks: {
    standard: StandardSetbacks
    highRise?: HighRiseSetbacks
  }
  notes?: string
}

export interface RuleEntry {
  id: string
  stage: string
  appliesTo: string[]
  regime?: Regime
  informational?: boolean
  params: Record<string, unknown>
  formula: string
  thai?: string
  source: string
  assumed: boolean
}

export interface ZoneRules {
  meta: { generated: string; status: string; units: string; planInForce: string }
  zone: {
    code: string
    thaiCode: string
    name: string
    planDocument: string
    far: number
    osrPercent: number
    permeablePercentOfOpenSpace: number
    approxBounds: { center: [number, number] }
  }
  thresholds: {
    highRiseHeightM: number
    extraLargeGfaM2: number
    largeBuildingGfaM2: number
    mr33RoadTierGfaM2: number
    source: string
  }
  buildingTypes: Record<string, BuildingTypeRules>
  rules: RuleEntry[]
}
