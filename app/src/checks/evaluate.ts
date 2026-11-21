/**
 * Checklist evaluators: (design, pipeline, rules, inputs) -> pass/fail rows. Pure.
 */
import type { Position } from 'geojson'
import type { Design } from '../designs/types'
import { dropClosingPoint, pointToSegmentDistance, ringPerimeter, ringToSegmentDistance, segmentLength } from '../engine/geometry'
import { frontage as frontageOf, frontageApplies, isResidentialType, frontageParams, frontageVerdict, type FrontageResult } from '../engine/frontage'
import { polygonArea, polygonIntersectionArea, type MetricPolygon } from '../engine/offset'
import { boundarySetbackM, type PipelineInputs, type PipelineResult } from '../engine/pipeline'
import { buildingTypeRules, getRule, ruleNumber } from '../rules/loadRules'
import type { ZoneRules } from '../rules/types'
import type { CheckRow, ChecklistResult } from './types'

/** Erosion applied to the design before containment tests, so float noise cannot fail a design equal to the envelope. */
export const CONTAINMENT_TOLERANCE_M = 0.05
const EPS = 1e-6

const m = (v: number, d = 2) => `${Number(v.toFixed(d)).toLocaleString('en-GB')} m`
const m2 = (v: number) => `${Math.round(v).toLocaleString('en-GB')} m²`

function sameRing(a: Position[], b: Position[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false
  return true
}

function pointInRing(p: Position, ring: Position[]): boolean {
  const pts = dropClosingPoint(ring)
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function minDistanceToRing(p: Position, ring: Position[]): number {
  const pts = dropClosingPoint(ring)
  let best = Infinity
  for (let i = 0; i < pts.length; i++) best = Math.min(best, pointToSegmentDistance(p, pts[i], pts[(i + 1) % pts.length]))
  return best
}

/** Every vertex of `inner` lies inside `region` or within the 0.05 m tolerance of its boundary. */
function verticesWithin(inner: MetricPolygon, region: MetricPolygon): boolean {
  return dropClosingPoint(inner[0]).every((p) => pointInRing(p, region[0]) || minDistanceToRing(p, region[0]) <= CONTAINMENT_TOLERANCE_M)
}

/**
 * True when `inner` lies within `region`, allowing a 0.05 m band of float noise.
 * Identical rings pass directly. Otherwise two tests must both hold:
 * - every vertex of `inner` is inside `region` or within 0.05 m of it (catches a local
 *   bump of any size beyond the tolerance, which an area test alone would absorb), and
 * - the part of `inner` outside `region` is smaller than perimeter x 0.05 m (catches an
 *   edge of `inner` cutting across a reflex corner of `region` between two inside vertices).
 * No erosion of the (rounded) design polygon is needed, which keeps this cheap on many-vertex plots.
 */
export function containedWithin(inner: MetricPolygon, region: MetricPolygon | null): boolean {
  if (!region) return false
  if (sameRing(inner[0], region[0])) return true
  if (!verticesWithin(inner, region)) return false
  const a = polygonArea([inner[0]])
  const slack = Math.max(0.05, ringPerimeter(inner[0]) * CONTAINMENT_TOLERANCE_M)
  try {
    const inside = polygonIntersectionArea([inner[0]], [region[0]])
    return inside >= a - slack
  } catch {
    // Degenerate boolean op: the vertex test above already passed (exact for convex regions).
    return true
  }
}

/** Shortest distance from a footprint's outer ring to a plot edge (segment). */
function distanceToEdge(footprint: MetricPolygon, a: Position, b: Position): number {
  return ringToSegmentDistance(footprint[0], a, b)
}

function plotEdges(plot: MetricPolygon): Array<[Position, Position]> {
  const ring = dropClosingPoint(plot[0])
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]] as [Position, Position])
}

/**
 * BMA-BL-2544 ข้อ 53 fronting test on a design footprint (see engine/frontage.ts for the
 * building-line heuristic). Distance limit from the rules JSON (bma-frontage).
 */
export function frontage(footprint: MetricPolygon, front: [Position, Position], rules: ZoneRules): FrontageResult {
  return frontageOf(footprint[0], front, ruleNumber(rules, 'bma-frontage', 'frontingLineMaxDistanceFromWayM'))
}

