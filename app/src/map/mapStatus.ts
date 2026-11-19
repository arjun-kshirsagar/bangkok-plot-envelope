/**
 * Small map-side store: the live MapLibre instance (for camera actions triggered from
 * the UI) and tile-loading status. Kept out of the app store because it is purely
 * presentational.
 */
import { create } from 'zustand'
import type { LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl'
import type { Polygon } from 'geojson'

interface MapStatusState {
  map: MapLibreMap | null
  tilesLoading: boolean
  setMap: (map: MapLibreMap | null) => void
  setTilesLoading: (loading: boolean) => void
}

export const useMapStatus = create<MapStatusState>()((set) => ({
  map: null,
  tilesLoading: true,
  setMap: (map) => set({ map }),
  setTilesLoading: (tilesLoading) => set({ tilesLoading }),
}))

/** Right-hand padding so the plot is centred in the part of the map not covered by the panel. */
function panelPadding(map: MapLibreMap): { top: number; bottom: number; left: number; right: number } {
  const w = map.getContainer().clientWidth
  const narrow = w <= 720
  return narrow ? { top: 60, bottom: Math.round(map.getContainer().clientHeight * 0.5), left: 40, right: 40 } : { top: 80, bottom: 80, left: 80, right: 420 }
}

/** Frames the plot, keeping the current pitch and bearing. */
export function fitToPlot(plot: Polygon | null, options: { duration?: number } = {}): void {
  const map = useMapStatus.getState().map
  if (!map || !plot) return
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [x, y] of plot.coordinates[0]) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  if (!Number.isFinite(w)) return
  const bounds: LngLatBoundsLike = [
    [w, s],
    [e, n],
  ]
  map.fitBounds(bounds, {
    padding: panelPadding(map),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    maxZoom: 18.6,
    duration: options.duration ?? 700,
  })
}

/** Wires tile-loading status; returns a cleanup. */
export function trackTileLoading(map: MapLibreMap): () => void {
  const update = () => useMapStatus.getState().setTilesLoading(!map.areTilesLoaded())
  const onIdle = () => useMapStatus.getState().setTilesLoading(false)
  map.on('sourcedata', update)
  map.on('dataloading', update)
  map.on('idle', onIdle)
  update()
  return () => {
    map.off('sourcedata', update)
    map.off('dataloading', update)
    map.off('idle', onIdle)
  }
}
