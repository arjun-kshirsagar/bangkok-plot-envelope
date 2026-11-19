/**
 * Massing templates: (envelope, rules, buildingType) -> design. Filled in Phase 4.
 */
import type { MultiPolygon, Polygon } from 'geojson'

export interface Design {
  id: string
  label: string
  footprint: Polygon | MultiPolygon
  footprintAreaM2: number
  floors: number
  floorHeightM: number
  heightM: number
  gfaM2: number
  openSpaceM2: number
  /** footprint / plot area, ratio 0..1 */
  coverage: number
}

export const DESIGN_TEMPLATES: readonly string[] = []
