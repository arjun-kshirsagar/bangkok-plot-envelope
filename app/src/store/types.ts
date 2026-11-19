import type { Polygon } from 'geojson'
import type { BuildingType } from '../rules'

export type InteractionMode = 'idle' | 'draw' | 'edit' | 'pickFront'

export type RoadWidthSourceKind = 'default' | 'lookup' | 'osm-width' | 'osm-lanes' | 'manual' | 'link'

export interface RoadWidthSource {
  kind: RoadWidthSourceKind
  /** One line for the UI explaining where the number came from. */
  detail: string
}

export type BuildingsSource = 'unknown' | 'tiles' | 'overpass' | 'overpass-failed'

export interface MapView {
  lng: number
  lat: number
  zoom: number
  pitch: number
  bearing: number
}

export interface SceneInputs {
  plot: Polygon | null
  frontEdgeIndex: number | null
  roadWidthM: number
  buildingType: BuildingType
}
