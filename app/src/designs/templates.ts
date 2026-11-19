/**
 * Massing templates: (envelope, rules, inputs, overrides) -> Design | null. Pure.
 * All geometry in UTM metres; WGS84 copies are attached for rendering only.
 */
import type { Polygon, Position } from 'geojson'
import { closePolygon, erodePolygon, erodeToArea, largestPiece, polygonArea, polygonIntersection, type MetricPolygon } from '../engine/offset'
import { dropClosingPoint, pointToSegmentDistance, ringPerimeter } from '../engine/geometry'
import { frontage, isFronting } from '../engine/frontage'
import type { PipelineInputs, PipelineResult } from '../engine/pipeline'
import { toWgs84 } from '../engine/projection'
import { ruleNumber } from '../rules/loadRules'
import type { ZoneRules } from '../rules/types'
import {
  COURTYARD_DEPTH_M,
  COURTYARD_GFA_TARGET_FRACTION,
  COURTYARD_MIN_FOOTPRINT_M2,
  PODIUM_FLOORS_DEFAULT,
  TOWER_MIN_AREA_M2,
  TOWER_MIN_WIDTH_M,
  type Block,
  type Design,
  type DesignId,
  type DesignLimit,
  type DesignOverrideMap,
  type DesignOverrides,
} from './types'

const fmt = (n: number, d = 0) => Number(n.toFixed(d)).toLocaleString('en-GB')

export function metricToGeo(poly: MetricPolygon): Polygon {
  return { type: 'Polygon', coordinates: closePolygon(poly).map((r) => r.map((p) => toWgs84([p[0], p[1]]) as Position)) }
}

/** True when the polygon is at least `minWidthM` wide everywhere (it survives erosion by half that). */
export function hasMinWidth(poly: MetricPolygon, minWidthM: number): boolean {
  return erodePolygon([poly[0]], minWidthM / 2, { withRemoved: false }).polygon !== null
}

function erodeFrom(source: MetricPolygon, offsets: number[], extraM: number): MetricPolygon | null {
  return erodePolygon(source, offsets.map((d) => d + extraM), { withRemoved: false }).polygon
}

/** Erosion of `source` by `offsets + extra`, memoised by extra (one template run probes the same offsets repeatedly). */
type Eroder = (extraM: number) => MetricPolygon | null
function cachedEroder(source: MetricPolygon, offsets: number[]): Eroder {
  const cache = new Map<string, MetricPolygon | null>()
  return (extraM: number) => {
    const key = extraM.toFixed(4)
    if (!cache.has(key)) cache.set(key, erodeFrom(source, offsets, extraM))
    return cache.get(key) ?? null
  }
}

interface TemplateContext {
  pipeline: PipelineResult
  rules: ZoneRules
  inputs: PipelineInputs
  /** Footprint the design starts from: the envelope footprint, or the plot itself when setbacks are ignored. */
  base: MetricPolygon
  baseAreaM2: number
  /** The plot and the per-edge offsets that produce `base` from it (zeros when setbacks are ignored). */
  plot: MetricPolygon
  baseOffsets: number[]
  plotAreaM2: number
  maxFloors: number
  floorsByHeight: number
  /** Effective GFA cap (FAR, or the MR-33 road tier when lower). */
  maxGfaM2: number
  /** OSR: open space >= osrFrac x GFA. */
  osrFrac: number
  f2f: number
  overrides: DesignOverrides
  /** Memoised erosion of `plot` by `baseOffsets + extra`. */
  erode: Eroder
  /** Set when the design plot was cut back from the road to satisfy the ข้อ 53 frontage test. */
  frontageNote: string | null
}

/** Same test expressed on the plot + offsets, so no rounded footprint is ever re-eroded. */
function hasMinWidthFrom(ctx: TemplateContext, extraM: number, minWidthM: number): boolean {
  return ctx.erode(extraM + minWidthM / 2) !== null
}

/** Largest GFA the OSR allows for a given ground footprint: (plot - footprint) / osr. */
function osrGfaMax(ctx: TemplateContext, groundAreaM2: number): number {
  return ctx.osrFrac > 0 ? Math.max(0, ctx.plotAreaM2 - groundAreaM2) / ctx.osrFrac : Infinity
}

function block(id: string, label: string, footprint: MetricPolygon, baseM: number, floors: number, f2f: number): Block {
  return {
    id,
    label,
    footprint,
    footprintGeo: metricToGeo(footprint),
    areaM2: polygonArea(footprint),
    baseM,
    topM: baseM + floors * f2f,
    floors,
  }
}

