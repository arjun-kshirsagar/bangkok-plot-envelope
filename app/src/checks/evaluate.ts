/**
 * Checklist evaluators: (design, pipeline, rules, inputs) -> pass/fail rows. Pure.
 */
import type { Position } from 'geojson'
import type { Design } from '../designs/types'
import { bearingDeg, dropClosingPoint, pointToSegmentDistance, ringPerimeter, ringToSegmentDistance, segmentLength } from '../engine/geometry'
import { erodePolygon, polygonArea, polygonIntersectionArea, type MetricPolygon } from '../engine/offset'
import type { PipelineInputs, PipelineResult } from '../engine/pipeline'
import { buildingTypeRules, getRule, ruleNumber } from '../rules/loadRules'
import type { ZoneRules } from '../rules/types'
import type { CheckRow, ChecklistResult } from './types'

/** Erosion applied to the design before containment tests, so float noise cannot fail a design equal to the envelope. */
export const CONTAINMENT_TOLERANCE_M = 0.05
const EPS = 1e-6

const m = (v: number, d = 2) => `${Number(v.toFixed(d)).toLocaleString('en-GB')} m`
const m2 = (v: number) => `${Math.round(v).toLocaleString('en-GB')} m²`

/** True when `inner` (eroded by the tolerance) lies within `region`. */
export function containedWithin(inner: MetricPolygon, region: MetricPolygon | null): boolean {
  if (!region) return false
  const shrunk = erodePolygon([inner[0]], CONTAINMENT_TOLERANCE_M).polygon
  if (!shrunk) return true // degenerate sliver: nothing left to be outside
  const a = polygonArea(shrunk)
  const inside = polygonIntersectionArea(shrunk, region)
  return inside >= a - Math.max(0.05, a * 1e-4)
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
 * BMA-BL-2544 ข้อ 53 fronting test: length of the footprint's road-facing building line
 * (edges roughly parallel to the front edge and at the footprint's nearest distance to
 * it) and that distance.
 */
export function frontage(footprint: MetricPolygon, front: [Position, Position]): { distanceM: number; lineM: number; perimeterM: number } {
  const ring = dropClosingPoint(footprint[0])
  const distanceM = distanceToEdge(footprint, front[0], front[1])
  const frontBearing = bearingDeg(front[0], front[1])
  let lineM = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const da = pointToSegmentDistance(a, front[0], front[1])
    const db = pointToSegmentDistance(b, front[0], front[1])
    const diff = Math.abs(((bearingDeg(a, b) - frontBearing + 540) % 180) - 0) // 0 or ~180 = parallel
    const parallel = diff < 15 || diff > 165
    if (parallel && Math.max(da, db) <= distanceM + 1.0) lineM += segmentLength(a, b)
  }
  return { distanceM, lineM, perimeterM: ringPerimeter(footprint[0]) }
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
    requirement: `Building line >= ${m(metric.frontSetbackM)} from the road edge (front edge).`,
    actual: m(frontDist),
    allowed: `>= ${m(metric.frontSetbackM)}`,
    pass: containedWithin(design.footprint, metric.afterRoadSetback),
    source: src(pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-road-setback'),
  })

  // 2. Boundary setback: footprint within the boundary-setback region.
  let boundaryDist = Infinity
  edges.forEach((e, i) => {
    if (i !== metric.frontEdgeIndex) boundaryDist = Math.min(boundaryDist, distanceToEdge(design.footprint, e[0], e[1]))
  })
  rows.push({
    ruleId: pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-boundary-openings',
    label: 'Boundary setback',
    requirement: `Walls >= ${m(metric.boundarySetbackM)} from every neighbouring boundary.`,
    actual: Number.isFinite(boundaryDist) ? m(boundaryDist) : '—',
    allowed: `>= ${m(metric.boundarySetbackM)}`,
    pass: containedWithin(design.footprint, metric.afterBoundarySetback),
    source: src(pipeline.regime === 'highRise' ? 'mr33-clearance' : 'mr55-boundary-openings'),
  })

  // 3. MR-33 6 m clearance when the design is (or makes itself) high-rise / extra-large.
  if (designRegime === 'highRise') {
    const six = ruleNumber(rules, 'mr33-clearance', 'fromBoundaryM')
    const minAll = Math.min(frontDist, boundaryDist)
    rows.push({
      ruleId: 'mr33-clearance',
      label: 'High-rise 6 m clearance',
      requirement: `Every part of an อาคารสูง / ขนาดใหญ่พิเศษ >= ${six} m from every boundary and road.`,
      actual: m(minAll),
      allowed: `>= ${six} m`,
      pass: minAll >= six - CONTAINMENT_TOLERANCE_M,
      source: src('mr33-clearance'),
      note:
        pipeline.regime === 'standard'
          ? `This design reaches ${design.heightM >= hrHeight - EPS ? `${m(design.heightM, 1)} (>= ${hrHeight} m)` : `${m2(design.gfaM2)} (>= ${m2(hrGfa)})`}, so it pushes itself into MR-33 although the envelope was computed in the standard regime.`
          : undefined,
    })
  }

  // 4. Height cap.
  rows.push({
    ruleId: 'mr55-height-road',
    label: 'Height (2 x road rule)',
    requirement: `Height <= 2 x (right-of-way + front setback) = ${m(env.maxHeightM, 1)}.`,
    actual: `${m(design.heightM, 1)} (${design.floors} fl)`,
    allowed: `<= ${m(env.maxHeightM, 1)}`,
    pass: design.heightM <= env.maxHeightM + EPS,
    source: src('mr55-height-road'),
  })

  // 5. FAR (and the MR-33 ข้อ 2 30,000 m2 road tier when it is lower).
  const roadTierBinds = env.gfaCapM2 < env.maxGfaM2 - 0.5
  rows.push({
    ruleId: roadTierBinds ? 'mr33-road-access' : 'zone-far',
    label: roadTierBinds ? `GFA cap (FAR ${rules.zone.far}, road tier)` : `FAR ${rules.zone.far}`,
    requirement: roadTierBinds
      ? `Gross floor area <= ${rules.zone.far} x plot area = ${m2(env.maxGfaM2)}, and <= ${m2(env.gfaCapM2)} because the road is under 18 m (MR-33 ข้อ 2).`
      : `Gross floor area <= ${rules.zone.far} x plot area = ${m2(env.maxGfaM2)}.`,
    actual: m2(design.gfaM2),
    allowed: `<= ${m2(env.gfaCapM2)}`,
    pass: design.gfaM2 <= env.gfaCapM2 + 0.5,
    source: roadTierBinds ? `${src('zone-far')}; ${src('mr33-road-access')}` : src('zone-far'),
  })

  // 6. 30% of plot open space.
  const openFrac = typeRules.openSpacePlotPercentMin / 100
  rows.push({
    ruleId: 'bcl-open-space-plot',
    label: `Open space ${typeRules.openSpacePlotPercentMin}% of plot`,
    requirement: `Unroofed ground >= ${typeRules.openSpacePlotPercentMin}% of the plot (${m2(openFrac * A)}).`,
    actual: `${m2(design.openSpaceM2)} (${Math.round((100 * design.openSpaceM2) / A)}%)`,
    allowed: `>= ${m2(openFrac * A)}`,
    pass: design.openSpaceM2 >= openFrac * A - 0.5,
    source: src('bcl-open-space-plot'),
  })

  // 7. OSR 4% of design GFA.
  const osrFrac = rules.zone.osrPercent / 100
  rows.push({
    ruleId: 'zone-osr',
    label: `OSR ${rules.zone.osrPercent}% of GFA`,
    requirement: `Open space >= ${rules.zone.osrPercent}% of this design's gross floor area.`,
    actual: `${m2(design.openSpaceM2)} (${design.gfaM2 > 0 ? ((100 * design.openSpaceM2) / design.gfaM2).toFixed(1) : '—'}%)`,
    allowed: `>= ${m2(osrFrac * design.gfaM2)}`,
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
      requirement: `Plot side >= ${minFrontage} m on a public road with right-of-way >= ${minRow} m${bigTier ? ' (GFA > 30,000 m2)' : ''}, continuing to another road of that width.`,
      actual: `road ${m(inputs.roadWidthM, 1)}, frontage ${m(frontLen, 1)}`,
      allowed: `road >= ${minRow} m, frontage >= ${minFrontage} m`,
      pass: inputs.roadWidthM >= minRow - EPS && frontLen >= minFrontage - EPS,
      source: src('mr33-road-access'),
      note: 'Road continuity to another public road of the same width is attested by the user, not computed.',
    })
  }

  // 9. BMA frontage (ข้อ 52(6) / 53).
  const triggerStoreys = ruleNumber(rules, 'bma-frontage', 'triggerStoreys')
  const triggerHeight = ruleNumber(rules, 'bma-frontage', 'triggerHeightM')
  const exemptStoreys = ruleNumber(rules, 'bma-frontage', 'exemptResidentialMaxStoreys')
  const frontageApplies = (design.floors > triggerStoreys || design.heightM > triggerHeight + EPS) && !(design.floors <= exemptStoreys)
  if (frontageApplies) {
    const fr = frontage(design.footprint, front)
    const minFraction = ruleNumber(rules, 'bma-frontage', 'frontingLineMinFractionOfPerimeter')
    const maxDist = ruleNumber(rules, 'bma-frontage', 'frontingLineMaxDistanceFromWayM')
    const fronting = fr.lineM > minFraction * fr.perimeterM && fr.distanceM <= maxDist + EPS
    const needDepth = design.floors > 3 ? ruleNumber(rules, 'bma-frontage', 'frontOpenSpaceIfGt3StoreysM') : ruleNumber(rules, 'bma-frontage', 'frontOpenSpaceM')
    rows.push({
      ruleId: 'bma-frontage',
      label: 'Fronting the public way',
      requirement: `Road-facing building line > 1/8 of the outer perimeter and <= ${maxDist} m from the public way; otherwise a ${needDepth} m front open space over 1/6 of the perimeter plus a 6 m internal road is needed (not modelled).`,
      actual: `line ${m(fr.lineM, 1)} of ${m(fr.perimeterM, 1)} perimeter, ${m(fr.distanceM, 1)} from the road`,
      allowed: `line > ${m(minFraction * fr.perimeterM, 1)}, distance <= ${maxDist} m`,
      pass: fronting,
      source: src('bma-frontage'),
      note: fronting ? undefined : `Not fronting the public way: the ${needDepth} m front open space / internal road route is flagged, not verified.`,
    })
  } else {
    rows.push({
      ruleId: 'bma-frontage',
      label: 'Fronting the public way',
      requirement: 'Applies to buildings > 2 storeys or > 8 m; residential <= 3 storeys exempt.',
      actual: `${design.floors} floors, ${m(design.heightM, 1)}`,
      allowed: 'exempt',
      pass: true,
      informational: true,
      source: src('bma-frontage'),
    })
  }

  // 10. Low-rise definition limits.
  if (inputs.buildingType === 'lowRiseResidential') {
    const maxStoreys = typeRules.maxStoreys ?? 3
    const maxH = typeRules.maxHeightM ?? 10
    rows.push({
      ruleId: 'lowrise-limits',
      label: 'Low-rise definition',
      requirement: `Low-rise residential: <= ${maxStoreys} storeys and <= ${maxH} m.`,
      actual: `${design.floors} floors, ${m(design.heightM, 1)}`,
      allowed: `<= ${maxStoreys} floors, <= ${maxH} m`,
      pass: design.floors <= maxStoreys && design.heightM <= maxH + EPS,
      source: `${typeRules.label}; BMA-BL-2544 ข้อ 50 exemption (rules JSON buildingTypes.lowRiseResidential)`,
    })
  }

  // 11. Floor-to-floor legal minimum (informational unless breached).
  const legalMin = ruleNumber(rules, 'floor-to-floor', 'legalMinM')
  rows.push({
    ruleId: 'floor-to-floor',
    label: 'Floor-to-floor minimum',
    requirement: `Dwelling floor-to-floor >= ${legalMin} m.`,
    actual: m(design.floorToFloorM, 2),
    allowed: `>= ${legalMin} m`,
    pass: design.floorToFloorM >= legalMin - EPS,
    source: src('floor-to-floor'),
  })

  const counted = rows.filter((r) => !r.informational)
  const passed = counted.filter((r) => r.pass).length
  return { rows, pass: passed === counted.length, passed, total: counted.length, designRegime }
}
