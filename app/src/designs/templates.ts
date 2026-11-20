/**
 * Massing templates: (envelope, rules, inputs, overrides) -> Design | null. Pure.
 * All geometry in UTM metres; WGS84 copies are attached for rendering only.
 */
import type { Polygon, Position } from 'geojson'
import { closePolygon, erodePolygon, erodeToArea, largestPiece, polygonArea, polygonIntersection, type MetricPolygon } from '../engine/offset'
import { dropClosingPoint, ringPerimeter } from '../engine/geometry'
import { frontageApplies, frontageParams, frontageVerdict } from '../engine/frontage'
import type { PipelineInputs, PipelineResult } from '../engine/pipeline'
import { toWgs84 } from '../engine/projection'
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
function cachedEroder(source: MetricPolygon, offsets: number[], clip?: DepthClip): Eroder {
  const cache = new Map<string, MetricPolygon | null>()
  return (extraM: number) => {
    const key = extraM.toFixed(4)
    if (!cache.has(key)) {
      const e = erodeFrom(source, offsets, extraM)
      cache.set(key, e && clip ? clipToDepth(e, clip, clip.nearM + extraM, clip.depthM - extraM) : e)
    }
    return cache.get(key) ?? null
  }
}

/** Keeps only the part of the plot within `depthM` of the front-edge line (the rear of a design cut back from the road). */
interface DepthClip {
  /** A point on the front edge line, its unit direction and the unit normal pointing into the plot. */
  a: [number, number]
  u: [number, number]
  n: [number, number]
  /** Half-length of the clip strip along the front line (covers the whole plot). */
  halfLen: number
  /** Keep the part between these depths from the front line (near: the building pushed back; far: cut back from the rear). */
  nearM: number
  depthM: number
}

function makeDepthClip(plot: MetricPolygon, frontIdx: number, depthM: number, nearM = -Infinity): DepthClip | null {
  const ring = dropClosingPoint(plot[0])
  const k = ring.length
  const a = ring[frontIdx]
  const b = ring[(frontIdx + 1) % k]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len === 0) return null
  const u: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
  let n: [number, number] = [-u[1], u[0]]
  let cx = 0
  let cy = 0
  for (const p of ring) {
    cx += p[0] / k
    cy += p[1] / k
  }
  if ((cx - a[0]) * n[0] + (cy - a[1]) * n[1] < 0) n = [-n[0], -n[1]]
  const L = ringPerimeter(ring)
  return { a: [a[0], a[1]], u, n, halfLen: L, nearM: Math.max(nearM, -L), depthM: Math.min(depthM, L) }
}

/**
 * Eroded footprint intersected with the strip within `depthM` of the front line. Clipping the
 * eroded ORIGINAL plot (rather than eroding a cut plot) keeps every original edge's full
 * setback, including near where the cut line meets an oblique boundary.
 */
