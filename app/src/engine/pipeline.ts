/**
 * Rule pipeline: plot -> road setback -> boundary setback -> height cap -> FAR ->
 * open space -> envelope. Pure functions over the Y.10 rule set. All geometry work
 * is done in UTM 47N metres; GeoJSON in and out is WGS84.
 */
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { ringToMetric, toWgs84 } from './projection'
import { outerRing } from './plot'
import {
  closePolygon,
  erodePolygon,
  erodeToArea,
  polygonArea,
  polygonDifference,
  type MetricMultiPolygon,
  type MetricPolygon,
  toMetricRing,
} from './offset'
import { buildingTypeRules, getRule, ruleNumber } from '../rules/loadRules'
import type { BuildingType, BuildingTypeRules, Regime, ZoneRules } from '../rules/types'

export interface PipelineInputs {
  /** Plot polygon in WGS84, or null when nothing is drawn. */
  plot: Polygon | null
  /** Index of the road-facing edge in the plot's outer ring, or null if not picked yet. */
  frontEdgeIndex: number | null
  /** Public right-of-way of the road the front edge faces, metres. */
  roadWidthM: number
  buildingType: BuildingType
  /** Structural floor-to-floor height, metres (default 3.0 for residential). */
  floorToFloorM: number
}

export type StageId = 'plot' | 'roadSetback' | 'boundarySetback' | 'height' | 'far' | 'openSpace' | 'envelope'

export const STAGE_IDS: readonly StageId[] = ['plot', 'roadSetback', 'boundarySetback', 'height', 'far', 'openSpace', 'envelope']

/** Every stage returns geometry (WGS84, may be null) plus one-line annotations and the numbers it produced. */
export interface StageResult {
  id: StageId
  label: string
  geometry: Polygon | MultiPolygon | null
  annotations: string[]
  numbers: Record<string, number>
  /** Rule ids (keys into rules.rules) that produced these numbers. */
  sources: string[]
}

export type BindingRule = 'height' | 'far' | 'footprint'
export type FootprintLimit = 'setbacks' | 'openSpacePlot' | 'osr'

export interface Envelope {
  footprint: Polygon | null
  footprintAreaM2: number
  /** Height cap from the road rule (and the type's own cap), metres. */
  maxHeightM: number
  /** Built height = maxFloors x floorToFloorM, metres. */
  heightM: number
  maxFloors: number
  floorsByHeight: number
  floorsByFar: number
  /** FAR x plot area. */
  maxGfaM2: number
  /** Effective GFA cap actually applied: FAR cap, or lower when MR-33 ข้อ 2 road tier (30,000 m2) binds. */
  gfaCapM2: number
  gfaCapNote: string | null
  /** maxFloors x footprint area. */
  gfaM2: number
  openSpaceM2: number
  openSpaceRequiredM2: number
  /** footprint / plot area. */
  coverage: number
  bindingRule: BindingRule
  footprintLimitedBy: FootprintLimit
  parking: { spaces: number; areaM2: number; saleableGfaM2: number } | null
}

export interface RegimeSummary {
  regime: Regime
  label: string
  footprintAreaM2: number
  maxHeightM: number
  heightM: number
  maxFloors: number
  gfaM2: number
  note: string
}

/** Metric-frame (UTM 47N) geometry of the active regime, for designs and checks. */
export interface PipelineMetric {
  plot: MetricPolygon
  plotAreaM2: number
  frontEdgeIndex: number
  frontSetbackM: number
  boundarySetbackM: number
  /** Plot minus the road setback strip (null if consumed). */
  afterRoadSetback: MetricPolygon | null
  /** Plot minus road and boundary setbacks (null if consumed). */
  afterBoundarySetback: MetricPolygon | null
  /** Final envelope footprint after the open-space shrink (null if consumed). */
  footprint: MetricPolygon | null
}

export interface PipelineResult {
  /** False until a valid plot and a front edge exist. */
  ok: boolean
  stages: StageResult[]
  envelope: Envelope | null
  metric: PipelineMetric | null
  regime: Regime
  regimeReason: string
  /** Other regimes computed for comparison (what the standard route would give, etc.). */
  alternatives: RegimeSummary[]
  warnings: string[]
  annotations: string[]
}

