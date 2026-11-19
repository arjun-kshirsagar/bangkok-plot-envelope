/**
 * Massing templates: (envelope, rules, inputs, overrides) -> Design | null. Pure.
 * All geometry in UTM metres; WGS84 copies are attached for rendering only.
 */
import type { Polygon, Position } from 'geojson'
import { closePolygon, erodePolygon, erodeToArea, polygonArea, type MetricPolygon } from '../engine/offset'
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

/** Same test expressed on the plot + offsets, so no rounded footprint is ever re-eroded. */
function hasMinWidthFrom(source: MetricPolygon, offsets: number[], extraM: number, minWidthM: number): boolean {
  return erodePolygon(source, offsets.map((d) => d + extraM + minWidthM / 2), { withRemoved: false }).polygon !== null
}

function erodeFrom(source: MetricPolygon, offsets: number[], extraM: number): MetricPolygon | null {
  return erodePolygon(source, offsets.map((d) => d + extraM), { withRemoved: false }).polygon
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
  const notes = [`Footprint equals the envelope footprint (${fmt(b.areaM2)} m2), ${floors} floors x ${ctx.f2f} m.`]
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
  const podiumFloors = PODIUM_FLOORS_DEFAULT
  if (ctx.floorsByHeight <= podiumFloors) return null
  const F = ctx.baseAreaM2
  const towerFloorsMax = ctx.floorsByHeight - podiumFloors
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
  let towerArea = (target - podiumFloors * F) / towerFloorsMax
  let towerFloors = towerFloorsMax
  let tower: MetricPolygon | null = null

  let towerExtra = 0
  if (towerArea >= F - 1e-6) {
    tower = ctx.base
    towerArea = F
  } else {
    // Aim a little under the exact area so search tolerance x tower floors never exceeds the FAR cap;
    // the search only ever stops at or under the target, so a 0.2% tolerance just under-fills slightly.
    const shrunk = erodeToArea(ctx.plot, ctx.baseOffsets, Math.max(towerArea - 0.2, 1), Math.max(0.05, 0.002 * towerArea), 8)
    tower = shrunk.polygon
    towerExtra = shrunk.offsetM
  }
  const thin = !tower || polygonArea(tower) < TOWER_MIN_AREA_M2 - 0.5 || !hasMinWidthFrom(ctx.plot, ctx.baseOffsets, towerExtra, TOWER_MIN_WIDTH_M)
  if (thin) {
    // Find the slimmest tower that is still >= 12 m wide and >= 400 m2, then cut floors to meet the target.
    const minimal = largestOffsetKeepingWidth(ctx.plot, ctx.baseOffsets, TOWER_MIN_WIDTH_M, TOWER_MIN_AREA_M2)
    if (!minimal) return null
    tower = minimal
    towerArea = polygonArea(tower)
    towerFloors = Math.max(1, Math.min(towerFloorsMax, Math.floor((target - podiumFloors * F) / towerArea + 1e-9)))
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
 * Largest extra inward offset (on top of `offsets`) whose result still has the minimum
 * width and area. One erosion per step: the width test erodes by extra + width/2, and
 * its area is a lower bound for the area at `extra`, so the second erosion is only
 * needed when that bound is below the minimum area.
 */
function largestOffsetKeepingWidth(source: MetricPolygon, offsets: number[], minWidthM: number, minAreaM2: number): MetricPolygon | null {
  const feasible = (extra: number): boolean => {
    const core = erodeFrom(source, offsets, extra + minWidthM / 2)
    if (!core) return false
    if (polygonArea(core) >= minAreaM2) return true
    const p = erodeFrom(source, offsets, extra)
    return p !== null && polygonArea(p) >= minAreaM2
  }
  if (!feasible(0)) return null
  const start = erodeFrom(source, offsets, 0)
  if (!start) return null
  let lo = 0
  let hi = Math.sqrt(polygonArea(start)) / 2
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2
    if (feasible(mid)) lo = mid
    else hi = mid
    if (hi - lo < 0.1) break
  }
  return erodeFrom(source, offsets, lo)
}

/**
 * 3. Courtyard block: the footprint minus an inner void (everything deeper than 10 m from
 * the footprint edge), only when the footprint exceeds 1,500 m2. Floors = min(envelope
 * maximum, floors needed for 80% of the FAR cap).
 */
export function courtyardTemplate(ctx: TemplateContext): Design | null {
  if (ctx.baseAreaM2 <= COURTYARD_MIN_FOOTPRINT_M2) return null
  const inner = erodeFrom(ctx.plot, ctx.baseOffsets, COURTYARD_DEPTH_M)
  if (!inner) return null
  const ring: MetricPolygon = [ctx.base[0], inner[0]]
  const ringArea = polygonArea(ring)
  if (ringArea < 1) return null
  const needed = Math.ceil((COURTYARD_GFA_TARGET_FRACTION * ctx.maxGfaM2) / ringArea - 1e-9)
  const byOsr = Math.floor(osrGfaMax(ctx, ringArea) / ringArea + 1e-9)
  const defaultFloors = Math.max(1, Math.min(ctx.maxFloors, needed, byOsr))
  const floors = ctx.overrides.floors ?? defaultFloors
  const b = block('court', 'Courtyard block', ring, 0, floors, ctx.f2f)
  const courtMinOk = hasMinWidthFrom(ctx.plot, ctx.baseOffsets, COURTYARD_DEPTH_M, 6)
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

/** Generates every template for the current envelope; templates that do not apply are skipped. */
export function generateDesigns(pipeline: PipelineResult, rules: ZoneRules, inputs: PipelineInputs, overrides: DesignOverrideMap = {}): Design[] {
  const env = pipeline.envelope
  const metric = pipeline.metric
  if (!pipeline.ok || !env || !metric || !metric.footprint) return []
  const out: Design[] = []
  for (const id of ['slab', 'podiumTower', 'courtyard'] as DesignId[]) {
    const ov = overrides[id] ?? {}
    const base = ov.ignoreSetbacks ? [metric.plot[0]] : [metric.footprint[0]]
    const baseOffsets = ov.ignoreSetbacks ? metric.footprintOffsets.map(() => 0) : metric.footprintOffsets
    const ctx: TemplateContext = {
      pipeline,
      rules,
      inputs,
      base,
      baseAreaM2: polygonArea(base),
      plot: metric.plot,
      baseOffsets,
      plotAreaM2: metric.plotAreaM2,
      maxFloors: env.maxFloors,
      floorsByHeight: env.floorsByHeight,
      maxGfaM2: env.gfaCapM2,
      osrFrac: rules.zone.osrPercent / 100,
      f2f: inputs.floorToFloorM,
      overrides: ov,
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