function clipToDepth(poly: MetricPolygon, c: DepthClip, nearM: number, depthM: number): MetricPolygon | null {
  if (depthM <= 0 || depthM <= nearM) return null
  const { a, u, n, halfLen: L } = c
  const strip: MetricPolygon = [
    [
      [a[0] - u[0] * L + n[0] * nearM, a[1] - u[1] * L + n[1] * nearM],
      [a[0] + u[0] * L + n[0] * nearM, a[1] + u[1] * L + n[1] * nearM],
      [a[0] + u[0] * L + n[0] * depthM, a[1] + u[1] * L + n[1] * depthM],
      [a[0] - u[0] * L + n[0] * depthM, a[1] - u[1] * L + n[1] * depthM],
    ],
  ]
  const r = largestPiece(polygonIntersection(poly, strip)).polygon
  return r ? [dropClosingPoint(r[0]) as [number, number][], ...r.slice(1)] : null
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
  const reshaped = ctx.frontageNote !== null && !ctx.frontageNote.startsWith('Capped')
  const notes = [`Footprint ${reshaped ? 'is the envelope footprint reshaped for the frontage rule (see below)' : 'equals the envelope footprint'} (${fmt(b.areaM2)} m2), ${floors} floors x ${ctx.f2f} m.`]
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
  // With setbacks ignored the footprint is the whole plot, so the OSR cap would be 0 and collapse the
  // design; that override exists to show failing rows, and the checklist still fails OSR.
  const osrCap = ctx.overrides.ignoreSetbacks ? Infinity : osrGfaMax(ctx, F)
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
    const shrunk = erodeToArea(ctx.plot, ctx.baseOffsets, Math.max(towerArea - 0.2, 1), Math.max(0.05, 0.002 * towerArea), 8, true, ctx.erode)
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

interface DesignPlot {
  plot: MetricPolygon
  offsets: number[]
  base: MetricPolygon
  note: string | null
  /** Storey cap (the ข้อ 52(6) residential exemption) when no footprint fronts the way or keeps the front open space. */
  floorsCap?: number
  /** Rear cut-back: designs keep only the part within this depth of the front-edge line. */
  clip?: DepthClip
}

/**
 * BMA-BL-2544 ข้อ 52(6) / 53 for the DEFAULT designs. A building over the exemption must either
 * front the public way (road-facing line > 1/8 of the perimeter within 20 m) or keep a front
 * open space (6 m, 12 m above 3 storeys) over >= 1/6 of its perimeter. When the envelope
 * footprint does neither, candidates are tried and the largest valid footprint wins:
 *  - cut back from the rear until it fronts the way (bisection on depth);
 *  - push the front building line to the open-space depth, cutting back from the rear as
 *    needed so the front edge reaches 1/6 of the perimeter;
 *  - otherwise the designs are capped at the residential exemption (3 storeys).
 */
/**
 * Search parameters of the frontage options (engineering choices, not rule values): a footprint
 * under 50 m2 is not a building option; depth searches start 4 m inside the footprint and stop
 * at 0.5 m resolution (8 bisection steps).
 */
const FRONTAGE_SEARCH = { minAreaM2: 50, startInsetM: 4, resolutionM: 0.5, steps: 8 } as const

function designPlot(pipeline: PipelineResult, rules: ZoneRules): DesignPlot | null {
  const metric = pipeline.metric
  const env = pipeline.envelope
  if (!metric || !metric.footprint || !env) return null
  const plain: DesignPlot = { plot: metric.plot, offsets: metric.footprintOffsets, base: [metric.footprint[0]], note: null }
  const fp = frontageParams(rules)
  const floors = env.floorsByHeight
  // Applies only above the residential exemption (floors > 3 implies the > 2 storeys trigger).
  if (!frontageApplies(fp, floors, 0)) return plain
  const ring = dropClosingPoint(metric.plot[0])
  const fi = metric.frontEdgeIndex
  const front: [Position, Position] = [ring[fi], ring[(fi + 1) % ring.length]]
  const verdict = (poly: MetricPolygon) => frontageVerdict(poly[0], metric.plot[0], front, floors, fp)
  const plainVerdict = verdict(plain.base)
  if (plainVerdict.pass) return plain

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
  const needDepth = floors > fp.tierStoreys ? fp.frontOpenTallM : fp.frontOpenM
  const { minAreaM2, startInsetM, resolutionM, steps } = FRONTAGE_SEARCH

  /** Envelope footprint kept between depths `near` and `far` from the front line. */
  const attempt = (near: number, far: number, route: 'fronting' | 'open'): { dp: DesignPlot; v: ReturnType<typeof verdict> } | null => {
    const clip = near <= dMin && far >= dMax ? undefined : (makeDepthClip(metric.plot, fi, far, near) ?? undefined)
    let base: MetricPolygon | null
    try {
      base = erodeFrom(metric.plot, metric.footprintOffsets, 0)
      if (base && clip) base = clipToDepth(base, clip, clip.nearM, clip.depthM)
    } catch {
      return null
    }
    if (!base || polygonArea(base) < minAreaM2) return null
    const v = verdict(base)
    if (route === 'fronting' ? !v.fronting : !v.open?.pass) return null
    return { dp: { plot: metric.plot, offsets: metric.footprintOffsets, base: [base[0]], note: null, clip }, v }
  }
  // ข้อ 53: largest rear depth that still fronts the way.
  const searchFronting = () => {
    let lo = dMin + startInsetM
    let best = attempt(-Infinity, lo, 'fronting')
    if (!best) return null
    let hi = dMax
    for (let i = 0; i < steps && hi - lo > resolutionM; i++) {
      const mid = (lo + hi) / 2
      const r = attempt(-Infinity, mid, 'fronting')
      if (r) {
        lo = mid
        best = r
      } else hi = mid
    }
    return { ...best, D: lo }
  }
  // ข้อ 52(6): smallest push-back of the building (near depth) that leaves the front open space.
  const searchOpen = () => {
    let hi = dMax - startInsetM
    let best = attempt(hi, Infinity, 'open')
    if (!best) return null
    let lo = dMin
    for (let i = 0; i < steps && hi - lo > resolutionM; i++) {
      const mid = (lo + hi) / 2
      const r = attempt(mid, Infinity, 'open')
      if (r) {
        hi = mid
        best = r
      } else lo = mid
    }
    return { ...best, D: hi }
  }
  const byFronting = searchFronting()
  const byOpen = searchOpen()
  // Compare by the GFA each option can carry (footprint x floors within the height and GFA caps),
  // including the 3-storey exempt building on the full envelope footprint.
  const gfaOf = (areaM2: number, floorsMax: number) => areaM2 * Math.max(0, Math.min(floorsMax, Math.floor(env.gfaCapM2 / Math.max(areaM2, 1e-9) + 1e-9)))
  const gFront = byFronting ? gfaOf(polygonArea(byFronting.dp.base), env.floorsByHeight) : 0
  const gOpen = byOpen ? gfaOf(polygonArea(byOpen.dp.base), env.floorsByHeight) : 0
  const gCapped = gfaOf(polygonArea(plain.base), Math.min(env.floorsByHeight, fp.exemptStoreys))
  const best = Math.max(gFront, gOpen, gCapped)
  const m1 = (v: number) => `${fmt(v, 1)} m`
  const pf = plainVerdict.fr
  const notFronting = `The envelope footprint does not front the road: road-side building line ${m1(pf.lineM)}, needs > ${m1(fp.minFraction * pf.perimeterM)} (1/${Math.round(1 / fp.minFraction)} of ${fmt(pf.perimeterM)} m perimeter) within ${fp.maxDistM} m.`
  if (byFronting && gFront === best && gFront > 0) {
    byFronting.dp.note = `${notFronting} Cut back to ${m1(byFronting.D)} from the road so it fronts the public way (ข้อ 53): line ${m1(byFronting.v.fr.lineM)} of ${fmt(byFronting.v.fr.perimeterM)} m perimeter.`
    return byFronting.dp
  }
  if (byOpen && gOpen === best && gOpen > 0 && byOpen.v.open) {
    const o = byOpen.v.open
    byOpen.dp.note = `${notFronting} Uses the ข้อ 52(6) front open space: building pushed back to ${m1(byOpen.D)} from the road edge line, ${needDepth} m band ${m1(o.bandM)} along the building (needs >= ${m1(o.needBandM)}), connected ${o.connection}.`
    return byOpen.dp
  }
  const po = plainVerdict.open
  return {
    ...plain,
    floorsCap: fp.exemptStoreys,
    note: `Capped at ${fp.exemptStoreys} storeys (residential buildings of <= ${fp.exemptStoreys} storeys are exempt from ข้อ 52(6) / 53). ${notFronting} ${
      byFronting || byOpen
        ? 'A taller footprint that fronts the way or keeps the front open space carries less floor area.'
        : `No ${needDepth} m front open space fits either (envelope footprint: band ${m1(po?.bandM ?? 0)}, needs >= ${m1(po?.needBandM ?? 0)}${po && po.bandM >= po.needBandM ? ', not connected to the road by >= 6 m' : ''}).`
    }`,
  }
}

export interface UnavailableTemplate {
  id: DesignId
  name: string
  reason: string
}

export interface DesignSet {
  designs: Design[]
  /** Templates not offered for this envelope, with a one-line reason for the panel. */
  unavailable: UnavailableTemplate[]
}

const TEMPLATE_NAMES: Record<DesignId, string> = { slab: 'Full-envelope slab', podiumTower: 'Tower on podium', courtyard: 'Courtyard block' }
const NOT_APPLICABLE: Record<DesignId, string> = {
  slab: 'the envelope has no buildable floor.',
  podiumTower: `the envelope is too low or too small for a podium plus a tower at least ${TOWER_MIN_WIDTH_M} m wide and ${TOWER_MIN_AREA_M2} m2 within the GFA target.`,
  courtyard: `needs an envelope footprint over ${COURTYARD_MIN_FOOTPRINT_M2.toLocaleString('en-GB')} m2 with room for a ${COURTYARD_DEPTH_M} m deep block around a court.`,
}

/** Moves every vertex by under 1 mm (deterministic), to step around a degenerate boolean configuration. */
function jitter(poly: MetricPolygon, attempt: number): MetricPolygon {
  return poly.map((ring) => ring.map(([x, y], k) => [x + 0.0007 * Math.sin(attempt * 3.1 + k * 1.7), y + 0.0007 * Math.cos(attempt * 2.3 + k * 1.3)] as [number, number]))
}

/** Generates every template for the current envelope; templates that do not apply are listed with a reason. */
export function generateDesignSet(pipeline: PipelineResult, rules: ZoneRules, inputs: PipelineInputs, overrides: DesignOverrideMap = {}): DesignSet {
  const env = pipeline.envelope
  const metric = pipeline.metric
  if (!pipeline.ok || !env || !metric || !metric.footprint) return { designs: [], unavailable: [] }
  const designs: Design[] = []
  const unavailable: UnavailableTemplate[] = []
  const zeros = dropClosingPoint(metric.plot[0]).map(() => 0)
  let fp: DesignPlot | undefined
  for (const id of ['slab', 'podiumTower', 'courtyard'] as DesignId[]) {
    const ov = overrides[id] ?? {}
    let dp: DesignPlot
    try {
      dp = ov.ignoreSetbacks
        ? { plot: metric.plot, offsets: zeros, base: [metric.plot[0]], note: null }
        : (fp ??= designPlot(pipeline, rules) ?? { plot: metric.plot, offsets: metric.footprintOffsets, base: [metric.footprint[0]], note: null })
    } catch {
      dp = fp = { plot: metric.plot, offsets: metric.footprintOffsets, base: [metric.footprint[0]], note: null }
    }
    const cap = ov.ignoreSetbacks ? undefined : dp.floorsCap
    const makeCtx = (plot: MetricPolygon, base: MetricPolygon): TemplateContext => ({
      pipeline,
      rules,
      inputs,
      base,
      baseAreaM2: polygonArea(base),
      plot,
      baseOffsets: dp.offsets,
      plotAreaM2: metric.plotAreaM2,
      maxFloors: cap !== undefined ? Math.min(env.maxFloors, cap) : env.maxFloors,
      floorsByHeight: cap !== undefined ? Math.min(env.floorsByHeight, cap) : env.floorsByHeight,
      maxGfaM2: env.gfaCapM2,
      osrFrac: rules.zone.osrPercent / 100,
      f2f: inputs.floorToFloorM,
      overrides: ov,
      erode: cachedEroder(plot, dp.offsets, ov.ignoreSetbacks ? undefined : dp.clip),
      frontageNote: dp.note,
    })
    let result: Design | null | undefined
    for (let attempt = 0; attempt < 3 && result === undefined; attempt++) {
      try {
        if (attempt === 0) result = TEMPLATES[id](makeCtx(dp.plot, dp.base))
        else {
          // polygon-clipping occasionally fails on a degenerate configuration; retry on a plot nudged by < 1 mm.
          const plot = jitter(dp.plot, attempt)
          const e = ov.ignoreSetbacks ? plot : erodeFrom(plot, dp.offsets, 0)
          const base = e && dp.clip && !ov.ignoreSetbacks ? clipToDepth(e, dp.clip, dp.clip.nearM, dp.clip.depthM) : e
          result = base ? TEMPLATES[id](makeCtx(plot, [base[0]])) : null
        }
      } catch (err) {
        if (attempt === 2) console.warn(`[designs] template ${id} failed`, err)
      }
    }
    if (result && cap !== undefined) {
      // The storey cap only matters to designs it actually limits; a 2-floor design is not "capped".
      if (result.defaults.floors < cap) result.notes = result.notes.filter((n) => n !== dp.note)
      else result.floorsCap = cap
    }
    if (result) designs.push(result)
    else
      unavailable.push({
        id,
        name: TEMPLATE_NAMES[id],
        reason: result === undefined ? 'the geometry engine could not build this template for this outline; nudge a vertex.' : NOT_APPLICABLE[id],
      })
  }
  return { designs, unavailable }
}

/** Designs only (see `generateDesignSet` for the reasons a template is not offered). */
export function generateDesigns(pipeline: PipelineResult, rules: ZoneRules, inputs: PipelineInputs, overrides: DesignOverrideMap = {}): Design[] {
  return generateDesignSet(pipeline, rules, inputs, overrides).designs
}