export const EMPTY_PIPELINE_RESULT: PipelineResult = {
  ok: false,
  stages: [],
  envelope: null,
  metric: null,
  regime: 'standard',
  regimeReason: '',
  alternatives: [],
  warnings: [],
  annotations: [],
}

const EPS = 1e-6

interface Ctx {
  rules: ZoneRules
  type: BuildingType
  typeRules: BuildingTypeRules
  plotMetric: MetricPolygon
  plotAreaM2: number
  edgeCount: number
  frontEdgeIndex: number
  roadWidthM: number
  floorToFloorM: number
}

interface Caps {
  /** Keep built height strictly below this (used to show the "stay standard" alternative). */
  heightBelowM?: number
  /** Keep GFA strictly below this. */
  gfaBelowM2?: number
  /** One-line reason shown with the FAR stage when gfaBelowM2 comes from a rule (MR-33 ข้อ 2). */
  gfaCapNote?: string
}

interface RegimeComputation {
  regime: Regime
  stages: StageResult[]
  envelope: Envelope | null
  metric: PipelineMetric
}

const fmt = (n: number, d = 1) => Number(n.toFixed(d)).toLocaleString('en-GB')

// ---------------------------------------------------------------------------
// Rule lookups

/** MR-55 ข้อ 41 (BMA ข้อ 50) road setback from the road edge, second tier always applied. */
export function roadSetbackM(rules: ZoneRules, roadWidthM: number): { m: number; note: string } {
  const id = 'mr55-road-setback'
  const W = roadWidthM
  const anyLt6 = ruleNumber(rules, id, 'anyBuilding_roadLt6m_fromCentrelineM')
  const t2Lt10 = ruleNumber(rules, id, 'tier2_roadLt10m_fromCentrelineM')
  const t2Frac = ruleNumber(rules, id, 'tier2_road10to20m_fractionOfWidth_fromRoadEdge')
  const t2Gt20 = ruleNumber(rules, id, 'tier2_roadGt20m_fromRoadEdgeM')
  let tier2: number
  let note: string
  if (W < 10) {
    tier2 = Math.max(0, t2Lt10 - W / 2)
    note = `road ${fmt(W)} m < 10 m: building line >= ${t2Lt10} m from the road centreline = ${fmt(tier2, 2)} m from the road edge (MR-55 ข้อ 41(1))`
  } else if (W <= 20) {
    tier2 = W * t2Frac
    note = `road ${fmt(W)} m (10-20 m tier): >= 1/10 of the width = ${fmt(tier2, 2)} m from the road edge (MR-55 ข้อ 41(2))`
  } else {
    tier2 = t2Gt20
    note = `road ${fmt(W)} m > 20 m: >= ${t2Gt20} m from the road edge (MR-55 ข้อ 41(3))`
  }
  const tier1 = W < 6 ? Math.max(0, anyLt6 - W / 2) : 0
  if (tier1 > tier2) {
    return { m: tier1, note: `road ${fmt(W)} m < 6 m: any building >= ${anyLt6} m from the centreline = ${fmt(tier1, 2)} m from the edge (MR-55 ข้อ 41 วรรคแรก)` }
  }
  return { m: tier2, note }
}

/** MR-55 ข้อ 50 openings rule combined with BMA ข้อ 55 perimeter open space, by building height. */
export function boundarySetbackM(rules: ZoneRules, typeRules: BuildingTypeRules, heightM: number): { m: number; note: string } {
  const std = typeRules.setbacks.standard
  const le9 = ruleNumber(rules, 'mr55-boundary-openings', 'heightLe9m_M')
  const gt9 = ruleNumber(rules, 'mr55-boundary-openings', 'height9to23m_M')
  const openings = heightM <= 9 + EPS ? le9 : gt9
  let perimeter = 0
  for (const tier of std.perimeterOpenByHeight) {
    if (heightM <= tier.heightMaxM + EPS) {
      perimeter = tier.m
      break
    }
    perimeter = tier.m
  }
  const m = Math.max(openings, perimeter)
  const note =
    `building ${fmt(heightM)} m: walls with openings need ${openings} m from the boundary (MR-55 ข้อ 50), ` +
    `Bangkok perimeter open space ${perimeter} m (BMA-BL-2544 ข้อ 55); effective ${fmt(m, 2)} m`
  return { m, note }
}

