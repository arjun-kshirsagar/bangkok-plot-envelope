import { useState } from 'react'
import { STAGE_IDS, type StageId } from '../engine/pipeline'
import { MAX_PLOT_VERTICES } from '../engine/plot'
import { BUILDING_TYPES, ZONE_RULES, isBuildingType } from '../rules'
import { fitToPlot, goToPlotOutsideBounds, plotOutsideMaxBounds } from '../map/mapStatus'
import {
  FLOOR_TO_FLOOR_RANGE,
  useAppStore,
  useFrontEdge,
  usePipelineResult,
  usePlotArea,
  usePlotEdges,
  usePlotValidation,
  useZone,
} from '../store'
import { formatArea, formatLength, formatThaiLandUnits } from './format'
import { RoadWidthInput } from './RoadWidthInput'
import { DesignsPanel } from './DesignsPanel'
import { Checklist } from './Checklist'
import { EmptyState } from './EmptyState'
import { HowToRead } from './HowToRead'
import { RuleRef } from './RuleRef'
import { SourcesModal } from './SourcesModal'
import { StatusLine } from './StatusLine'

export const PRODUCT_NAME = 'Envelope BKK'

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const n1 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const n2 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 2 })

function Row({ label, value, sub, ids }: { label: string; value: string; sub?: string; ids?: string[] }) {
  return (
    <tr>
      <th>{label}</th>
      <td className="num">
        {value}
        {sub && <span className="sub-inline"> {sub}</span>}
      </td>
      <td className="refs">{ids && <RuleRef ids={ids} />}</td>
    </tr>
  )
}

