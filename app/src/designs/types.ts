import type { Polygon } from 'geojson'
import type { MetricPolygon } from '../engine/offset'

export type DesignId = 'slab' | 'podiumTower' | 'courtyard'

export const DESIGN_IDS: readonly DesignId[] = ['slab', 'podiumTower', 'courtyard']

export interface Block {
  id: string
  label: string
  /** Metric (UTM 47N) footprint; may carry a hole (courtyard). */
  footprint: MetricPolygon
  /** Same footprint in WGS84 for rendering. */
  footprintGeo: Polygon
  areaM2: number
  /** Height of the block's floor 1 above ground, metres (podium: 0, tower: podium height). */
  baseM: number
  /** Top of the block above ground, metres. */
  topM: number
  floors: number
}

export type DesignLimit = 'height' | 'far' | 'thinness' | 'override'

export interface Design {
  id: DesignId
  name: string
  description: string
  /** Ground footprint (union of the blocks at ground level), metric. */
  footprint: MetricPolygon
  footprintGeo: Polygon
  footprintAreaM2: number
  /** Total storeys (podium + tower for the tower design). */
  floors: number
  floorToFloorM: number
  heightM: number
  gfaM2: number
  openSpaceM2: number
  /** footprint / plot area */
  coverage: number
  blocks: Block[]
  notes: string[]
  limitedBy: DesignLimit
  /** Template defaults, so the UI can show what an override changed. */
  defaults: { floors: number }
  overrides: DesignOverrides
}

export interface DesignOverrides {
  /** Total floors; undefined = template default. */
  floors?: number
  /** Build on the whole plot, ignoring setbacks (to demonstrate failing checks). */
  ignoreSetbacks?: boolean
}

export type DesignOverrideMap = Partial<Record<DesignId, DesignOverrides>>

export const PODIUM_FLOORS_DEFAULT = 2
export const TOWER_MIN_WIDTH_M = 12
export const TOWER_MIN_AREA_M2 = 400
export const COURTYARD_MIN_FOOTPRINT_M2 = 1500
export const COURTYARD_DEPTH_M = 10
export const COURTYARD_GFA_TARGET_FRACTION = 0.8
/** Floors slider upper bound above the envelope's maximum, so a design can be pushed into failure. */
export const OVERRIDE_EXTRA_FLOORS = 6
