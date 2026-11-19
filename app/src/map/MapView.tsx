import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { MapMouseEvent } from 'maplibre-gl'
import { nearestEdge, plotEdges } from '../engine/plot'
import type { LngLat } from '../engine/projection'
import { selectPipeline, useAppStore } from '../store'
import { DEFAULT_ROAD_WIDTH_M } from '../store/useAppStore'
import { startBuildingHeightCheck } from './buildings'
import { createDrawController } from './draw'
import { createEdgeHighlighter } from './frontEdge'
import { ensureBuildings3D, INITIAL_VIEW, metresPerPixel, STYLE_URL } from './mapStyle'
import { buildPipelineLayers, createOverlay } from './overlay'
import { resolveRoadWidth } from './roads'

const PICK_TOLERANCE_PX = 16

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
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

    const cleanups: Array<() => void> = []
    let roadLookup: AbortController | null = null

    map.on('moveend', () => {
      const c = map.getCenter()
      store.getState().setView({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
    })

    map.on('load', () => {
      ensureBuildings3D(map)
      const overlay = createOverlay(map)
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
      syncFront()

      cleanups.push(
        store.subscribe((state, prev) => {
          if (state.mode !== prev.mode) {
            draw.setMode(state.mode)
            if (state.mode !== 'pickFront') edges.setHover(null)
            map.getCanvas().style.cursor = state.mode === 'pickFront' ? 'crosshair' : ''
          }
          if (state.plot !== prev.plot && state.plot === null) draw.clear()
          if (state.plot !== prev.plot || state.frontEdgeIndex !== prev.frontEdgeIndex) syncFront(state)
          if (
            state.plot !== prev.plot ||
            state.frontEdgeIndex !== prev.frontEdgeIndex ||
            state.roadWidthM !== prev.roadWidthM ||
            state.buildingType !== prev.buildingType
          ) {
            overlay.setProps({ layers: buildPipelineLayers(selectPipeline(state)) })
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
        map.getCanvas().style.cursor = idx === null ? 'crosshair' : 'pointer'
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
          if (lookup.widthM !== null) st.setRoadWidth(lookup.widthM, lookup.source)
          else st.setRoadWidth(st.roadWidthSource.kind === 'manual' ? st.roadWidthM : DEFAULT_ROAD_WIDTH_M, lookup.source)
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
