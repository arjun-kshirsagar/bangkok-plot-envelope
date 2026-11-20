/**
 * Scene <-> location hash. A link reproduces the plot, inputs and camera.
 *
 * Format (all optional):
 *   #plot=lng,lat;lng,lat;...  front=<edge index>  road=<metres>  type=<buildingType>
 *    f2f=<metres>  view=<zoom>/<lat>/<lng>/<pitch>/<bearing>
 *
 * Everything read from the hash is untrusted: coordinates must fall inside a
 * Bangkok bounding box, the plot must validate, and the view is clamped.
 */
import type { Polygon } from 'geojson'
import { validatePlot } from '../engine/plot'
import { isBuildingType, type BuildingType } from '../rules'
import { DESIGN_IDS, type DesignId, type DesignOverrides } from '../designs/types'
import type { MapView } from './types'
import { DEFAULT_FLOOR_TO_FLOOR_M, DEFAULT_ROAD_WIDTH_M, FLOOR_TO_FLOOR_RANGE, useAppStore, type AppState } from './useAppStore'

export interface UrlScene {
  plot: Polygon | null
  frontEdgeIndex: number | null
  roadWidthM: number | null
  buildingType: BuildingType | null
  floorToFloorM: number | null
  view: MapView | null
  /** Selected design and its overrides (`design=`, `dfl=` floors, `nosb=1` ignore setbacks). */
  design: DesignId | null
  designOverrides: DesignOverrides | null
}

function isDesignId(v: unknown): v is DesignId {
  return typeof v === 'string' && (DESIGN_IDS as readonly string[]).includes(v)
}

/** Accepted coordinate window: greater Bangkok. */
export const BANGKOK_BBOX = { west: 100.3, south: 13.5, east: 100.95, north: 13.95 } as const

export function inBangkok(lng: number, lat: number): boolean {
  return lng >= BANGKOK_BBOX.west && lng <= BANGKOK_BBOX.east && lat >= BANGKOK_BBOX.south && lat <= BANGKOK_BBOX.north
}

// 8 decimals = ~1 mm, so a re-encoded link reproduces areas to well under 1 m2.
const COORD_DECIMALS = 8

function fmt(n: number, decimals: number): string {
  return Number(n.toFixed(decimals)).toString()
}

export function encodeScene(scene: UrlScene): string {
  const params = new URLSearchParams()
  if (scene.plot) {
    const ring = scene.plot.coordinates[0] ?? []
    params.set('plot', ring.map((p) => `${fmt(p[0], COORD_DECIMALS)},${fmt(p[1], COORD_DECIMALS)}`).join(';'))
  }
  if (scene.frontEdgeIndex !== null) params.set('front', String(scene.frontEdgeIndex))
  if (scene.roadWidthM !== null) params.set('road', fmt(scene.roadWidthM, 2))
  if (scene.buildingType) params.set('type', scene.buildingType)
  if (scene.floorToFloorM !== null) params.set('f2f', fmt(scene.floorToFloorM, 2))
  if (scene.design) params.set('design', scene.design)
  if (scene.designOverrides?.floors !== undefined) params.set('dfl', String(scene.designOverrides.floors))
  if (scene.designOverrides?.ignoreSetbacks) params.set('nosb', '1')
  if (scene.view) {
    const v = scene.view
    params.set('view', [fmt(v.zoom, 2), fmt(v.lat, 6), fmt(v.lng, 6), fmt(v.pitch, 1), fmt(v.bearing, 1)].join('/'))
  }
  // URLSearchParams escapes "," ";" and "/"; keep the hash readable.
  return params.toString().replace(/%2C/gi, ',').replace(/%3B/gi, ';').replace(/%2F/gi, '/')
}