function finish(
  id: DesignId,
  name: string,
  description: string,
  ctx: TemplateContext,
  blocks: Block[],
  groundFootprint: MetricPolygon,
  notes: string[],
  limitedBy: DesignLimit,
  defaultFloors: number,
): Design {
  const footprintAreaM2 = polygonArea(groundFootprint)
  const gfaM2 = blocks.reduce((s, b) => s + b.areaM2 * b.floors, 0)
  const heightM = blocks.reduce((m, b) => Math.max(m, b.topM), 0)
  const floors = Math.round(heightM / ctx.f2f)
  if (ctx.frontageNote) notes.push(ctx.frontageNote)
  if (ctx.overrides.ignoreSetbacks) notes.push('Setbacks ignored by user override: the design uses the whole plot, so the setback rows will fail.')
  return {
    id,
    name,
    description,
    footprint: groundFootprint,
    footprintGeo: metricToGeo(groundFootprint),
    footprintAreaM2,
    floors,
    floorToFloorM: ctx.f2f,
    heightM,
    gfaM2,
    openSpaceM2: Math.max(0, ctx.plotAreaM2 - footprintAreaM2),
    coverage: footprintAreaM2 / ctx.plotAreaM2,
    blocks,
    notes,
    limitedBy,
    defaults: { floors: defaultFloors },
    overrides: ctx.overrides,
  }
}

/** 1. Full-envelope slab: footprint = envelope footprint, floors = envelope maximum. */
export function slabTemplate(ctx: TemplateContext): Design | null {
  if (ctx.maxFloors < 1) return null
  const floors = ctx.overrides.floors ?? ctx.maxFloors
  const b = block('slab', 'Slab', ctx.base, 0, floors, ctx.f2f)
  const notes = [`Footprint ${ctx.frontageNote ? 'is the envelope footprint cut back from the rear' : 'equals the envelope footprint'} (${fmt(b.areaM2)} m2), ${floors} floors x ${ctx.f2f} m.`]
  const limitedBy: DesignLimit = ctx.overrides.floors !== undefined ? 'override' : ctx.pipeline.envelope?.bindingRule === 'far' ? 'far' : 'height'
  if (limitedBy === 'override') notes.push(`Floors overridden by user (template default ${ctx.maxFloors}).`)
  return finish('slab', 'Full-envelope slab', 'The envelope built out as one block: maximum footprint, maximum floors.', ctx, [b], ctx.base, notes, limitedBy, ctx.maxFloors)
}

/**
 * 2. Tower on podium: 2-floor podium on the full footprint, tower on a slimmer footprint
 * rising to the height cap, with the tower area chosen so the total GFA meets the target
 * min(FAR cap, height-bound GFA). If the tower would be thinner than 12 m or under 400 m2,
 * the tower is kept at that minimum and its floors are reduced instead.
 */