// ---------------------------------------------------------------------------

function toGeoPolygon(poly: MetricPolygon | null): Polygon | null {
  if (!poly) return null
  return { type: 'Polygon', coordinates: closePolygon(poly).map((r) => r.map((p) => toWgs84([p[0], p[1]]) as Position)) }
}

function toGeoMulti(mp: MetricMultiPolygon): MultiPolygon | null {
  if (mp.length === 0) return null
  return { type: 'MultiPolygon', coordinates: mp.map((poly) => closePolygon(poly).map((r) => r.map((p) => toWgs84([p[0], p[1]]) as Position))) }
}

function perEdge(ctx: Ctx, front: number, other: number): number[] {
  const ds = new Array<number>(ctx.edgeCount).fill(other)
  ds[ctx.frontEdgeIndex] = front
  return ds
}

function computeRegime(ctx: Ctx, regime: Regime, caps: Caps = {}): RegimeComputation {
  const { rules, typeRules, plotAreaM2: A, roadWidthM: W, floorToFloorM: f2f } = ctx
  const stages: StageResult[] = []
  const far = rules.zone.far
  const osrFrac = rules.zone.osrPercent / 100
  const openPlotFrac = typeRules.openSpacePlotPercentMin / 100

  stages.push({
    id: 'plot',
    label: 'Plot',
    geometry: toGeoPolygon(ctx.plotMetric),
    annotations: [`Plot area ${fmt(A, 0)} m2 (planar, UTM 47N), ${ctx.edgeCount} edges, edge ${ctx.frontEdgeIndex + 1} faces a ${fmt(W)} m right-of-way.`],
    numbers: { plotAreaM2: A, roadWidthM: W },
    sources: ['road-width-definition', 'edge-classification'],
  })

  // --- Road setback and provisional height (height needs the front setback only).
  let sFront: number
  let roadNote: string
  let roadSources: string[]
  const hr = typeRules.setbacks.highRise
  if (regime === 'highRise' && hr) {
    sFront = hr.roadM
    roadNote = `High-rise / extra-large building: every part >= ${hr.roadM} m from the public road (MR-33 ข้อ 4) replaces the MR-55 road setback.`
    roadSources = ['mr33-clearance']
  } else {
    const r = roadSetbackM(rules, W)
    sFront = r.m
    roadNote = `Second-tier road setback (building > 2 storeys or > 8 m): ${r.note}.`
    roadSources = ['mr55-road-setback']
  }

  const multiplier = ruleNumber(rules, 'mr55-height-road', 'multiplier')
  let hMax = multiplier * (W + sFront)
  const heightNotes = [
    `Height at any point <= ${multiplier} x distance to the far side of the road: ${multiplier} x (${fmt(W)} m right-of-way + ${fmt(sFront, 2)} m front setback) = ${fmt(hMax)} m, applied as a flat cap over the whole footprint (MR-55 ข้อ 44; BMA ข้อ 49).`,
  ]
  const heightSources = ['mr55-height-road', 'height-measurement', 'floor-to-floor']
  if (typeRules.maxHeightM !== undefined && typeRules.maxHeightM < hMax) {
    hMax = typeRules.maxHeightM
    heightNotes.push(`${typeRules.label.split(' (')[0]} is capped at ${typeRules.maxHeightM} m by its own definition.`)
  }
  heightNotes.push('Two-road / corner relief (MR-55 ข้อ 45-46) is not applied: the height is taken from the selected front road only.')

  // --- Boundary setback (standard regime depends on the building height it allows).
  let sBoundary: number
  let boundaryNote: string
  let boundarySources: string[]
  if (regime === 'highRise' && hr) {
    sBoundary = hr.boundaryM
    boundaryNote = `High-rise / extra-large building: >= ${hr.boundaryM} m from every neighbouring boundary, above and below ground (MR-33 ข้อ 4); also the 6 m fire-engine road around the building (MR-33 ข้อ 3).`
    boundarySources = ['mr33-clearance', 'mr33-fire-road']
  } else {
    const designHeight = caps.heightBelowM !== undefined ? Math.min(hMax, caps.heightBelowM - EPS) : hMax
    const b = boundarySetbackM(rules, typeRules, designHeight)
    sBoundary = b.m
    boundaryNote = `Standard regime, ${b.note}.`
    boundarySources = ['mr55-boundary-openings', 'bma-perimeter-open']
  }

  // --- Geometry: erode the plot by the per-edge distances.
  const afterRoad = erodePolygon(ctx.plotMetric, perEdge(ctx, sFront, 0))
  const afterBoundary = erodePolygon(ctx.plotMetric, perEdge(ctx, sFront, sBoundary))
  // Bands for rendering: the road strip is drawn over the full setback band.
  const roadStrip = afterRoad.removed
  const boundaryBand = afterBoundary.removed

  stages.push({
    id: 'roadSetback',
    label: 'Road setback',
    geometry: toGeoMulti(roadStrip),
    annotations: [roadNote, `Strip of ${fmt(sFront, 2)} m along the front edge removed (${fmt(A - (afterRoad.polygon ? polygonArea(afterRoad.polygon) : 0), 0)} m2).`],
    numbers: { frontSetbackM: sFront, areaAfterM2: afterRoad.polygon ? polygonArea(afterRoad.polygon) : 0 },
    sources: roadSources,
  })

  const setbackArea = afterBoundary.polygon ? polygonArea(afterBoundary.polygon) : 0
  const boundaryAnnotations = [boundaryNote, `Band of ${fmt(sBoundary, 2)} m along the other ${ctx.edgeCount - 1} edges removed; ${fmt(setbackArea, 0)} m2 remain (${fmt((100 * setbackArea) / A, 0)}% of the plot).`]
  if (afterBoundary.pieces > 1) boundaryAnnotations.push(`Setbacks split the plot into ${afterBoundary.pieces} pieces; the largest is kept (${fmt(afterBoundary.droppedAreaM2, 0)} m2 dropped).`)
  if (!afterBoundary.polygon) boundaryAnnotations.push('Setbacks consume the plot: nothing can be built within these offsets.')
  stages.push({
    id: 'boundarySetback',
    label: 'Boundary setback',
    geometry: toGeoMulti(boundaryBand),
    annotations: boundaryAnnotations,
    numbers: { boundarySetbackM: sBoundary, setbackFootprintAreaM2: setbackArea, pieces: afterBoundary.pieces },
    sources: boundarySources,
  })

  // --- Height / floors.
  let floorsByHeight = Math.floor(hMax / f2f + EPS)
  if (typeRules.maxStoreys !== undefined) floorsByHeight = Math.min(floorsByHeight, typeRules.maxStoreys)
  if (caps.heightBelowM !== undefined) floorsByHeight = Math.min(floorsByHeight, Math.ceil(caps.heightBelowM / f2f - EPS) - 1)
  floorsByHeight = Math.max(0, floorsByHeight)
  heightNotes.push(`Floors by height = floor(${fmt(hMax)} / ${fmt(f2f, 2)}) = ${floorsByHeight}${typeRules.maxStoreys !== undefined ? `, capped at ${typeRules.maxStoreys} storeys for this type` : ''}. Height is measured to the roof-deck floor; parapets and roof plant are ignored.`)
  stages.push({
    id: 'height',
    label: 'Height cap',
    geometry: null,
    annotations: heightNotes,
    numbers: { maxHeightM: hMax, floorsByHeight, floorToFloorM: f2f },
    sources: heightSources,
  })

  // --- FAR.
  const gfaMax = far * A
  const farNotes = [
    `Gross floor area <= FAR ${far} x ${fmt(A, 0)} m2 = ${fmt(gfaMax, 0)} m2 (BMA-CP ข้อ 17). All storeys count, parking and basements included; FAR bonuses (up to +20%) are not applied.`,
  ]
  if (regime === 'highRise') farNotes.push(`MR-33 ข้อ 5 cap of FAR ${ruleNumber(rules, 'mr33-far-cap', 'far')} does not bind (zone FAR ${far} is lower).`)
  if (caps.gfaCapNote) farNotes.push(caps.gfaCapNote)
  stages.push({
    id: 'far',
    label: 'Floor area ratio',
    geometry: null,
    annotations: farNotes,
    numbers: { far, maxGfaM2: gfaMax },
    sources: ['zone-far', 'far-counts-all-floors', 'far-bonus-ignored'],
  })

  // --- Open space: 30% of plot (residential) first, then OSR 4% of the actual GFA.
  const requiredByPlot = openPlotFrac * A
  let footprint = afterBoundary.polygon
  let footprintLimitedBy: FootprintLimit = 'setbacks'
  let shrinkM = 0
  const openNotes = [
    `Open (unroofed) ground >= ${typeRules.openSpacePlotPercentMin}% of plot = ${fmt(requiredByPlot, 0)} m2 [BMA-BL-2544 ข้อ 52(1), MR-33 ข้อ 6], so footprint <= ${fmt(A - requiredByPlot, 0)} m2; and >= ${rules.zone.osrPercent}% of gross floor area [BMA-CP ข้อ 17(2)].`,
  ]
  const floorsFor = (F: number): number => {
    let k = Math.floor(gfaMax / F + EPS)
    if (caps.gfaBelowM2 !== undefined) k = Math.min(k, Math.ceil(caps.gfaBelowM2 / F - EPS) - 1)
    return Math.max(0, Math.min(floorsByHeight, k))
  }
  let targetF = Math.min(setbackArea, A - requiredByPlot)
  if (footprint && setbackArea > targetF + 0.5) footprintLimitedBy = 'openSpacePlot'
  // OSR: A - F >= osr x k(F) x F  ->  F <= A / (1 + osr x k). k is non-increasing in F, so iterate.
  if (footprint && targetF > 0) {
    for (let i = 0; i < 10; i++) {
      const k = floorsFor(targetF)
      const fOsr = A / (1 + osrFrac * k)
      if (targetF <= fOsr + 1e-6) break
      targetF = fOsr
      footprintLimitedBy = 'osr'
    }
  }
  if (footprint && setbackArea > targetF + 0.5) {
    const shrunk = erodeToArea(footprint, targetF)
    footprint = shrunk.polygon
    shrinkM = shrunk.offsetM
    openNotes.push(
      `Setback footprint ${fmt(setbackArea, 0)} m2 exceeds the ${footprintLimitedBy === 'osr' ? `OSR limit (open space >= ${rules.zone.osrPercent}% of GFA)` : `${typeRules.openSpacePlotPercentMin}%-of-plot limit`} of ${fmt(targetF, 0)} m2, so it is shrunk by a further ${fmt(shrinkM, 2)} m all round to ${fmt(footprint ? polygonArea(footprint) : 0, 0)} m2.`,
    )
  } else if (footprint) {
    openNotes.push(`Setback footprint ${fmt(setbackArea, 0)} m2 already leaves ${fmt(A - setbackArea, 0)} m2 open (${fmt((100 * (A - setbackArea)) / A, 0)}% of the plot); no further shrink.`)
  }
  openNotes.push(`At least ${rules.zone.permeablePercentOfOpenSpace}% of the open space must be permeable planting ground.`)
  const shrinkBand = shrinkM > 0 ? polygonDifference(afterBoundary.polygon, footprint) : []
  const F = footprint ? polygonArea(footprint) : 0
  stages.push({
    id: 'openSpace',
    label: 'Open space / OSR',
    geometry: toGeoMulti(shrinkBand),
    annotations: openNotes,
    numbers: { openSpaceByPlotM2: requiredByPlot, footprintMaxM2: targetF, shrinkM, footprintAreaM2: F },
    sources: ['bcl-open-space-plot', 'zone-osr', 'osr-definition'],
  })

  const metric: PipelineMetric = {
    plot: ctx.plotMetric,
    plotAreaM2: A,
    frontEdgeIndex: ctx.frontEdgeIndex,
    frontSetbackM: sFront,
    boundarySetbackM: sBoundary,
    afterRoadSetback: afterRoad.polygon,
    afterBoundarySetback: afterBoundary.polygon,
    footprint: footprint && F >= 1 ? footprint : null,
  }

  // --- Envelope.
  if (!footprint || F < 1) {
    stages.push({
      id: 'envelope',
      label: 'Envelope',
      geometry: null,
      annotations: ['No buildable envelope: the setbacks and open-space rules consume the plot.'],
      numbers: { footprintAreaM2: 0, maxFloors: 0, gfaM2: 0 },
      sources: [],
    })
    return { regime, stages, envelope: null, metric }
  }

  let floorsByFar = Math.floor(gfaMax / F + EPS)
  if (caps.gfaBelowM2 !== undefined) floorsByFar = Math.min(floorsByFar, Math.ceil(caps.gfaBelowM2 / F - EPS) - 1)
  floorsByFar = Math.max(0, floorsByFar)
  const maxFloors = Math.min(floorsByHeight, floorsByFar)
  const heightM = maxFloors * f2f
  const gfa = maxFloors * F
  const required = Math.max(requiredByPlot, osrFrac * gfa)
  const bindingRule: BindingRule = floorsByHeight <= floorsByFar ? 'height' : 'far'
  const openSpace = A - F
  const parking =
    ctx.type === 'condo'
      ? (() => {
          const per = ruleNumber(rules, 'bma-parking-indicative', 'altRatioM2PerSpace')
          const m2PerSpace = ruleNumber(rules, 'bma-parking-indicative', 'm2PerSpaceInclAisles')
          const spaces = Math.ceil(gfa / per)
          const areaM2 = spaces * m2PerSpace
          return { spaces, areaM2, saleableGfaM2: Math.max(0, gfa - areaM2) }
        })()
      : null

  const envNotes = [
    `Footprint ${fmt(F, 0)} m2 x ${maxFloors} floors x ${fmt(f2f, 2)} m = ${fmt(heightM)} m, GFA ${fmt(gfa, 0)} m2 (${fmt((100 * gfa) / gfaMax, 0)}% of the FAR cap). ${bindingRule === 'height' ? 'Height binds' : 'FAR binds'} (by height ${floorsByHeight} floors, by FAR ${floorsByFar}).`,
    `Open space ${fmt(openSpace, 0)} m2 = ${fmt((100 * openSpace) / A, 0)}% of plot, OSR ${fmt((100 * openSpace) / Math.max(gfa, 1), 1)}% of GFA.`,
  ]
  if (parking) envNotes.push(`Indicative parking ${parking.spaces} spaces x ${ruleNumber(rules, 'bma-parking-indicative', 'm2PerSpaceInclAisles')} m2 = ${fmt(parking.areaM2, 0)} m2 inside the GFA; indicative saleable GFA ${fmt(parking.saleableGfaM2, 0)} m2.`)

  stages.push({
    id: 'envelope',
    label: 'Envelope',
    geometry: toGeoPolygon(footprint),
    annotations: envNotes,
    numbers: { footprintAreaM2: F, maxFloors, heightM, gfaM2: gfa, coverage: F / A },
    sources: ['mr55-height-road', 'zone-far', 'bcl-open-space-plot', ...(parking ? ['bma-parking-indicative'] : [])],
  })

  return {
    regime,
    stages,
    metric,
    envelope: {
      footprint: toGeoPolygon(footprint),
      footprintAreaM2: F,
      maxHeightM: hMax,
      heightM,
      maxFloors,
      floorsByHeight,
      floorsByFar,
      maxGfaM2: gfaMax,
      gfaCapM2: caps.gfaBelowM2 !== undefined ? Math.min(gfaMax, caps.gfaBelowM2 - 1e-6) : gfaMax,
      gfaCapNote: caps.gfaCapNote ?? null,
      gfaM2: gfa,
      openSpaceM2: openSpace,
      openSpaceRequiredM2: required,
      coverage: F / A,
      bindingRule,
      footprintLimitedBy,
      parking,
    },
  }
}