export function decodeScene(hash: string): UrlScene {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(raw)
  const scene: UrlScene = { plot: null, frontEdgeIndex: null, roadWidthM: null, buildingType: null, floorToFloorM: null, view: null, design: null, designOverrides: null }

  const plot = params.get('plot')
  if (plot) {
    const pts = plot
      .split(';')
      .map((pair) => pair.split(',').map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
    const allInside = pts.length >= 3 && pts.length <= 200 && pts.every((p) => inBangkok(p[0], p[1]))
    if (allInside) {
      const first = pts[0]
      const last = pts[pts.length - 1]
      const closed = first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first]
      const candidate: Polygon = { type: 'Polygon', coordinates: [closed] }
      if (validatePlot(candidate).ok) scene.plot = candidate
    }
  }

  const front = params.get('front')
  if (scene.plot && front !== null && /^\d+$/.test(front)) {
    const idx = parseInt(front, 10)
    const edgeCount = scene.plot.coordinates[0].length - 1
    if (idx < edgeCount) scene.frontEdgeIndex = idx
  }

  const road = params.get('road')
  if (road !== null) {
    const w = Number(road)
    if (Number.isFinite(w) && w >= 1 && w <= 200) scene.roadWidthM = w
  }

  const type = params.get('type')
  if (isBuildingType(type)) scene.buildingType = type

  const f2f = params.get('f2f')
  if (f2f !== null) {
    const v = Number(f2f)
    if (Number.isFinite(v) && v >= FLOOR_TO_FLOOR_RANGE[0] && v <= FLOOR_TO_FLOOR_RANGE[1]) scene.floorToFloorM = v
  }

  const design = params.get('design')
  if (isDesignId(design)) {
    scene.design = design
    const ov: DesignOverrides = {}
    const dfl = params.get('dfl')
    if (dfl !== null && /^\d{1,3}$/.test(dfl) && Number(dfl) >= 1) ov.floors = Number(dfl)
    if (params.get('nosb') === '1') ov.ignoreSetbacks = true
    if (Object.keys(ov).length) scene.designOverrides = ov
  }

  const view = params.get('view')
  if (view) {
    const parts = view.split('/').map(Number)
    if (parts.length === 5 && parts.every(Number.isFinite)) {
      const [zoom, lat, lng, pitch, bearing] = parts
      if (lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180) {
        scene.view = {
          zoom: Math.min(24, Math.max(0, zoom)),
          lat,
          lng,
          pitch: Math.min(75, Math.max(0, pitch)),
          bearing: ((bearing % 360) + 360) % 360,
        }
      }
    }
  }
  return scene
}

export function readSceneFromLocation(): UrlScene {
  if (typeof window === 'undefined') return decodeScene('')
  return decodeScene(window.location.hash)
}

/** Loads the scene in the URL into the store. Call once before rendering. */
export function hydrateStoreFromUrl(): void {
  const scene = readSceneFromLocation()
  const patch: Parameters<AppState['hydrate']>[0] = {
    plot: scene.plot,
    frontEdgeIndex: scene.frontEdgeIndex,
    roadWidthM: scene.roadWidthM ?? DEFAULT_ROAD_WIDTH_M,
    floorToFloorM: scene.floorToFloorM ?? DEFAULT_FLOOR_TO_FLOOR_M,
    view: scene.view,
  }
  if (scene.roadWidthM !== null) patch.roadWidthSource = { kind: 'link', detail: 'Restored from the shared link.' }
  if (scene.buildingType) patch.buildingType = scene.buildingType
  if (scene.design) {
    patch.selectedDesignId = scene.design
    if (scene.designOverrides) patch.designOverrides = { [scene.design]: scene.designOverrides }
  }
  useAppStore.getState().hydrate(patch)
}

/** Removes the scene from the URL (used by the error boundary's reset). */
export function clearSceneHash(): void {
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}

/** Keeps the location hash in sync with the store (debounced). Returns an unsubscribe. */
export function startUrlSync(debounceMs = 250): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const write = () => {
    const s = useAppStore.getState()
    const hash = encodeScene({
      plot: s.plot,
      frontEdgeIndex: s.frontEdgeIndex,
      roadWidthM: s.roadWidthM,
      buildingType: s.buildingType,
      floorToFloorM: s.floorToFloorM,
      view: s.view,
      design: s.plot ? s.selectedDesignId : null,
      designOverrides: s.plot ? (s.designOverrides[s.selectedDesignId] ?? null) : null,
    })
    const next = hash ? `#${hash}` : ''
    if (window.location.hash !== next) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
  }
  const unsub = useAppStore.subscribe((state, prev) => {
    if (
      state.plot === prev.plot &&
      state.frontEdgeIndex === prev.frontEdgeIndex &&
      state.roadWidthM === prev.roadWidthM &&
      state.buildingType === prev.buildingType &&
      state.floorToFloorM === prev.floorToFloorM &&
      state.view === prev.view &&
      state.selectedDesignId === prev.selectedDesignId &&
      state.designOverrides === prev.designOverrides
    )
      return
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, debounceMs)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsub()
  }
}
