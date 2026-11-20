import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { MapMouseEvent } from 'maplibre-gl'
import type { Polygon } from 'geojson'
import { nearestEdge, plotEdges } from '../engine/plot'
import type { LngLat } from '../engine/projection'
import { selectPipeline, selectSelectedDesign, useAppStore } from '../store'
import { DEFAULT_ROAD_WIDTH_M } from '../store/useAppStore'
import { startBuildingHeightCheck } from './buildings'
import { createDrawController } from './draw'
import { createEdgeHighlighter } from './frontEdge'
import { ensureBuildings3D, firstSymbolLayerId, INITIAL_VIEW, metresPerPixel, STYLE_URL } from './mapStyle'
import { buildDesignLayers, buildPipelineLayers, createOverlay } from './overlay'
import { resolveRoadWidth } from './roads'
import { addZoneLayers } from './zoneLayer'
import { fitToPlot, MAP_MAX_BOUNDS, restoreMaxBounds, trackTileLoading, useMapStatus } from './mapStatus'

export { MAP_MAX_BOUNDS }

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
      maxBounds: MAP_MAX_BOUNDS,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

    const cleanups: Array<() => void> = []
    useMapStatus.getState().setMap(map)
    cleanups.push(trackTileLoading(map))
    cleanups.push(() => useMapStatus.getState().setMap(null))
    let roadLookup: AbortController | null = null

    const setCursorClasses = (picking: boolean, overEdge: boolean) => {
      container.classList.toggle('pick-mode', picking)
      container.classList.toggle('edge-hover', picking && overEdge)
    }

    map.on('moveend', () => {
      const c = map.getCenter()
      store.getState().setView({ lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() })
    })

    // Keyboard: Terra Draw only hears keys while the map canvas has focus, so Esc and Delete are
    // also handled here (never while typing in a form control).
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const s = store.getState()
      if (e.key === 'Escape') {
        if (s.mode === 'draw' || s.mode === 'pickFront') s.setMode('idle')
        else if (s.mode === 'edit') s.setMode('idle')
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.mode === 'edit' && s.plot) {
        e.preventDefault()
        s.clearPlot()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    cleanups.push(() => window.removeEventListener('keydown', onKeyDown))

    map.on('load', () => {
      ensureBuildings3D(map)
      addZoneLayers(map)
      const overlay = createOverlay(map)
      const beforeId = firstSymbolLayerId(map)
      cleanups.push(startBuildingHeightCheck(map, (src) => store.getState().setBuildingsSource(src)))

      // Plots set from outside Terra Draw (example loader, link) are pushed back into it; the
      // ones Terra Draw itself produced are remembered so dragging never re-loads the feature.
      let lastDrawPlot: Polygon | null = null
      // While a vertex is dragged only the envelope follows the pointer; designs + checks run on
      // pointer-up (Terra Draw 'finish') or after 150 ms without movement.
      let settleTimer: ReturnType<typeof setTimeout> | null = null
      const settle = () => {
        if (settleTimer !== null) clearTimeout(settleTimer)
        settleTimer = null
        if (store.getState().plotSettling) store.getState().setPlotSettling(false)
      }
      cleanups.push(() => {
        if (settleTimer !== null) clearTimeout(settleTimer)
      })
      const draw = createDrawController(map, {
        onPlotChange: (plot) => {
          lastDrawPlot = plot
          const st = store.getState()
          if (!st.plotSettling) st.setPlotSettling(true)
          st.setPlot(plot)
          if (settleTimer !== null) clearTimeout(settleTimer)
          settleTimer = setTimeout(settle, 150)
        },
        onEditFinished: settle,
        onDrawFinished: () => {
          settle()
          store.getState().setMode('edit')
          fitToPlot(store.getState().plot)
        },
        onPlotDeleted: () => store.getState().clearPlot(),
        onValidation: (message) => store.getState().setDrawNotice(message),
      })
      cleanups.push(() => draw.destroy())

      const edges = createEdgeHighlighter(map)

      // Initial sync (plot may have come from the URL). Without a camera in the link, frame the plot.
      const initial = store.getState()
      if (initial.plot) {
        draw.loadPlot(initial.plot)
        lastDrawPlot = initial.plot
        if (!initial.view) fitToPlot(initial.plot, { duration: 0 })
      }
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
            // The opaque design goes first so the faded envelope (no depth writes) blends over it.
            ...buildDesignLayers(s.plotSettling ? null : (selected?.design ?? null), { beforeId }),
            ...buildPipelineLayers(pipeline, s.stageVisibility, { beforeId, envelopeFaded: selected !== null && !s.plotSettling }),
          ],
        })
      }
      // Coalesce overlay updates to one per animation frame while vertices are dragged.
      let overlayFrame: number | null = null
      const scheduleOverlay = () => {
        if (overlayFrame !== null) return
        overlayFrame = requestAnimationFrame(() => {
          overlayFrame = null
          syncOverlay(store.getState())
        })
      }
      cleanups.push(() => {
        if (overlayFrame !== null) cancelAnimationFrame(overlayFrame)
      })
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
          if (state.plot !== prev.plot && state.plot === null) {
            draw.clear()
            restoreMaxBounds()
          }
          if (state.plot !== prev.plot && state.plot !== null && state.plot !== lastDrawPlot) {
            lastDrawPlot = state.plot
            draw.loadPlot(state.plot)
          }
          if (state.plot !== prev.plot || state.frontEdgeIndex !== prev.frontEdgeIndex) syncFront(state)
          if (
            state.plot !== prev.plot ||
            state.frontEdgeIndex !== prev.frontEdgeIndex ||
            state.roadWidthM !== prev.roadWidthM ||
            state.buildingType !== prev.buildingType ||
            state.floorToFloorM !== prev.floorToFloorM ||
            state.stageVisibility !== prev.stageVisibility ||
            state.selectedDesignId !== prev.selectedDesignId ||
            state.designOverrides !== prev.designOverrides ||
            state.plotSettling !== prev.plotSettling
          ) {
            scheduleOverlay()
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