function summary(c: RegimeComputation, label: string, note: string): RegimeSummary {
  const e = c.envelope
  return {
    regime: c.regime,
    label,
    footprintAreaM2: e?.footprintAreaM2 ?? 0,
    maxHeightM: e?.maxHeightM ?? 0,
    heightM: e?.heightM ?? 0,
    maxFloors: e?.maxFloors ?? 0,
    gfaM2: e?.gfaM2 ?? 0,
    note,
  }
}

export function runPipeline(inputs: PipelineInputs, rules: ZoneRules): PipelineResult {
  const { plot, frontEdgeIndex } = inputs
  if (!plot) return EMPTY_PIPELINE_RESULT
  const ring = outerRing(plot)
  if (ring.length < 3) return EMPTY_PIPELINE_RESULT
  const metricRing = toMetricRing(ringToMetric(ring))
  const plotMetric: MetricPolygon = [metricRing]
  const A = polygonArea(plotMetric)

  if (frontEdgeIndex === null || frontEdgeIndex >= ring.length) {
    return {
      ...EMPTY_PIPELINE_RESULT,
      stages: [
        {
          id: 'plot',
          label: 'Plot',
          geometry: plot,
          annotations: [`Plot area ${fmt(A, 0)} m2. Pick the road-facing edge to run the setback, height and FAR rules.`],
          numbers: { plotAreaM2: A },
          sources: [],
        },
      ],
      annotations: ['Pick the front (road) edge to compute the envelope.'],
    }
  }
  if (!(inputs.roadWidthM > 0) || !(inputs.floorToFloorM > 0)) return EMPTY_PIPELINE_RESULT

  const typeRules = buildingTypeRules(rules, inputs.buildingType)
  const ctx: Ctx = {
    rules,
    type: inputs.buildingType,
    typeRules,
    plotMetric,
    plotAreaM2: A,
    edgeCount: ring.length,
    frontEdgeIndex,
    roadWidthM: inputs.roadWidthM,
    floorToFloorM: inputs.floorToFloorM,
  }

  const hrHeight = rules.thresholds.highRiseHeightM
  const hrGfa = rules.thresholds.extraLargeGfaM2
  const warnings: string[] = []
  if (inputs.floorToFloorM < typeRules.floorToFloorMinM - EPS) {
    warnings.push(`Floor-to-floor ${fmt(inputs.floorToFloorM, 2)} m is below the legal minimum ${typeRules.floorToFloorMinM} m for dwellings (MR-55 ข้อ 22).`)
  }

  let standard: RegimeComputation
  try {
    standard = computeRegime(ctx, 'standard')
  } catch (err) {
    return geometryFailure(plot, A, err)
  }
  const canHighRise = Boolean(typeRules.setbacks.highRise)
  const e = standard.envelope
  const crossesHeight = e !== null && e.heightM >= hrHeight - EPS
  const crossesGfa = e !== null && e.gfaM2 >= hrGfa - EPS

  if (canHighRise && (crossesHeight || crossesGfa)) {
    const why = [
      crossesHeight ? `height ${fmt(e!.heightM)} m >= ${hrHeight} m` : null,
      crossesGfa ? `GFA ${fmt(e!.gfaM2, 0)} m2 >= ${fmt(hrGfa, 0)} m2` : null,
    ]
      .filter(Boolean)
      .join(' and ')
    // MR-33 ข้อ 2 road access: no high-rise at all on a road under 10 m; GFA <= 30,000 m2 under 18 m.
    const rowSmall = ruleNumber(rules, 'mr33-road-access', 'minRowM_gfaLe30000')
    const rowBig = ruleNumber(rules, 'mr33-road-access', 'minRowM_gfaGt30000')
    const tierGfa = rules.thresholds.mr33RoadTierGfaM2
    const W = inputs.roadWidthM

    if (W < rowSmall - EPS) {
      let capped: RegimeComputation
      try {
        capped = computeRegime(ctx, 'standard', { heightBelowM: hrHeight, gfaBelowM2: hrGfa })
      } catch (err) {
        return geometryFailure(plot, A, err)
      }
      const reason = `Standard setbacks would reach ${why}, but an อาคารสูง / อาคารขนาดใหญ่พิเศษ needs a public road with right-of-way >= ${rowSmall} m (MR-33 ข้อ 2) and this road is ${fmt(W)} m. The envelope is therefore held under ${hrHeight} m and ${fmt(hrGfa, 0)} m2 in the standard regime.`
      return {
        ok: capped.envelope !== null,
        stages: capped.stages,
        envelope: capped.envelope,
        metric: capped.metric,
        regime: 'standard',
        regimeReason: reason,
        alternatives: [summary(standard, 'Standard setbacks, uncapped (not permitted)', `Would reach ${why}, which needs a >= ${rowSmall} m road; shown only to explain the cap.`)],
        warnings: [...warnings, `Road right-of-way ${fmt(W)} m < ${rowSmall} m: high-rise / extra-large buildings are not permitted on this plot (MR-33 ข้อ 2).`],
        annotations: [reason],
      }
    }

    const hrCaps: Caps =
      W < rowBig - EPS
        ? { gfaBelowM2: tierGfa + 1e-6, gfaCapNote: `MR-33 ข้อ 2: a road under ${rowBig} m right-of-way (here ${fmt(W)} m) limits the building to ${fmt(tierGfa, 0)} m2 of gross floor area.` }
        : {}
    let highRise: RegimeComputation
    let capped: RegimeComputation
    try {
      highRise = computeRegime(ctx, 'highRise', hrCaps)
      capped = computeRegime(ctx, 'standard', { heightBelowM: hrHeight, gfaBelowM2: hrGfa })
    } catch (err) {
      return geometryFailure(plot, A, err)
    }
    const reason = `Standard-regime envelope reaches ${why}, so the building is อาคารสูง / อาคารขนาดใหญ่พิเศษ and MR-33 applies (6 m clearance all round, road right-of-way >= ${rowSmall} m with 12 m frontage, fire road). Recomputed in the high-rise regime.`
    const hrWarnings = [...warnings]
    if (hrCaps.gfaCapNote && highRise.envelope && highRise.envelope.floorsByFar < highRise.envelope.floorsByHeight && highRise.envelope.gfaM2 >= tierGfa - highRise.envelope.footprintAreaM2) {
      hrWarnings.push(`GFA capped at ${fmt(tierGfa, 0)} m2 because the road is under ${rowBig} m (MR-33 ข้อ 2); a wider road would allow the full FAR ${rules.zone.far}.`)
    }
    return {
      ok: highRise.envelope !== null,
      stages: highRise.stages,
      envelope: highRise.envelope,
      metric: highRise.metric,
      regime: 'highRise',
      regimeReason: reason,
      alternatives: [
        summary(capped, 'Standard regime, kept under 23 m and 10,000 m2', 'What the plot yields if the building stays below both MR-33 thresholds (standard setbacks, fewer floors).'),
        summary(standard, 'Standard setbacks, uncapped (not permitted)', `Standard setbacks with the full height cap would reach ${why}; shown only to explain the regime switch.`),
      ],
      warnings: hrWarnings,
      annotations: [reason],
    }
  }

  const reason = canHighRise
    ? `Standard-regime envelope stays under ${hrHeight} m and ${fmt(hrGfa, 0)} m2 (height ${fmt(e?.heightM ?? 0)} m, GFA ${fmt(e?.gfaM2 ?? 0, 0)} m2), so MR-33 does not apply.`
    : `${typeRules.label.split(' (')[0]}: standard regime only (max ${typeRules.maxStoreys ?? '-'} storeys, ${typeRules.maxHeightM ?? '-'} m).`
  return {
    ok: standard.envelope !== null,
    stages: standard.stages,
    envelope: standard.envelope,
    metric: standard.metric,
    regime: 'standard',
    regimeReason: reason,
    alternatives: [],
    warnings,
    annotations: [reason],
  }
}

/** A boolean-geometry failure must never take the app down: report it as a warning. */
function geometryFailure(plot: Polygon, areaM2: number, err: unknown): PipelineResult {
  const message = err instanceof Error ? err.message : String(err)
  return {
    ...EMPTY_PIPELINE_RESULT,
    stages: [
      { id: 'plot', label: 'Plot', geometry: plot, annotations: [`Plot area ${fmt(areaM2, 0)} m2.`], numbers: { plotAreaM2: areaM2 }, sources: [] },
      { id: 'envelope', label: 'Envelope', geometry: null, annotations: [`Geometry engine could not offset this outline (${message}). Try moving a vertex slightly.`], numbers: {}, sources: [] },
    ],
    warnings: [`Geometry engine could not offset this outline: ${message}`],
    annotations: ['The setback geometry failed on this outline; nudge a vertex and it will recompute.'],
  }
}

/** Source text for a rule id, for the UI. */
export function ruleSource(rules: ZoneRules, id: string): string {
  try {
    return getRule(rules, id).source
  } catch {
    return id
  }
}
