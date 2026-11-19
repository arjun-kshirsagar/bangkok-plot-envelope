/**
 * deck.gl overlay interleaved with the MapLibre scene: pipeline stages as flat
 * polygons and the envelope as an extruded, translucent volume.
 */
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Layer } from '@deck.gl/core'
import { PathLayer, PolygonLayer } from '@deck.gl/layers'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import type { PipelineResult, StageId } from '../engine/pipeline'
import type { StageVisibility } from '../store/useAppStore'
import type { Design } from '../designs/types'

export function createOverlay(map: MapLibreMap): MapboxOverlay {
  const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
  map.addControl(overlay as unknown as IControl)
  return overlay
}

type Rgba = [number, number, number, number]

export const STAGE_COLORS: Record<StageId, { fill: Rgba; line: Rgba; label: string }> = {
  plot: { fill: [45, 212, 191, 0], line: [13, 148, 136, 0], label: 'Plot' },
  roadSetback: { fill: [220, 38, 38, 110], line: [185, 28, 28, 220], label: 'Road setback strip' },
  boundarySetback: { fill: [245, 158, 11, 100], line: [217, 119, 6, 220], label: 'Boundary setback band' },
  height: { fill: [0, 0, 0, 0], line: [0, 0, 0, 0], label: 'Height cap' },
  far: { fill: [0, 0, 0, 0], line: [0, 0, 0, 0], label: 'FAR' },
  openSpace: { fill: [250, 204, 21, 110], line: [202, 138, 4, 220], label: 'Open-space shrink' },
  envelope: { fill: [59, 130, 246, 95], line: [37, 99, 235, 255], label: 'Buildable envelope' },
}

interface PolyDatum {
  rings: Position[][]
}

function toData(geometry: Polygon | MultiPolygon | null): PolyDatum[] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [{ rings: geometry.coordinates }]
  return geometry.coordinates.map((rings) => ({ rings }))
}

export interface OverlayOptions {
  /** MapLibre layer id to insert the flat layers before (e.g. the first symbol layer). */
  beforeId?: string
  /** When a concept design is drawn inside it, the envelope volume becomes a faint reference. */
  envelopeFaded?: boolean
}

export function buildPipelineLayers(result: PipelineResult, visibility: StageVisibility, options: OverlayOptions = {}): Layer[] {
  const layers: Layer[] = []
  // `beforeId` is read by MapboxOverlay (interleaved) but is not part of the layer's own prop type.
  const placement: { beforeId?: string } = { beforeId: options.beforeId }
  // Draw order matters: the road strip sits on top of the full setback band.
  const flat: StageId[] = ['boundarySetback', 'roadSetback', 'openSpace']
  for (const id of flat) {
    if (!visibility[id]) continue
    const stage = result.stages.find((s) => s.id === id)
    const data = toData(stage?.geometry ?? null)
    if (data.length === 0) continue
    layers.push(
      new PolygonLayer<PolyDatum>({
        id: `stage-${id}`,
        data,
        getPolygon: (d) => d.rings,
        filled: true,
        stroked: true,
        extruded: false,
        getFillColor: STAGE_COLORS[id].fill,
        getLineColor: STAGE_COLORS[id].line,
        lineWidthMinPixels: 1,
        pickable: false,
        ...placement,
      }),
    )
  }
  if (visibility.envelope && result.envelope?.footprint) {
    const data = toData(result.envelope.footprint)
    const heightM = result.envelope.heightM
    layers.push(
      new PolygonLayer<PolyDatum>({
        id: 'envelope-footprint',
        data,
        getPolygon: (d) => d.rings,
        filled: true,
        stroked: true,
        extruded: false,
        getFillColor: [59, 130, 246, 60],
        getLineColor: STAGE_COLORS.envelope.line,
        lineWidthMinPixels: 2,
        pickable: false,
        ...placement,
      }),
    )
    if (heightM > 0) {
      layers.push(
        new PolygonLayer<PolyDatum>({
          id: 'envelope-volume',
          data,
          getPolygon: (d) => d.rings,
          filled: true,
          stroked: false,
          extruded: true,
          wireframe: true,
          getElevation: heightM,
          getFillColor: options.envelopeFaded ? [59, 130, 246, 28] : STAGE_COLORS.envelope.fill,
          getLineColor: STAGE_COLORS.envelope.line,
          material: { ambient: 0.55, diffuse: 0.6, shininess: 20, specularColor: [80, 80, 80] },
          pickable: false,
          ...placement,
        }),
      )
    }
  }
  return layers
}

export const DESIGN_FILL: Rgba = [222, 142, 84, 235]
export const DESIGN_LINE: Rgba = [110, 60, 25, 255]

interface FloorLine {
  path: [number, number, number][]
}

/** Selected design as solid extruded blocks with a floor line at every storey. */
export function buildDesignLayers(design: Design | null, options: OverlayOptions = {}): Layer[] {
  if (!design) return []
  const placement: { beforeId?: string } = { beforeId: options.beforeId }
  const layers: Layer[] = []
  const floorLines: FloorLine[] = []
  design.blocks.forEach((b, i) => {
    layers.push(
      new PolygonLayer<PolyDatum>({
        id: `design-block-${b.id}-${i}`,
        data: [{ rings: b.footprintGeo.coordinates }],
        getPolygon: (d) => d.rings,
        filled: true,
        stroked: false,
        extruded: true,
        wireframe: false,
        // Blocks are drawn from the ground up; a tower's lower part is hidden inside the podium.
        getElevation: b.topM,
        getFillColor: DESIGN_FILL,
        getLineColor: DESIGN_LINE,
        material: { ambient: 0.5, diffuse: 0.65, shininess: 24, specularColor: [60, 50, 40] },
        pickable: false,
        ...placement,
      }),
    )
    const outer = b.footprintGeo.coordinates[0]
    for (let f = 0; f <= b.floors; f++) {
      const z = b.baseM + f * design.floorToFloorM
      if (z <= 0.01) continue
      for (const ring of b.footprintGeo.coordinates) {
        floorLines.push({ path: ring.map((p) => [p[0], p[1], z] as [number, number, number]) })
      }
    }
    void outer
  })
  layers.push(
    new PathLayer<FloorLine>({
      id: 'design-floor-lines',
      data: floorLines,
      getPath: (d) => d.path,
      getColor: DESIGN_LINE,
      getWidth: 1,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      pickable: false,
      parameters: { depthCompare: 'less-equal' },
      ...placement,
    }),
  )
  return layers
}
