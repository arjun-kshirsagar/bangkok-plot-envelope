/**
 * Scene <-> location hash. A link reproduces the plot, inputs and camera.
 *
 * Format (all optional):
 *   #plot=lng,lat;lng,lat;...  front=<edge index>  road=<metres>  type=<buildingType>
 *    view=<zoom>/<lat>/<lng>/<pitch>/<bearing>
 */
import type { Polygon } from 'geojson'
import { isBuildingType, type BuildingType } from '../rules'
import type { MapView } from './types'
import { DEFAULT_ROAD_WIDTH_M, useAppStore, type AppState } from './useAppStore'

export interface UrlScene {
  plot: Polygon | null
  frontEdgeIndex: number | null
  roadWidthM: number | null
  buildingType: BuildingType | null
  view: MapView | null
}

const COORD_DECIMALS = 7

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
  const scene: UrlScene = { plot: null, frontEdgeIndex: null, roadWidthM: null, buildingType: null, view: null }

  const plot = params.get('plot')
  if (plot) {
    const pts = plot
      .split(';')
      .map((pair) => pair.split(',').map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
    if (pts.length >= 3) {
      const first = pts[0]
      const last = pts[pts.length - 1]
      const closed = first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first]
      scene.plot = { type: 'Polygon', coordinates: [closed] }
    }
  }

  const front = params.get('front')
  if (front !== null && /^\d+$/.test(front)) scene.frontEdgeIndex = parseInt(front, 10)

  const road = params.get('road')
  if (road !== null) {
    const w = Number(road)
    if (Number.isFinite(w) && w > 0) scene.roadWidthM = w
  }

  const type = params.get('type')
  if (isBuildingType(type)) scene.buildingType = type

  const view = params.get('view')
  if (view) {
    const parts = view.split('/').map(Number)
    if (parts.length === 5 && parts.every(Number.isFinite)) {
      const [zoom, lat, lng, pitch, bearing] = parts
      scene.view = { zoom, lat, lng, pitch, bearing }
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
  const edgeCount = scene.plot ? Math.max(0, (scene.plot.coordinates[0]?.length ?? 1) - 1) : 0
  const patch: Parameters<AppState['hydrate']>[0] = {
    plot: scene.plot,
    frontEdgeIndex: scene.frontEdgeIndex !== null && scene.frontEdgeIndex < edgeCount ? scene.frontEdgeIndex : null,
    roadWidthM: scene.roadWidthM ?? DEFAULT_ROAD_WIDTH_M,
    view: scene.view,
  }
  if (scene.roadWidthM !== null) patch.roadWidthSource = { kind: 'link', detail: 'Restored from the shared link.' }
  if (scene.buildingType) patch.buildingType = scene.buildingType
  useAppStore.getState().hydrate(patch)
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
      view: s.view,
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
      state.view === prev.view
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
