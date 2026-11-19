import { create } from 'zustand'
import type { Polygon } from 'geojson'
import { remapFrontEdge } from '../engine/plot'
import { DEFAULT_BUILDING_TYPE, type BuildingType } from '../rules'
import type { BuildingsSource, InteractionMode, MapView, RoadWidthSource, SceneInputs } from './types'

export const DEFAULT_ROAD_WIDTH_M = 12

export const DEFAULT_ROAD_WIDTH_SOURCE: RoadWidthSource = {
  kind: 'default',
  detail: 'Default 12 m. Pick the front edge to look up the road in OSM.',
}

export interface AppState extends SceneInputs {
  roadWidthSource: RoadWidthSource
  /** Name / class of the road found near the front edge, for display. */
  roadInfo: string | null
  mode: InteractionMode
  buildingsSource: BuildingsSource
  view: MapView | null

  setPlot: (plot: Polygon | null) => void
  clearPlot: () => void
  setFrontEdgeIndex: (index: number | null) => void
  setRoadWidth: (widthM: number, source: RoadWidthSource) => void
  setRoadInfo: (info: string | null) => void
  setBuildingType: (type: BuildingType) => void
  setMode: (mode: InteractionMode) => void
  setBuildingsSource: (source: BuildingsSource) => void
  setView: (view: MapView) => void
  hydrate: (scene: Partial<SceneInputs> & { roadWidthSource?: RoadWidthSource; view?: MapView | null }) => void
}

export const useAppStore = create<AppState>()((set) => ({
  plot: null,
  frontEdgeIndex: null,
  roadWidthM: DEFAULT_ROAD_WIDTH_M,
  roadWidthSource: DEFAULT_ROAD_WIDTH_SOURCE,
  roadInfo: null,
  buildingType: DEFAULT_BUILDING_TYPE,
  mode: 'idle',
  buildingsSource: 'unknown',
  view: null,

  setPlot: (plot) =>
    set((state) => ({
      plot,
      frontEdgeIndex: remapFrontEdge(state.plot, state.frontEdgeIndex, plot),
    })),

  clearPlot: () =>
    set({
      plot: null,
      frontEdgeIndex: null,
      roadWidthM: DEFAULT_ROAD_WIDTH_M,
      roadWidthSource: DEFAULT_ROAD_WIDTH_SOURCE,
      roadInfo: null,
      mode: 'idle',
    }),

  setFrontEdgeIndex: (frontEdgeIndex) => set({ frontEdgeIndex }),

  setRoadWidth: (roadWidthM, roadWidthSource) => set({ roadWidthM, roadWidthSource }),

  setRoadInfo: (roadInfo) => set({ roadInfo }),

  setBuildingType: (buildingType) => set({ buildingType }),

  setMode: (mode) => set({ mode }),

  setBuildingsSource: (buildingsSource) => set({ buildingsSource }),

  setView: (view) => set({ view }),

  hydrate: (scene) => set((state) => ({ ...state, ...scene })),
}))
