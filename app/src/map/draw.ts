/**
 * Terra Draw wiring: one plot polygon at a time; draw, edit vertices, delete.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Polygon } from 'geojson'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  ValidateNotSelfIntersecting,
  type GeoJSONStoreFeatures,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { InteractionMode } from '../store/types'
import { MAX_PLOT_VERTICES } from '../engine/plot'

export const PLOT_FILL_COLOR = '#2dd4bf'
export const PLOT_OUTLINE_COLOR = '#0d9488'

export interface DrawHandlers {
  /** Fired on every geometry change (while drawing, dragging vertices, after finish). */
  onPlotChange: (plot: Polygon | null) => void
  /** Fired when a polygon has been completed (double click / closing point). */
  onDrawFinished: () => void
  /** Fired when the user deletes the plot inside Terra Draw (Delete key). */
  onPlotDeleted: () => void
}

export interface DrawController {
  setMode: (mode: InteractionMode) => void
  /** Replaces whatever is drawn with this polygon (used when restoring from a link). */
  loadPlot: (plot: Polygon | null) => void
  clear: () => void
  destroy: () => void
}

export function createDrawController(map: MapLibreMap, handlers: DrawHandlers): DrawController {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
    modes: [
      new TerraDrawPolygonMode({
        // While drawing, the ring carries the provisional cursor vertex as well, hence +1.
        validation: (feature) => {
          const v = ValidateNotSelfIntersecting(feature)
          if (!v.valid) return v
          const n = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0].length - 1 : 0
          return n <= MAX_PLOT_VERTICES + 1 ? { valid: true } : { valid: false, reason: `Maximum ${MAX_PLOT_VERTICES} vertices` }
        },
        styles: {
          fillColor: PLOT_FILL_COLOR,
          fillOpacity: 0.28,
          outlineColor: PLOT_OUTLINE_COLOR,
          outlineWidth: 2,
          closingPointColor: '#ffffff',
          closingPointWidth: 5,
          closingPointOutlineColor: PLOT_OUTLINE_COLOR,
          closingPointOutlineWidth: 2,
        },
      }),
      new TerraDrawSelectMode({
        flags: {
          polygon: {
            feature: {
              validation: (feature) => {
                const v = ValidateNotSelfIntersecting(feature)
                if (!v.valid) return v
                const n = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0].length - 1 : 0
                return n <= MAX_PLOT_VERTICES ? { valid: true } : { valid: false, reason: `Maximum ${MAX_PLOT_VERTICES} vertices` }
              },
              draggable: false,
              rotateable: false,
              scaleable: false,
              selfIntersectable: false,
              coordinates: {
                midpoints: true,
                draggable: true,
                deletable: true,
              },
            },
          },
        },
        styles: {
          selectedPolygonColor: PLOT_FILL_COLOR,
          selectedPolygonFillOpacity: 0.28,
          selectedPolygonOutlineColor: PLOT_OUTLINE_COLOR,
          selectedPolygonOutlineWidth: 2,
          selectionPointColor: '#ffffff',
          selectionPointWidth: 6,
          selectionPointOutlineColor: PLOT_OUTLINE_COLOR,
          selectionPointOutlineWidth: 2,
          midPointColor: '#ffffff',
          midPointWidth: 4,
          midPointOutlineColor: '#94a3b8',
          midPointOutlineWidth: 1,
        },
      }),
    ],
  })

  let syncing = false
  let currentId: string | number | null = null

  const polygonOf = (feature: GeoJSONStoreFeatures | undefined): Polygon | null => {
    if (!feature || feature.geometry.type !== 'Polygon') return null
    return feature.geometry
  }

  const currentPolygonFeature = (): GeoJSONStoreFeatures | undefined => {
    const polys = draw.getSnapshot().filter((f) => f.geometry.type === 'Polygon' && f.properties.mode === 'polygon')
    return polys[polys.length - 1]
  }

  draw.on('change', (ids, type) => {
    if (syncing) return
    if (type === 'delete') {
      const remaining = currentPolygonFeature()
      if (!remaining) {
        currentId = null
        handlers.onPlotDeleted()
      }
      return
    }
    if (type !== 'create' && type !== 'update') return
    for (const id of ids) {
      const f = draw.getSnapshotFeature(id)
      if (f && f.geometry.type === 'Polygon' && f.properties.mode === 'polygon') {
        currentId = id
        handlers.onPlotChange(polygonOf(f))
        return
      }
    }
  })

  draw.on('finish', (id, context) => {
    if (context.mode !== 'polygon' || context.action !== 'draw') return
    // One plot at a time: drop any other polygon.
    const others = draw
      .getSnapshot()
      .filter((f) => f.id !== id && f.geometry.type === 'Polygon' && f.properties.mode === 'polygon')
      .map((f) => f.id)
      .filter((v): v is string | number => v !== undefined)
    if (others.length) draw.removeFeatures(others)
    currentId = id
    handlers.onPlotChange(polygonOf(draw.getSnapshotFeature(id)))
    handlers.onDrawFinished()
  })

  draw.start()
  draw.setMode('static')

  const setMode = (mode: InteractionMode) => {
    switch (mode) {
      case 'draw':
        syncing = true
        draw.clear()
        syncing = false
        currentId = null
        draw.setMode('polygon')
        break
      case 'edit':
        draw.setMode('select')
        if (currentId !== null && draw.hasFeature(currentId)) {
          try {
            draw.selectFeature(currentId)
          } catch {
            /* feature may not be selectable yet */
          }
        }
        break
      case 'pickFront':
      case 'idle':
        draw.setMode('static')
        break
    }
  }

  const loadPlot = (plot: Polygon | null) => {
    syncing = true
    draw.clear()
    currentId = null
    if (plot) {
      const results = draw.addFeatures([
        { type: 'Feature', properties: { mode: 'polygon' }, geometry: plot },
      ])
      const first = results[0]
      if (first?.valid && first.id !== undefined) currentId = first.id
      else console.warn('[draw] could not load plot from link', first?.reason)
    }
    syncing = false
  }

  return {
    setMode,
    loadPlot,
    clear: () => {
      syncing = true
      draw.clear()
      syncing = false
      currentId = null
    },
    destroy: () => {
      try {
        draw.stop()
      } catch {
        /* map may already be removed */
      }
    },
  }
}
