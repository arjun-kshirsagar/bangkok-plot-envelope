import { create } from 'zustand'
import type { Polygon } from 'geojson'
import { remapFrontEdge } from '../engine/plot'
import type { StageId } from '../engine/pipeline'
import type { DesignId, DesignOverrideMap, DesignOverrides } from '../designs/types'
import { DEFAULT_BUILDING_TYPE, type BuildingType } from '../rules'
import type { BuildingsSource, InteractionMode, MapView, RoadWidthSource, SceneInputs } from './types'

export const DEFAULT_ROAD_WIDTH_M = 12
export const DEFAULT_FLOOR_TO_FLOOR_M = 3.0
export const FLOOR_TO_FLOOR_RANGE: [number, number] = [2.6, 4.0]

export const DEFAULT_ROAD_WIDTH_SOURCE: RoadWidthSource = {
  kind: 'default',
  detail: 'Default 12 m. Pick the front edge to look up the road in OSM.',
}

export type StageVisibility = Record<StageId, boolean>

export const DEFAULT_STAGE_VISIBILITY: StageVisibility = {
  plot: true,
  roadSetback: true,
  boundarySetback: true,
  height: true,
  far: true,
  openSpace: true,
  envelope: true,
}

export interface AppState extends SceneInputs {
  roadWidthSource: RoadWidthSource
  /** Name / class of the road found near the front edge, for display. */
  roadInfo: string | null
  mode: InteractionMode
  buildingsSource: BuildingsSource
  view: MapView | null
  stageVisibility: StageVisibility
  selectedDesignId: DesignId
  designOverrides: DesignOverrideMap
  /**
   * True while the plot is being dragged / drawn (cleared on pointer-up or after 150 ms idle).
   * Only the envelope is recomputed meanwhile; designs and checks wait. Not in the URL.
   */
  plotSettling: boolean
  /** Last drawing-tool validation message (self-intersection, vertex cap), null when valid. Not in the URL. */
  drawNotice: string | null

  setPlot: (plot: Polygon | null) => void
  clearPlot: () => void
  setFrontEdgeIndex: (index: number | null) => void
  setRoadWidth: (widthM: number, source: RoadWidthSource) => void
  setRoadInfo: (info: string | null) => void
  setBuildingType: (type: BuildingType) => void
  setFloorToFloor: (m: number) => void
  setMode: (mode: InteractionMode) => void
  setBuildingsSource: (source: BuildingsSource) => void
  setView: (view: MapView) => void
  toggleStage: (id: StageId) => void
  selectDesign: (id: DesignId) => void
  setDesignOverride: (id: DesignId, patch: DesignOverrides) => void
  resetDesignOverrides: (id?: DesignId) => void
  setDrawNotice: (notice: string | null) => void
  setPlotSettling: (settling: boolean) => void
  hydrate: (scene: Partial<SceneInputs> & { roadWidthSource?: RoadWidthSource; view?: MapView | null; selectedDesignId?: DesignId; designOverrides?: DesignOverrideMap }) => void
}

const EMPTY_PLOT_STATE = {
  plot: null,
  frontEdgeIndex: null,
  roadWidthM: DEFAULT_ROAD_WIDTH_M,
  roadWidthSource: DEFAULT_ROAD_WIDTH_SOURCE,
  roadInfo: null,
} as const

export const useAppStore = create<AppState>()((set) => ({
  plot: null,
  frontEdgeIndex: null,
  roadWidthM: DEFAULT_ROAD_WIDTH_M,
  roadWidthSource: DEFAULT_ROAD_WIDTH_SOURCE,
  roadInfo: null,
  buildingType: DEFAULT_BUILDING_TYPE,
  floorToFloorM: DEFAULT_FLOOR_TO_FLOOR_M,
  mode: 'idle',
  buildingsSource: 'unknown',
  view: null,
  stageVisibility: DEFAULT_STAGE_VISIBILITY,
  selectedDesignId: 'slab',
  designOverrides: {},
  drawNotice: null,
  plotSettling: false,

  setPlot: (plot) =>
    set((state) => ({
      plot,
      frontEdgeIndex: remapFrontEdge(state.plot, state.frontEdgeIndex, plot),
    })),

  clearPlot: () => set({ ...EMPTY_PLOT_STATE, mode: 'idle' }),

  setFrontEdgeIndex: (frontEdgeIndex) => set({ frontEdgeIndex }),

  setRoadWidth: (roadWidthM, roadWidthSource) => set({ roadWidthM, roadWidthSource }),

  setRoadInfo: (roadInfo) => set({ roadInfo }),

  setBuildingType: (buildingType) => set({ buildingType }),

  setFloorToFloor: (m) => set({ floorToFloorM: Math.min(FLOOR_TO_FLOOR_RANGE[1], Math.max(FLOOR_TO_FLOOR_RANGE[0], m)) }),

  // Entering draw mode starts a fresh plot: the old plot, front edge and road are dropped.
  setMode: (mode) => set(mode === 'draw' ? { ...EMPTY_PLOT_STATE, mode, drawNotice: null } : { mode, drawNotice: null }),

  setBuildingsSource: (buildingsSource) => set({ buildingsSource }),

  setView: (view) => set({ view }),

  toggleStage: (id) => set((s) => ({ stageVisibility: { ...s.stageVisibility, [id]: !s.stageVisibility[id] } })),

  selectDesign: (selectedDesignId) => set({ selectedDesignId }),

  setDesignOverride: (id, patch) =>
    set((s) => {
      const next = { ...(s.designOverrides[id] ?? {}), ...patch }
      if (next.floors === undefined) delete next.floors
      if (!next.ignoreSetbacks) delete next.ignoreSetbacks
      return { designOverrides: { ...s.designOverrides, [id]: next } }
    }),

  resetDesignOverrides: (id) =>
    set((s) => {
      if (!id) return { designOverrides: {} }
      const copy = { ...s.designOverrides }
      delete copy[id]
      return { designOverrides: copy }
    }),

  setDrawNotice: (drawNotice) => set({ drawNotice }),

  setPlotSettling: (plotSettling) => set({ plotSettling }),

  hydrate: (scene) => set((state) => ({ ...state, ...scene })),
}))
