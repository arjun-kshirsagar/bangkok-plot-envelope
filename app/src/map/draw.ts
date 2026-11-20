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
import { segmentsIntersect } from '../engine/geometry'

export const PLOT_FILL_COLOR = '#2dd4bf'
export const PLOT_OUTLINE_COLOR = '#0d9488'

export interface DrawHandlers {
  /** Fired on every geometry change (while drawing, dragging vertices, after finish). */
  onPlotChange: (plot: Polygon | null) => void
  /** Fired when a polygon has been completed (double click / closing point). */
  onDrawFinished: () => void
  /** Fired when the user deletes the plot inside Terra Draw (Delete key). */
  onPlotDeleted: () => void
  /** Fired when a vertex drag (or other edit) ends, so deferred work can run at once. */
  onEditFinished?: () => void
  /** Fired when Terra Draw's validation result changes: a user-facing reason, or null when valid again. */
  onValidation?: (message: string | null) => void
}

/** Open polyline (ring without its closing edge) has no two non-adjacent segments crossing. */
function openPolylineValid(feature: GeoJSONStoreFeatures): { valid: boolean; reason?: string } {
  if (feature.geometry.type !== 'Polygon') return { valid: true }
  const ring = feature.geometry.coordinates[0]
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let j = i + 2; j + 1 < pts.length; j++) {
      if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) return { valid: false, reason: 'Self-intersecting' }
    }
  }
  return { valid: true }
}

/** Plain-language version of a Terra Draw validation failure. */
function validationMessage(reason: string | undefined, drawing: boolean): string {
  if (reason && /vertices/.test(reason)) return `${reason}: the plot is capped at ${MAX_PLOT_VERTICES} vertices to keep the geometry fast. Close the outline or remove a vertex.`
  return drawing
    ? 'That vertex would make the outline cross itself, so it was not added. Click somewhere that keeps the edges apart.'
    : 'That move would make the outline cross itself, so the vertex stopped at its last valid position. Drag it somewhere that keeps the edges apart.'
}

export interface DrawController {
  setMode: (mode: InteractionMode) => void
  /** Replaces whatever is drawn with this polygon (used when restoring from a link). */
  loadPlot: (plot: Polygon | null) => void
  clear: () => void
  destroy: () => void
}

export function createDrawController(map: MapLibreMap, handlers: DrawHandlers): DrawController {
  let lastNotice: string | null = null
  const report = (v: { valid: boolean; reason?: string }, drawing: boolean) => {
    const notice = v.valid ? null : validationMessage(v.reason, drawing)
    if (notice !== lastNotice) {
      lastNotice = notice
      handlers.onValidation?.(notice)
    }
    return v
  }
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
    modes: [
      new TerraDrawPolygonMode({
        // While drawing, the ring carries the provisional cursor vertex as well, hence +1.
        // While drawing, the ring Terra Draw validates is closed back to the first vertex; that
        // temporary closing edge often crosses a C- or L-shape drawn in natural order. Only the
        // open polyline is checked until the user finishes; the closed ring is checked on finish.
        validation: (feature, context) => {
          const v = context.updateType === 'finish' ? ValidateNotSelfIntersecting(feature) : openPolylineValid(feature)
          if (!v.valid) return report(v, true)
          const n = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0].length - 1 : 0
          return report(n <= MAX_PLOT_VERTICES + 1 ? { valid: true } : { valid: false, reason: `Maximum ${MAX_PLOT_VERTICES} vertices` }, true)
        },
        styles: {
          fillColor: PLOT_FILL_COLOR,
          fillOpacity: 0.14,
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
                if (!v.valid) return report(v, false)
                const n = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0].length - 1 : 0
                return report(n <= MAX_PLOT_VERTICES ? { valid: true } : { valid: false, reason: `Maximum ${MAX_PLOT_VERTICES} vertices` }, false)
              },
              draggable: false,
              rotateable: false,
              scaleable: false,
              // true: let our validation (below) reject crossing drags so the panel can say why;
          // with false Terra Draw refuses them silently before custom validation runs.
          selfIntersectable: true,
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
          selectedPolygonFillOpacity: 0.2,
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
    if (context.mode !== 'polygon' || context.action !== 'draw') {
      handlers.onEditFinished?.()
      return
    }
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

  // Mode switches (de)select the feature, which Terra Draw reports as property 'update'
  // changes; those must not be echoed back to the store as geometry changes.
  const setMode = (mode: InteractionMode) => {
    syncing = true
    try {
      switch (mode) {
        case 'draw':
          draw.clear()
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
    } finally {
      syncing = false
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