export function SidePanel() {
  const plot = useAppStore((s) => s.plot)
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const drawNotice = useAppStore((s) => s.drawNotice)
  const clearPlot = useAppStore((s) => s.clearPlot)
  const frontEdgeIndex = useAppStore((s) => s.frontEdgeIndex)
  const roadWidthM = useAppStore((s) => s.roadWidthM)
  const roadWidthSource = useAppStore((s) => s.roadWidthSource)
  const roadInfo = useAppStore((s) => s.roadInfo)
  const setRoadWidth = useAppStore((s) => s.setRoadWidth)
  const buildingType = useAppStore((s) => s.buildingType)
  const typeRules = ZONE_RULES.buildingTypes[buildingType]
  const typeCapLabel = `low-rise cap: ${[typeRules?.maxStoreys !== undefined ? `${typeRules.maxStoreys} storeys` : null, typeRules?.maxHeightM !== undefined ? `${typeRules.maxHeightM} m` : null].filter(Boolean).join(' / ')}`
  const setBuildingType = useAppStore((s) => s.setBuildingType)
  const floorToFloorM = useAppStore((s) => s.floorToFloorM)
  const setFloorToFloor = useAppStore((s) => s.setFloorToFloor)

  const area = usePlotArea()
  const edges = usePlotEdges()
  const frontEdge = useFrontEdge()
  const validation = usePlotValidation()
  const pipeline = usePipelineResult()
  const zone = useZone()

  const [copied, setCopied] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const hasPlot = plot !== null
  const plotOk = validation.ok
  const env = pipeline.envelope
  const stage = (id: StageId) => pipeline.stages.find((s) => s.id === id)

  return (
    <aside className="panel" aria-label="Inputs and results">
      <header className="panel-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>{PRODUCT_NAME}</h1>
            <p className="muted">Plot feasibility · Sukhumvit zone {ZONE_RULES.zone.code}</p>
          </div>
        </div>
        <StatusLine />
      </header>

      {!hasPlot && <EmptyState />}

      <section className="section">
        <h2>
          <span className="step">1</span> Inputs
        </h2>
        <div className="input-group">
          <div className="input-label">Plot</div>
          <div className="button-row">
            <button type="button" className={mode === 'draw' ? 'primary active' : 'primary'} onClick={() => setMode('draw')}>
              {hasPlot ? 'Redraw' : 'Draw plot'}
            </button>
            <button type="button" className={mode === 'edit' ? 'active' : ''} disabled={!hasPlot} onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}>
              {mode === 'edit' ? 'Done' : 'Edit vertices'}
            </button>
            <button type="button" disabled={!hasPlot} onClick={() => fitToPlot(plot)} title="Frame the plot in the 3D view">
              Fit to plot
            </button>
            <button type="button" className="danger" disabled={!hasPlot} onClick={clearPlot}>
              Delete
            </button>
          </div>
          {hasPlot && (
            <dl className="kv">
              <dt>Area</dt>
              <dd className="num">
                <strong>{formatArea(area)}</strong>
                {area !== null && <span className="sub">{formatThaiLandUnits(area)}</span>}
              </dd>
              <dt>Perimeter</dt>
              <dd className="num">{formatLength(edges.length ? edges.reduce((s, e) => s + e.lengthM, 0) : null)}</dd>
              <dt>Vertices</dt>
              <dd className="num">
                {edges.length} <span className="sub-inline">of {MAX_PLOT_VERTICES} max</span>
              </dd>
            </dl>
          )}
          {hasPlot && !plotOk && <p className="warn">{validation.reason}</p>}
          {drawNotice && (mode === 'draw' || mode === 'edit' || !hasPlot) && (
            <p className="warn" role="status">
              {drawNotice}
            </p>
          )}
        </div>

        <div className="input-group">
          <div className="input-label">Road</div>
          <div className="button-row">
            <button
              type="button"
              className={mode === 'pickFront' ? 'active' : frontEdge ? '' : 'primary'}
              disabled={!plotOk}
              onClick={() => setMode(mode === 'pickFront' ? 'idle' : 'pickFront')}
            >
              {mode === 'pickFront' ? 'Cancel' : frontEdge ? 'Re-pick front edge' : 'Pick front edge'}
            </button>
          </div>
          <dl className="kv">
            <dt>Front edge</dt>
            <dd>
              {frontEdge ? (
                <span className="num">
                  <span className="swatch front" /> edge {frontEdgeIndex! + 1} of {edges.length} · {formatLength(frontEdge.lengthM)}
                </span>
              ) : (
                <span className="muted">not picked</span>
              )}
            </dd>
            <dt>Road</dt>
            <dd>{roadInfo ?? <span className="muted">—</span>}</dd>
            <dt>
              <label htmlFor="road-width">Right-of-way</label>
            </dt>
            <dd>
              <RoadWidthInput valueM={roadWidthM} onCommit={(m) => setRoadWidth(m, { kind: 'manual', detail: 'Entered manually.' })} />
              <span className={`sub source source-${roadWidthSource.kind}`}>{roadWidthSource.detail}</span>
            </dd>
          </dl>
        </div>

        <div className="input-group">
          <div className="input-label">Building</div>
          <select
            aria-label="Building type"
            value={buildingType}
            onChange={(e) => {
              if (isBuildingType(e.target.value)) setBuildingType(e.target.value)
            }}
          >
            {BUILDING_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="slider">
            <span>
              Floor-to-floor <strong className="num">{n2(floorToFloorM)} m</strong>
            </span>
            <input
              type="range"
              min={FLOOR_TO_FLOOR_RANGE[0]}
              max={FLOOR_TO_FLOOR_RANGE[1]}
              step={0.1}
              value={floorToFloorM}
              onChange={(e) => setFloorToFloor(Number(e.target.value))}
              aria-label="Floor-to-floor height in metres"
            />
            <span className="sub">
              Legal minimum 2.6 m for dwellings <RuleRef ids={['floor-to-floor']} />
            </span>
          </label>
        </div>
      </section>

      <section className="section">
        <h2>
          <span className="step">2</span> Zone
        </h2>
        <div className="zone-row">
          {zone === null ? (
            <span className="muted">Draw a plot to locate it in the plan.</span>
          ) : zone.subzone ? (
            <span className="badge ok">inside {zone.subzone.code}</span>
          ) : (
            <span className="badge warn">outside Y.10 (approx. boundary) · Y.10 rules still applied</span>
          )}
          <span className="num">
            FAR {ZONE_RULES.zone.far} · OSR {ZONE_RULES.zone.osrPercent}% · brown (ย.10) very-high-density residential
          </span>
          <RuleRef ids={['zone-far', 'zone-osr']} />
        </div>
        {zone?.straddles && (
          <p className="warn">
            The plot straddles {zone.straddles.join(' / ')}. The sub-zone containing its centroid is used ({zone.subzone?.code ?? 'outside Y.10'}); every Y.10 sub-zone carries the same FAR {ZONE_RULES.zone.far} and OSR {ZONE_RULES.zone.osrPercent}%.
          </p>
        )}
        {zone?.outsideMapArea && (
          <p className="warn">
            {plotOutsideMaxBounds(plot)
              ? 'This plot lies entirely outside the map area around Y.10 (it probably came from a link). Only Y.10 rules are modelled, so treat the result as indicative. '
              : 'Part of the plot lies outside the mapped Y.10 area. Only Y.10 rules are modelled, so treat the result as indicative for this location.'}
            {plotOutsideMaxBounds(plot) && (
              <button type="button" className="link inline" onClick={() => goToPlotOutsideBounds(plot)}>
                Go to plot
              </button>
            )}
          </p>
        )}
      </section>

      <section className="section">
        <h2>
          <span className="step">3</span> Rules & envelope
        </h2>
        {!pipeline.ok || !env ? (
          <>
            <p className="muted">{pipeline.annotations[0] ?? 'Pick the front edge to carve the envelope rule by rule.'}</p>
            {pipeline.stages.find((s) => s.id === 'envelope')?.annotations.map((a, i) => (
              <p key={i} className="warn">
                {a}
              </p>
            ))}
          </>
        ) : (
          <>
            <div className={`regime regime-${pipeline.regime}`}>
              <strong>{pipeline.regime === 'highRise' ? 'High-rise / extra-large regime · MR-33' : 'Standard regime · MR-55 + BMA bylaw'}</strong>
              <span className="sub">{pipeline.regimeReason}</span>
            </div>
            {pipeline.warnings.map((w, i) => (
              <p key={i} className="warn">
                {w}
              </p>
            ))}
            <table className="numbers">
              <tbody>
                <Row label="Plot area" value={`${n0(stage('plot')?.numbers.plotAreaM2 ?? 0)} m²`} ids={['road-width-definition']} />
                <Row label="Front (road) setback" value={`${n2(stage('roadSetback')?.numbers.frontSetbackM ?? 0)} m`} ids={stage('roadSetback')?.sources ?? []} />
                <Row label="Boundary setback" value={`${n2(stage('boundarySetback')?.numbers.boundarySetbackM ?? 0)} m`} ids={stage('boundarySetback')?.sources ?? []} />
                <Row
                  label="Footprint"
                  value={`${n0(env.footprintAreaM2)} m²`}
                  sub={`${Math.round(env.coverage * 100)}% coverage · limited by ${env.footprintLimitedBy === 'setbacks' ? 'setbacks' : env.footprintLimitedBy === 'osr' ? 'OSR 4%' : '30% open space'}`}
                  ids={stage('openSpace')?.sources ?? []}
                />
                <Row
                  label="Height cap"
                  value={`${n1(env.maxHeightM)} m`}
                  sub={env.heightCapBy === 'type' ? `${typeCapLabel} · 2 × (road + front setback) allows ${n1(env.roadHeightM)} m` : '2 × (road + front setback)'}
                  ids={env.heightCapBy === 'type' ? ['mr55-road-setback', 'mr55-height-road'] : ['mr55-height-road']}
                />
                <Row
                  label="Max floors"
                  value={`${env.maxFloors}`}
                  sub={`${n1(env.heightM)} m built · by height ${env.floorsByHeight}, by FAR ${env.floorsByFar}`}
                  ids={['floor-to-floor', 'height-measurement']}
                />
                <Row label={`GFA cap (FAR ${ZONE_RULES.zone.far})`} value={`${n0(env.maxGfaM2)} m²`} ids={['zone-far', 'far-counts-all-floors', 'far-bonus-ignored']} />
                {env.gfaCapM2 < env.maxGfaM2 - 0.5 && (
                  <Row
                    label="GFA cap applied"
                    value={`${n0(env.gfaCapM2)} m²`}
                    sub={env.gfaCapNote ?? 'MR-33 ข้อ 2 road tier'}
                    ids={env.gfaCapM2 <= ZONE_RULES.thresholds.extraLargeGfaM2 + 0.5 ? ['highrise-threshold', 'mr33-road-access'] : ['mr33-road-access']}
                  />
                )}
                <Row label="GFA in envelope" value={`${n0(env.gfaM2)} m²`} sub={`${Math.round((100 * env.gfaM2) / env.gfaCapM2)}% of cap`} />
                <Row
                  label="Open space"
                  value={`${n0(env.openSpaceM2)} m²`}
                  sub={`need ${n0(env.openSpaceRequiredM2)} · OSR ${n1((100 * env.openSpaceM2) / Math.max(env.gfaM2, 1))}% of GFA`}
                  ids={['zone-osr', 'bcl-open-space-plot']}
                />
                <tr>
                  <th>Binding rule</th>
                  <td colSpan={2}>
                    <span className={`badge ${env.bindingRule}`}>{env.bindingRule === 'height' ? (env.heightCapBy === 'type' ? `Height (${typeCapLabel})` : 'Height (2 × road)') : env.bindingRule === 'far' ? 'FAR' : 'Footprint'}</span>
                  </td>
                </tr>
                {env.parking && (
                  <Row
                    label="Parking (indicative)"
                    value={`${env.parking.spaces} spaces · ${n0(env.parking.areaM2)} m²`}
                    sub={`saleable ~${n0(env.parking.saleableGfaM2)} m²`}
                    ids={['bma-parking-indicative']}
                  />
                )}
              </tbody>
            </table>

            {pipeline.alternatives.length > 0 && (
              <div className="alternatives">
                {pipeline.alternatives.map((alt) => (
                  <div key={alt.label} className="alt">
                    <strong>{alt.label}</strong>
                    <span className="num">
                      {alt.maxFloors} floors · {n1(alt.heightM)} m · footprint {n0(alt.footprintAreaM2)} m² · GFA {n0(alt.gfaM2)} m²
                    </span>
                    <span className="sub">{alt.note}</span>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="link" onClick={() => setShowNotes((v) => !v)}>
              {showNotes ? 'Hide' : 'Show'} rule-by-rule notes
            </button>
            {showNotes && (
              <ol className="stages">
                {STAGE_IDS.map((id) => stage(id)).map(
                  (st) =>
                    st && (
                      <li key={st.id}>
                        <strong>{st.label}</strong>
                        {st.annotations.map((a, i) => (
                          <div key={i} className="sub">
                            {a}
                          </div>
                        ))}
                        <RuleRef ids={st.sources} />
                      </li>
                    ),
                )}
              </ol>
            )}
          </>
        )}
        <HowToRead />
      </section>

      <section className="section">
        <h2>
          <span className="step">4</span> Concept designs
        </h2>
        <DesignsPanel />
      </section>

      <section className="section">
        <h2>
          <span className="step">5</span> Checklist
        </h2>
        <Checklist />
      </section>

      <footer className="panel-footer">
        <button type="button" onClick={copyLink} disabled={!hasPlot}>
          {copied ? 'Link copied' : 'Copy link to this scene'}
        </button>
        <p className="muted small">
          Zone Y.10 rules, Bangkok Comprehensive Plan B.E. 2556 + Building Control regulations (MR-55, MR-33, BMA bylaw B.E. 2544). Indicative
          only, not a permit assessment.{' '}
          <button type="button" className="link inline" onClick={() => setSourcesOpen(true)}>
            Sources & assumptions
          </button>
        </p>
        <p className="muted small">Zone boundary from BMA GIS (±50-100 m). Lengths and areas planar in UTM 47N. Buildings © OpenStreetMap contributors.</p>
      </footer>
      <SourcesModal open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </aside>
  )
}