export function podiumTowerTemplate(ctx: TemplateContext): Design | null {
  let podiumFloors = PODIUM_FLOORS_DEFAULT
  if (ctx.floorsByHeight <= podiumFloors) return null
  const F = ctx.baseAreaM2
  const heightBoundGfa = ctx.floorsByHeight * F
  const farBound = ctx.maxGfaM2 < heightBoundGfa - 1e-6
  const notes: string[] = []
  let limitedBy: DesignLimit = farBound ? 'far' : 'height'

  // Target GFA and the tower area that achieves it with the maximum tower floors.
  // OSR (4% of GFA) also caps the GFA for this ground footprint.
  const osrCap = osrGfaMax(ctx, F)
  let target = Math.min(ctx.maxGfaM2, heightBoundGfa, osrCap)
  if (osrCap < Math.min(ctx.maxGfaM2, heightBoundGfa) - 1e-6) {
    notes.push(`OSR caps the GFA at ${fmt(osrCap)} m2 for this footprint (open space must be >= ${Math.round(ctx.osrFrac * 100)}% of GFA).`)
  }
  if (!farBound) {
    // Height-bound: a slimmer tower only loses floor area; keep 92% of the envelope GFA for articulation.
    target = 0.92 * heightBoundGfa
    notes.push('Height-bound: the tower could use the full footprint; it is slimmed slightly for articulation, which costs floor area.')
  } else {
    notes.push('FAR-bound: the tower rises to the height cap on a footprint sized so that podium + tower GFA equals the FAR cap.')
  }
  // Never let the podium alone exceed the GFA target (e.g. a large plot held under 10,000 m2 on a
  // narrow road): drop podium floors to what the target allows, and give up when not even one fits.
  // (Skipped when setbacks are ignored: that override exists to produce a failing design.)
  const strict = !ctx.overrides.ignoreSetbacks
  if (strict && podiumFloors * F > target + 0.5) {
    podiumFloors = Math.floor(target / F + 1e-9)
    if (podiumFloors < 1 || ctx.floorsByHeight <= podiumFloors) return null
    notes.push(`The GFA target (${fmt(target)} m2) does not fit a ${PODIUM_FLOORS_DEFAULT}-floor podium on ${fmt(F)} m2, so the podium is ${podiumFloors} floor${podiumFloors > 1 ? 's' : ''}.`)
  }
  const towerFloorsMax = ctx.floorsByHeight - podiumFloors
  let towerArea = (target - podiumFloors * F) / towerFloorsMax
  let towerFloors = towerFloorsMax
  let tower: MetricPolygon | null = null

  if (towerArea >= F - 1e-6) {
    tower = ctx.base
    towerArea = F
  } else if (towerArea >= TOWER_MIN_AREA_M2) {
    // Aim a little under the exact area so search tolerance x tower floors never exceeds the FAR cap;
    // the search only ever stops at or under the target, so a 0.2% tolerance just under-fills slightly.
    const shrunk = erodeToArea(ctx.plot, ctx.baseOffsets, Math.max(towerArea - 0.2, 1), Math.max(0.05, 0.002 * towerArea), 8, true)
    tower = shrunk.polygon
  }
  // Width test on the tower polygon itself (erosion of a nearly convex polygon: cheap).
  const thin = !tower || polygonArea(tower) < TOWER_MIN_AREA_M2 - 0.5 || !hasMinWidth(tower, TOWER_MIN_WIDTH_M)
  if (thin) {
    // Find the slimmest tower that is still >= 12 m wide and >= 400 m2, then cut floors to meet the target.
    const minimal = largestOffsetKeepingWidth(ctx, TOWER_MIN_WIDTH_M, TOWER_MIN_AREA_M2)
    if (!minimal) return null
    tower = minimal
    towerArea = polygonArea(tower)
    towerFloors = Math.min(towerFloorsMax, Math.floor((target - podiumFloors * F) / towerArea + 1e-9))
    // Not even one floor of the minimum tower fits under the target: no tower-on-podium here.
    if (towerFloors < 1) {
      if (strict) return null
      towerFloors = 1
    }
    limitedBy = 'thinness'
    notes.push(`Thinness-limited: a tower sized for the GFA target would be under ${TOWER_MIN_WIDTH_M} m wide or ${TOWER_MIN_AREA_M2} m2, so the tower keeps ${fmt(towerArea)} m2 and drops to ${towerFloors} floors.`)
  }
  if (!tower) return null

  const defaultFloors = podiumFloors + towerFloors
  let totalFloors = defaultFloors
  if (ctx.overrides.floors !== undefined) {
    totalFloors = ctx.overrides.floors
    limitedBy = 'override'
    notes.push(`Floors overridden by user (template default ${defaultFloors}).`)
  }
  const blocks: Block[] = []
  const podiumF = Math.min(podiumFloors, totalFloors)
  blocks.push(block('podium', 'Podium', ctx.base, 0, podiumF, ctx.f2f))
  const towerF = totalFloors - podiumF
  if (towerF > 0) blocks.push(block('tower', 'Tower', tower, podiumF * ctx.f2f, towerF, ctx.f2f))
  notes.unshift(`Podium ${podiumF} floors on ${fmt(F)} m2, tower ${towerF} floors on ${fmt(towerArea)} m2 (${fmt((100 * towerArea) / F)}% of the footprint).`)
  return finish('podiumTower', 'Tower on podium', 'Two-storey podium over the whole footprint with a slimmer tower rising to the height cap.', ctx, blocks, ctx.base, notes, limitedBy, defaultFloors)
}

/**
 * Largest extra inward offset s (on top of the base footprint) whose erosion is still at
 * least `minWidthM` wide and `minAreaM2` large. Both conditions are monotone in s, so
 * s* = min(s_area, s_width).
 *
 * Every probe erodes the deepest already-computed polygon below it by the remaining distance
 * (erosion composes; the deeper polygon is nearly convex, so a probe costs a few ms instead
 * of a full erosion of a many-vertex concave plot), and results are cached by offset.
 * s_area: bracketed regula falsi (Illinois) on area(s) - minArea seeded by
 * s0 = (A - minArea) / perimeter; s_width: bisection on "erosion at s + width/2 is non-empty"
 * below s_area, only when the width binds. Typically 6-10 cheap probes.
 */
