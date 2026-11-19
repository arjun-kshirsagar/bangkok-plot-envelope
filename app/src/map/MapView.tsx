import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { LngLatBoundsLike, MapMouseEvent } from 'maplibre-gl'
import { nearestEdge, plotEdges } from '../engine/plot'
import type { LngLat } from '../engine/projection'
import { ZONE_BBOX } from '../rules'
import { selectPipeline, selectSelectedDesign, useAppStore } from '../store'
import { DEFAULT_ROAD_WIDTH_M } from '../store/useAppStore'
import { startBuildingHeightCheck } from './buildings'
import { createDrawController } from './draw'
import { createEdgeHighlighter } from './frontEdge'
import { ensureBuildings3D, firstSymbolLayerId, INITIAL_VIEW, metresPerPixel, STYLE_URL } from './mapStyle'
import { buildDesignLayers, buildPipelineLayers, createOverlay } from './overlay'
import { resolveRoadWidth } from './roads'
import { addZoneLayers } from './zoneLayer'

const PICK_TOLERANCE_PX = 16
/** ~1.5 km of padding around the Y.10 sub-zones (at 13.7 N, 1 deg lng ~ 108 km, 1 deg lat ~ 110.6 km). */
const BOUNDS_PAD_LNG = 1.5 / 108
const BOUNDS_PAD_LAT = 1.5 / 110.6

export const MAP_MAX_BOUNDS: LngLatBoundsLike = [
  [ZONE_BBOX[0] - BOUNDS_PAD_LNG, ZONE_BBOX[1] - BOUNDS_PAD_LAT],
  [ZONE_BBOX[2] + BOUNDS_PAD_LNG, ZONE_BBOX[3] + BOUNDS_PAD_LAT],
]

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const store = useAppStore
    const view = store.getState().view ?? INITIAL_VIEW
    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      pitch: view.pitch,
      bearing: view.bearing,
      maxPitch: 75,
      maxBounds: MAP_MAX_BOUNDS,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

    const cleanups: Array<() => void> = []
    let roadLookup: AbortController | null = null

    const setCursorClasses = (picking: boolean, overEdge: boolean) => {
      container.classList.toggle('pick-mode', picking)
      container.classList.toggle('edge-hover', picking && overEdge)
    }

    map.on('moveend', () => {
      const c = map.getCenter()
      store.getState().setView({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
    })

    // Esc while drawing with no vertices placed: Terra Draw has nothing to cancel, so leave draw mode ourselves.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = store.getState()
      if (s.mode === 'draw' || s.mode === 'pickFront') s.setMode('idle')
    }
    window.addEventListener('keydown', onKeyDown)
    cleanups.push(() => window.removeEventListener('keydown', onKeyDown))

    map.on('load', () => {
      ensureBuildings3D(map)
      addZoneLayers(map)
      const overlay = createOverlay(map)
      const beforeId = firstSymbolLayerId(map)
      cleanups.push(startBuildingHeightCheck(map, (src) => store.getState().setBuildingsSource(src)))

      const draw = createDrawController(map, {
        onPlotChange: (plot) => store.getState().setPlot(plot),
        onDrawFinished: () => store.getState().setMode('edit'),
        onPlotDeleted: () => store.getState().clearPlot(),
      })
      cleanups.push(() => draw.destroy())

      const edges = createEdgeHighlighter(map)

      // Initial sync (plot may have come from the URL).
      const initial = store.getState()
      if (initial.plot) draw.loadPlot(initial.plot)
      draw.setMode(initial.mode)
      const syncFront = (s = store.getState()) => {
        const e = s.plot && s.frontEdgeIndex !== null ? plotEdges(s.plot)[s.frontEdgeIndex] ?? null : null
        edges.setFront(e)
      }
      const syncOverlay = (s = store.getState()) => {
        const pipeline = selectPipeline(s)
        const selected = selectSelectedDesign(s, pipeline)
        overlay.setProps({
          layers: [
            ...buildPipelineLayers(pipeline, s.stageVisibility, { beforeId, envelopeFaded: selected !== null }),
            ...buildDesignLayers(selected?.design ?? null, { beforeId }),
          ],
        })
      }
      syncFront()
      syncOverlay()
      setCursorClasses(initial.mode === 'pickFront', false)

      cleanups.push(
        store.subscribe((state, prev) => {
          if (state.mode !== prev.mode) {
            draw.setMode(state.mode)
            if (state.mode !== 'pickFront') edges.setHover(null)
            setCursorClasses(state.mode === 'pickFront', false)
          }
          if (state.plot !== prev.plot && state.plot === null) draw.clear()
          if (state.plot !== prev.plot || state.frontEdgeIndex !== prev.frontEdgeIndex) syncFront(state)
          if (
            state.plot !== prev.plot ||
            state.frontEdgeIndex !== prev.frontEdgeIndex ||
            state.roadWidthM !== prev.roadWidthM ||
            state.buildingType !== prev.buildingType ||
            state.floorToFloorM !== prev.floorToFloorM ||
            state.stageVisibility !== prev.stageVisibility ||
            state.selectedDesignId !== prev.selectedDesignId ||
            state.designOverrides !== prev.designOverrides
          ) {
            syncOverlay(state)
          }
        }),
      )

      const edgeAt = (lngLat: LngLat) => {
        const s = store.getState()
        if (!s.plot) return null
        const hit = nearestEdge(s.plot, lngLat)
        if (!hit) return null
        const toleranceM = PICK_TOLERANCE_PX * metresPerPixel(map)
        return hit.distanceM <= toleranceM ? hit.index : null
      }

      map.on('mousemove', (e: MapMouseEvent) => {
        const s = store.getState()
        if (s.mode !== 'pickFront' || !s.plot) return
        const idx = edgeAt([e.lngLat.lng, e.lngLat.lat])
        edges.setHover(idx === null ? null : plotEdges(s.plot)[idx] ?? null)
        setCursorClasses(true, idx !== null)
      })

      map.on('click', (e: MapMouseEvent) => {
        const s = store.getState()
        if (s.mode !== 'pickFront' || !s.plot) return
        const idx = edgeAt([e.lngLat.lng, e.lngLat.lat])
        if (idx === null) return
        const edge = plotEdges(s.plot)[idx]
        s.setFrontEdgeIndex(idx)
        s.setMode('idle')
        edges.setHover(null)

        roadLookup?.abort()
        roadLookup = new AbortController()
        const signal = roadLookup.signal
        const apply = (lookup: Awaited<ReturnType<typeof resolveRoadWidth>>) => {
          if (signal.aborted) return
          const st = store.getState()
          if (st.frontEdgeIndex !== idx) return
          st.setRoadInfo(lookup.roadInfo)
          // A width the user typed is never overwritten or relabelled by a lookup.
          if (st.roadWidthSource.kind === 'manual') return
          if (lookup.widthM !== null) st.setRoadWidth(lookup.widthM, lookup.source)
          else st.setRoadWidth(DEFAULT_ROAD_WIDTH_M, lookup.source)
        }
        resolveRoadWidth(map, edge.midpoint, signal, apply)
          .then(apply)
          .catch((err: unknown) => {
            if (!(err instanceof DOMException && err.name === 'AbortError')) console.warn('[roads] lookup failed', err)
          })
      })
    })

    return () => {
      roadLookup?.abort()
      cleanups.splice(0).forEach((fn) => fn())
      map.remove()
    }
  }, [])

  return <div ref={containerRef} className="map" aria-label="3D map of Bangkok" />
}