export function evaluateChecks(design: Design, pipeline: PipelineResult, rules: ZoneRules, inputs: PipelineInputs): ChecklistResult {
  const rows: CheckRow[] = []
  const env = pipeline.envelope
  const metric = pipeline.metric
  if (!env || !metric) return { rows, pass: false, passed: 0, total: 0, designRegime: 'standard' }
  const typeRules = buildingTypeRules(rules, inputs.buildingType)
  const A = metric.plotAreaM2
  const edges = plotEdges(metric.plot)
  const front = edges[metric.frontEdgeIndex]
  const src = (id: string) => getRule(rules, id).source

  // Regime the design itself triggers.
  const hrHeight = rules.thresholds.highRiseHeightM
  const hrGfa = rules.thresholds.extraLargeGfaM2
  const canHighRise = Boolean(typeRules.setbacks.highRise)
  const designTriggers = canHighRise && (design.heightM >= hrHeight - EPS || design.gfaM2 >= hrGfa - EPS)
  const designRegime: 'standard' | 'highRise' = pipeline.regime === 'highRise' || designTriggers ? 'highRise' : 'standard'

  // 1. Front (road) setback: footprint within the road-setback region.
  const frontDist = distanceToEdge(design.footprint, front[0], front[1])
  rows.push({
    ruleId: pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-road-setback',
    label: 'Road setback',
    requirement: `Building line ≥ ${m(metric.frontSetbackM)} from the road edge (front edge).`,
    actual: m(frontDist),
    allowed: `≥ ${m(metric.frontSetbackM)}`,
    pass: containedWithin(design.footprint, metric.afterRoadSetback),
    source: src(pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-road-setback'),
  })

  // 2. Boundary setback: footprint within the boundary-setback region.
  let boundaryDist = Infinity
  edges.forEach((e, i) => {
    if (i !== metric.frontEdgeIndex) boundaryDist = Math.min(boundaryDist, distanceToEdge(design.footprint, e[0], e[1]))
  })
  // Standard regime: the required distance depends on the design's OWN height (MR-55 ข้อ 50 /
  // BMA ข้อ 55), which a floors override can raise above the envelope's built height.
  const boundaryReq = pipeline.regime === 'highRise' ? metric.boundarySetbackM : boundarySetbackM(rules, typeRules, design.heightM).m
  const boundaryRaised = boundaryReq > metric.boundarySetbackM + EPS
  rows.push({
    ruleId: pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-boundary-openings',
    label: 'Boundary setback',
    requirement: `Walls ≥ ${m(boundaryReq)} from every neighbouring boundary${pipeline.regime === 'highRise' ? '' : ` (at this design's height of ${m(design.heightM, 1)})`}.`,
    actual: Number.isFinite(boundaryDist) ? m(boundaryDist) : '—',
    allowed: `≥ ${m(boundaryReq)}`,
    pass: containedWithin(design.footprint, metric.afterBoundarySetback) && boundaryDist >= boundaryReq - CONTAINMENT_TOLERANCE_M,
    source: src(pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-boundary-openings'),
    note: boundaryRaised ? `The envelope was computed for ${m(metric.boundarySetbackM)} at its own height; at ${m(design.heightM, 1)} this design needs ${m(boundaryReq)}.` : undefined,
  })

  // 3. MR-33 6 m clearance when the design is (or makes itself) high-rise / extra-large.
  if (designRegime === 'highRise') {
    const six = ruleNumber(rules, 'mr33-clearance', 'fromBoundaryM')
    const minAll = Math.min(frontDist, boundaryDist)
    rows.push({
      ruleId: 'mr33-clearance',
      label: 'High-rise 6 m clearance',
      requirement: `Every part of an อาคารสูง / ขนาดใหญ่พิเศษ ≥ ${six} m from every boundary and road.`,
      actual: m(minAll),
      allowed: `≥ ${six} m`,
      pass: minAll >= six - CONTAINMENT_TOLERANCE_M,
      source: src('mr33-clearance'),
      note:
        pipeline.regime === 'standard'
          ? `This design reaches ${design.heightM >= hrHeight - EPS ? `${m(design.heightM, 1)} (≥ ${hrHeight} m)` : `${m2(design.gfaM2)} (≥ ${m2(hrGfa)})`}, so it pushes itself into MR-33 although the envelope was computed in the standard regime.`
          : undefined,
    })
  }

  // 4. Height cap.
  rows.push({
    ruleId: 'mr55-height-road',
    label: 'Height (2 × road rule)',
    requirement:
      env.heightCapBy === 'type'
        ? `Height ≤ ${m(env.maxHeightM, 1)}: the building type's own cap binds (2 x (right-of-way + front setback) allows ${m(env.roadHeightM, 1)}).`
        : `Height ≤ 2 x (right-of-way + front setback) = ${m(env.maxHeightM, 1)}.`,
    actual: `${m(design.heightM, 1)} (${design.floors} fl)`,
    allowed: `≤ ${m(env.maxHeightM, 1)}`,
    pass: design.heightM <= env.maxHeightM + EPS,
    source: src('mr55-height-road'),
  })

  // 5. FAR (and the MR-33 ข้อ 2 30,000 m2 road tier when it is lower).
  // A lower cap is either the MR-33 ข้อ 2 30,000 m2 road tier or the hold under the 10,000 m2
  // extra-large threshold (MR-33 ข้อ 1) when the road cannot carry a high-rise; the envelope says which.
  const capBinds = env.gfaCapM2 < env.maxGfaM2 - 0.5
  const capIsHold = capBinds && env.gfaCapM2 <= hrGfa + 0.5
  const capRule = capIsHold ? 'highrise-threshold' : 'mr33-road-access'
  rows.push({
    ruleId: capBinds ? capRule : 'zone-far',
    label: capBinds ? `GFA cap (FAR ${rules.zone.far}, ${capIsHold ? 'held under 10,000 m²' : 'road tier'})` : `FAR ${rules.zone.far}`,
    requirement: capBinds
      ? `Gross floor area ≤ ${rules.zone.far} x plot area = ${m2(env.maxGfaM2)}, and ≤ ${m2(env.gfaCapM2)}: ${env.gfaCapNote ?? (capIsHold ? 'held under the extra-large threshold.' : 'MR-33 road tier.')}`
      : `Gross floor area ≤ ${rules.zone.far} x plot area = ${m2(env.maxGfaM2)}.`,
    actual: m2(design.gfaM2),
    allowed: `≤ ${m2(env.gfaCapM2)}`,
    pass: design.gfaM2 <= env.gfaCapM2 + 0.5,
    source: capBinds ? `${src('zone-far')}; ${src(capRule)}` : src('zone-far'),
  })

  // 6. 30% of plot open space.
  const openFrac = typeRules.openSpacePlotPercentMin / 100
  rows.push({
    ruleId: 'bcl-open-space-plot',
    label: `Open space ${typeRules.openSpacePlotPercentMin}% of plot`,
    requirement: `Unroofed ground ≥ ${typeRules.openSpacePlotPercentMin}% of the plot (${m2(openFrac * A)}).`,
    actual: `${m2(design.openSpaceM2)} (${Math.round((100 * design.openSpaceM2) / A)}%)`,
    allowed: `≥ ${m2(openFrac * A)}`,
    pass: design.openSpaceM2 >= openFrac * A - 0.5,
    source: src('bcl-open-space-plot'),
  })

  // 7. OSR 4% of design GFA.
  const osrFrac = rules.zone.osrPercent / 100
  rows.push({
    ruleId: 'zone-osr',
    label: `OSR ${rules.zone.osrPercent}% of GFA`,
    requirement: `Open space ≥ ${rules.zone.osrPercent}% of this design's gross floor area.`,
    actual: `${m2(design.openSpaceM2)} (${design.gfaM2 > 0 ? ((100 * design.openSpaceM2) / design.gfaM2).toFixed(1) : '—'}%)`,
    allowed: `≥ ${m2(osrFrac * design.gfaM2)}`,
    pass: design.openSpaceM2 >= osrFrac * design.gfaM2 - 0.5,
    source: src('zone-osr'),
  })

  // 8. MR-33 road access (high-rise designs): right-of-way and frontage; continuity attested.
  if (designRegime === 'highRise') {
    const bigTier = design.gfaM2 > rules.thresholds.mr33RoadTierGfaM2
    const minRow = ruleNumber(rules, 'mr33-road-access', bigTier ? 'minRowM_gfaGt30000' : 'minRowM_gfaLe30000')
    const minFrontage = ruleNumber(rules, 'mr33-road-access', 'minFrontageM')
    const frontLen = segmentLength(front[0], front[1])
    rows.push({
      ruleId: 'mr33-road-access',
      label: 'High-rise road access',
      requirement: `Plot side ≥ ${minFrontage} m on a public road with right-of-way ≥ ${minRow} m${bigTier ? ' (GFA > 30,000 m²)' : ''}, continuing to another road of that width.`,
      actual: `road ${m(inputs.roadWidthM, 1)}, frontage ${m(frontLen, 1)}`,
      allowed: `road ≥ ${minRow} m, frontage ≥ ${minFrontage} m`,
      pass: inputs.roadWidthM >= minRow - EPS && frontLen >= minFrontage - EPS,
      source: src('mr33-road-access'),
      note: 'Road continuity to another public road of the same width is attested by the user, not computed.',
    })
  }

  // 9. BMA frontage (ข้อ 52(6) / 53): fronting the public way, or the front open-space alternative.
  const fp = frontageParams(rules)
  if (frontageApplies(fp, design.floors, design.heightM, isResidentialType(inputs.buildingType))) {
    const v = frontageVerdict(design.footprint[0], metric.plot[0], front, design.floors, fp)
    const fr = v.fr
    const o = v.open
    const notFronting = `Does not front the road: road-side building line ${m(fr.lineM, 1)}, needs > ${m(fp.minFraction * fr.perimeterM, 1)} (1/${Math.round(1 / fp.minFraction)} of ${m(fr.perimeterM, 0)} perimeter) within ${fp.maxDistM} m (nearest ${m(fr.distanceM, 1)}).`
    rows.push({
      ruleId: 'bma-frontage',
      label: v.fronting ? 'Fronting the public way' : 'Front open space (not fronting)',
      requirement: `ข้อ 53: road-facing building line > 1/${Math.round(1 / fp.minFraction)} of the outer perimeter and ≤ ${fp.maxDistM} m from the public way; otherwise ข้อ 52(6): a front open space ≥ ${v.needDepthM} m deep, continuous (with joined side space) for ≥ 1/${Math.round(1 / fp.openFraction)} of the perimeter, reaching the public way by a ≥ ${fp.internalRoadM} m internal road.`,
      actual: v.fronting
        ? `fronts: line ${m(fr.lineM, 1)} of ${m(fr.perimeterM, 1)} perimeter, ${m(fr.distanceM, 1)} from the road`
        : `not fronting (line ${m(fr.lineM, 1)}); open band ${m(o?.bandM ?? 0, 1)} x ${v.needDepthM} m deep, ${o?.connected ? 'connected' : o && o.bandM >= o.needBandM ? 'not connected to the road' : 'too short'}`,
      allowed: v.fronting
        ? `line > ${m(fp.minFraction * fr.perimeterM, 1)} within ${fp.maxDistM} m`
        : `band ≥ ${m(o?.needBandM ?? 0, 1)}, connected by ≥ ${fp.internalRoadM} m`,
      pass: v.pass,
      source: src('bma-frontage'),
      note: v.fronting
        ? undefined
        : o?.pass
          ? `${notFronting} Uses the ข้อ 52(6) front open space: ${v.needDepthM} m band, ${m(o.bandM, 1)} along the building (needs ≥ ${m(o.needBandM, 1)}), connected ${o.connection}.`
          : `${notFronting} No ข้อ 52(6) front open space either: ${v.needDepthM} m band ${m(o?.bandM ?? 0, 1)} long (needs ≥ ${m(o?.needBandM ?? 0, 1)})${o && o.bandM >= o.needBandM ? `, and it does not reach the road through ≥ ${fp.internalRoadM} m of open plot` : ''}.`,
    })
  } else {
    rows.push({
      ruleId: 'bma-frontage',
      label: 'Fronting the public way',
      requirement: `Applies to buildings > ${fp.triggerStoreys} storeys or > ${fp.triggerHeightM} m; residential ≤ ${fp.exemptStoreys} storeys exempt.`,
      actual: `${design.floors} floors, ${m(design.heightM, 1)}`,
      allowed: 'exempt',
      pass: true,
      informational: true,
      source: src('bma-frontage'),
    })
  }

  // 10. Low-rise definition limits.
  if (typeRules.maxStoreys !== undefined && typeRules.maxHeightM !== undefined) {
    const maxStoreys = typeRules.maxStoreys
    const maxH = typeRules.maxHeightM
    rows.push({
      ruleId: 'lowrise-limits',
      label: 'Low-rise definition',
      requirement: `Low-rise residential: ≤ ${maxStoreys} storeys and ≤ ${maxH} m.`,
      actual: `${design.floors} floors, ${m(design.heightM, 1)}`,
      allowed: `≤ ${maxStoreys} floors, ≤ ${maxH} m`,
      pass: design.floors <= maxStoreys && design.heightM <= maxH + EPS,
      source: `${typeRules.label}; BMA-BL-2544 ข้อ 50 exemption (rules JSON buildingTypes.lowRiseResidential)`,
    })
  }

  // 11. Floor-to-floor legal minimum (informational unless breached).
  const legalMin = ruleNumber(rules, 'floor-to-floor', 'legalMinM')
  rows.push({
    ruleId: 'floor-to-floor',
    label: 'Floor-to-floor minimum',
    requirement: `Dwelling floor-to-floor ≥ ${legalMin} m.`,
    actual: m(design.floorToFloorM, 2),
    allowed: `≥ ${legalMin} m`,
    pass: design.floorToFloorM >= legalMin - EPS,
    source: src('floor-to-floor'),
  })

  const counted = rows.filter((r) => !r.informational)
  const passed = counted.filter((r) => r.pass).length
  return { rows, pass: passed === counted.length, passed, total: counted.length, designRegime }
}