function largestOffsetKeepingWidth(ctx: TemplateContext, minWidthM: number, minAreaM2: number): MetricPolygon | null {
  const half = minWidthM / 2
  const start = ctx.erode(0)
  if (!start || polygonArea(start) < minAreaM2 - 0.5) return null
  const probes: Array<{ s: number; poly: MetricPolygon | null }> = [{ s: 0, poly: [start[0]] }]
  const probe = (s: number): MetricPolygon | null => {
    let from = probes[0]
    for (const p of probes) {
      if (Math.abs(p.s - s) < 1e-4) return p.poly
      if (p.s < s && !p.poly) return null // monotone: already empty below s
      if (p.s < s && p.s > from.s) from = p
    }
    // From s = 0 erode the source plot (few vertices); from a deeper probe erode that polygon.
    const poly = from.s === 0 ? ctx.erode(s) : from.poly ? erodePolygon([from.poly[0]], s - from.s, { withRemoved: false }).polygon : null
    probes.push({ s, poly })
    return poly
  }
  const area = (s: number) => {
    const p = probe(s)
    return p ? polygonArea(p) : 0
  }
  const wide = (s: number): boolean => {
    const p = probe(s)
    return p !== null && erodePolygon([p[0]], half, { withRemoved: false }).polygon !== null
  }
  if (!wide(0)) return null

  // s_area: area(s) >= minArea, as large as possible; stop within 5% above it (a 400-420 m2 tower).
  const areaTol = 0.05 * minAreaM2
  const A0 = polygonArea(start)
  let lo = 0
  let fLo = A0 - minAreaM2
  let hi = Math.max(0.05, (A0 - minAreaM2) / Math.max(1e-6, ringPerimeter(start[0])))
  let fHi = area(hi) - minAreaM2
  for (let k = 0; fHi > 0 && k < 10; k++) {
    lo = hi
    fLo = fHi
    // Next probe from the local slope (area falls roughly linearly with the current perimeter).
    const p = probe(lo)
    const step = p ? fLo / Math.max(1e-6, ringPerimeter(p[0])) : hi
    hi = lo + Math.min(Math.max(step * 1.15, 0.05), hi)
    fHi = area(hi) - minAreaM2
  }
  let side = 0
  for (let i = 0; i < 12 && fHi <= 0 && hi - lo > 0.05 && fLo > areaTol; i++) {
    const s = (lo * fHi - hi * fLo) / (fHi - fLo)
    const f = area(s) - minAreaM2
    if (f > 0) {
      lo = s
      fLo = f
      if (side === -1) fHi /= 2
      side = -1
    } else {
      hi = s
      fHi = f
      if (side === 1) fLo /= 2
      side = 1
    }
  }
  let sStar = lo
  // s_width: only searched when the area-optimal tower is too thin.
  if (!wide(sStar)) {
    let wLo = 0
    let wHi = sStar
    for (let i = 0; i < 10 && wHi - wLo > 0.05; i++) {
      const mid = (wLo + wHi) / 2
      if (wide(mid)) wLo = mid
      else wHi = mid
    }
    sStar = wLo
  }
  return probe(sStar)
}

/**
 * 3. Courtyard block: the footprint minus an inner void (everything deeper than 10 m from
 * the footprint edge), only when the footprint exceeds 1,500 m2. Floors = min(envelope
 * maximum, floors needed for 80% of the FAR cap).
 */
export function courtyardTemplate(ctx: TemplateContext): Design | null {
  if (ctx.baseAreaM2 <= COURTYARD_MIN_FOOTPRINT_M2) return null
  const inner = ctx.erode(COURTYARD_DEPTH_M)
  if (!inner) return null
  const ring: MetricPolygon = [ctx.base[0], inner[0]]
  const ringArea = polygonArea(ring)
  if (ringArea < 1) return null
  const needed = Math.ceil((COURTYARD_GFA_TARGET_FRACTION * ctx.maxGfaM2) / ringArea - 1e-9)
  const byOsr = Math.floor(osrGfaMax(ctx, ringArea) / ringArea + 1e-9)
  const defaultFloors = Math.max(1, Math.min(ctx.maxFloors, needed, byOsr))
  const floors = ctx.overrides.floors ?? defaultFloors
  const b = block('court', 'Courtyard block', ring, 0, floors, ctx.f2f)
  const courtMinOk = hasMinWidthFrom(ctx, COURTYARD_DEPTH_M, 6)
  const notes = [
    `${COURTYARD_DEPTH_M} m deep block around a ${fmt(polygonArea(inner))} m2 court; ${floors} floors (${needed <= ctx.maxFloors ? `${needed} needed for ${COURTYARD_GFA_TARGET_FRACTION * 100}% of the FAR cap` : `capped by the envelope at ${ctx.maxFloors}`}).`,
    courtMinOk
      ? 'Court is at least 6 m across, so windows facing each other across it satisfy MR-55 ข้อ 48 (informational; one building, so ข้อ 48 strictly concerns separate blocks).'
      : 'Court is under 6 m across in places: facing windows would breach the MR-55 ข้อ 48 spacing used as guidance.',
  ]
  const limitedBy: DesignLimit = ctx.overrides.floors !== undefined ? 'override' : needed <= ctx.maxFloors ? 'far' : 'height'
  if (limitedBy === 'override') notes.push(`Floors overridden by user (template default ${defaultFloors}).`)
  return finish('courtyard', 'Courtyard block', 'A perimeter block around an open court: high coverage, lower height.', ctx, [b], ring, notes, limitedBy, defaultFloors)
}

const TEMPLATES: Record<DesignId, (ctx: TemplateContext) => Design | null> = {
  slab: slabTemplate,
  podiumTower: podiumTowerTemplate,
  courtyard: courtyardTemplate,
}

/**
 * Cuts the plot back to `depthM` from the front-edge line (the strip of the plot within
 * that depth of the road). Returns the cut plot and per-edge offsets: original edges keep
 * their offset, the new rear cut edge gets 0 (so erosion of the cut plot = envelope
 * footprint intersected with the strip). Null when the front edge does not survive.
 */
function cutPlotToDepth(plot: MetricPolygon, offsets: number[], frontIdx: number, depthM: number): { plot: MetricPolygon; offsets: number[] } | null {
  const ring = dropClosingPoint(plot[0])
  const n = ring.length
  const a = ring[frontIdx]
  const b = ring[(frontIdx + 1) % n]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len === 0) return null
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  let nx = -uy
  let ny = ux
  let cx = 0
  let cy = 0
  for (const p of ring) {
    cx += p[0] / n
    cy += p[1] / n
  }
  if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  const L = ringPerimeter(ring)
  const strip: MetricPolygon = [
    [
      [a[0] - ux * L - nx, a[1] - uy * L - ny],
      [b[0] + ux * L - nx, b[1] + uy * L - ny],
      [b[0] + ux * L + nx * depthM, b[1] + uy * L + ny * depthM],
      [a[0] - ux * L + nx * depthM, a[1] - uy * L + ny * depthM],
    ],
  ]
  let cut: MetricPolygon | null
  try {
    cut = largestPiece(polygonIntersection([ring as [number, number][]], strip)).polygon
  } catch {
    return null
  }
  if (!cut) return null
  const outer = dropClosingPoint(cut[0]) as [number, number][]
  const outOffsets: number[] = []
  let hasFront = false
  for (let k = 0; k < outer.length; k++) {
    const p = outer[k]
    const q = outer[(k + 1) % outer.length]
    let d = 0
    for (let i = 0; i < n; i++) {
      const e0 = ring[i]
      const e1 = ring[(i + 1) % n]
      if (pointToSegmentDistance(p, e0, e1) < 1e-4 && pointToSegmentDistance(q, e0, e1) < 1e-4) {
        d = offsets[i]
        if (i === frontIdx) hasFront = true
        break
      }
    }
    outOffsets.push(d)
  }
  return hasFront ? { plot: [outer], offsets: outOffsets } : null
}

interface DesignPlot {
  plot: MetricPolygon
  offsets: number[]
  base: MetricPolygon
  note: string | null
}

/**
 * BMA-BL-2544 ข้อ 53: a building over the exemption height must front the public way, i.e.
 * its road-facing line must exceed 1/8 of its outer perimeter. A deep, narrow envelope fails
 * that, so the designs are built on the plot cut back to the deepest depth from the road at
 * which the footprint still fronts the way (bisection on the depth). If no depth works the
 * uncut envelope is used and the checklist flags it.
 */
function frontagePlot(pipeline: PipelineResult, rules: ZoneRules): DesignPlot | null {
  const metric = pipeline.metric
  const env = pipeline.envelope
  if (!metric || !metric.footprint || !env) return null
  const plain: DesignPlot = { plot: metric.plot, offsets: metric.footprintOffsets, base: [metric.footprint[0]], note: null }
  if (env.floorsByHeight <= ruleNumber(rules, 'bma-frontage', 'exemptResidentialMaxStoreys')) return plain
  const ring = dropClosingPoint(metric.plot[0])
  const fi = metric.frontEdgeIndex
  const front: [Position, Position] = [ring[fi], ring[(fi + 1) % ring.length]]
  const minFraction = ruleNumber(rules, 'bma-frontage', 'frontingLineMinFractionOfPerimeter')
  const maxDist = ruleNumber(rules, 'bma-frontage', 'frontingLineMaxDistanceFromWayM')
  const fronts = (poly: MetricPolygon) => isFronting(frontage(poly[0], front, maxDist), minFraction, maxDist)
  if (fronts(plain.base)) return plain

  // Depths of the envelope footprint from the front-edge line.
  const [a, b] = front
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  let nx = -(b[1] - a[1]) / len
  let ny = (b[0] - a[0]) / len
  const fr = dropClosingPoint(metric.footprint[0])
  const depth = (p: Position) => (p[0] - a[0]) * nx + (p[1] - a[1]) * ny
  if (fr.reduce((s, p) => s + depth(p), 0) < 0) {
    nx = -nx
    ny = -ny
  }
  const depths = fr.map(depth)
  const dMin = Math.min(...depths)
  const dMax = Math.max(...depths)
  const attempt = (D: number): DesignPlot | null => {
    const cut = cutPlotToDepth(metric.plot, metric.footprintOffsets, fi, D)
    if (!cut) return null
    const base = erodeFrom(cut.plot, cut.offsets, 0)
    if (!base || !fronts(base)) return null
    return { plot: cut.plot, offsets: cut.offsets, base: [base[0]], note: null }
  }
  let lo = dMin + TOWER_MIN_WIDTH_M
  let best = attempt(lo)
  if (!best) return plain
  let hi = dMax
  for (let i = 0; i < 7 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2
    const r = attempt(mid)
    if (r) {
      lo = mid
      best = r
    } else hi = mid
  }
  if (polygonArea(best.base) < TOWER_MIN_AREA_M2) return plain
  best.note = `Cut back to ${fmt(lo, 1)} m from the road so the road-facing building line exceeds 1/${Math.round(1 / minFraction)} of the perimeter (BMA-BL-2544 ข้อ 53); the full-depth envelope would not front the public way.`
  return best
}

/** Generates every template for the current envelope; templates that do not apply are skipped. */
export function generateDesigns(pipeline: PipelineResult, rules: ZoneRules, inputs: PipelineInputs, overrides: DesignOverrideMap = {}): Design[] {
  const env = pipeline.envelope
  const metric = pipeline.metric
  if (!pipeline.ok || !env || !metric || !metric.footprint) return []
  const out: Design[] = []
  const zeros = dropClosingPoint(metric.plot[0]).map(() => 0)
  let fp: DesignPlot | undefined
  for (const id of ['slab', 'podiumTower', 'courtyard'] as DesignId[]) {
    const ov = overrides[id] ?? {}
    const dp: DesignPlot = ov.ignoreSetbacks
      ? { plot: metric.plot, offsets: zeros, base: [metric.plot[0]], note: null }
      : (fp ??= frontagePlot(pipeline, rules) ?? { plot: metric.plot, offsets: metric.footprintOffsets, base: [metric.footprint[0]], note: null })
    const base = dp.base
    const baseOffsets = dp.offsets
    const ctx: TemplateContext = {
      pipeline,
      rules,
      inputs,
      base,
      baseAreaM2: polygonArea(base),
      plot: dp.plot,
      baseOffsets,
      plotAreaM2: metric.plotAreaM2,
      maxFloors: env.maxFloors,
      floorsByHeight: env.floorsByHeight,
      maxGfaM2: env.gfaCapM2,
      osrFrac: rules.zone.osrPercent / 100,
      f2f: inputs.floorToFloorM,
      overrides: ov,
      erode: cachedEroder(dp.plot, baseOffsets),
      frontageNote: dp.note,
    }
    try {
      const d = TEMPLATES[id](ctx)
      if (d) out.push(d)
    } catch (err) {
      console.warn(`[designs] template ${id} failed`, err)
    }
  }
  return out
}
