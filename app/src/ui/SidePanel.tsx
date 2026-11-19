import { useState } from 'react'
import { STAGE_IDS, ruleSource, type StageId } from '../engine/pipeline'
import { MAX_PLOT_VERTICES } from '../engine/plot'
import { BUILDING_TYPES, ZONE_RULES, isBuildingType } from '../rules'
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

const MODE_HINTS: Record<string, string> = {
  idle: 'Draw a plot to begin, or move the map with drag (rotate with right-drag or Ctrl+drag).',
  draw: 'Click to place vertices. Click the first point or double-click to close. Esc cancels.',
  edit: 'Drag a vertex to move it, drag a midpoint to add a vertex, right-click a vertex to remove it. Delete key removes the plot.',
  pickFront: 'Click the edge of the plot that faces the road. Esc cancels.',
}

const STAGE_LABELS: Record<StageId, string> = {
  plot: 'Plot',
  roadSetback: 'Road setback',
  boundarySetback: 'Boundary setback',
  height: 'Height cap',
  far: 'FAR',
  openSpace: 'Open space',
  envelope: 'Envelope',
}

const TOGGLEABLE: StageId[] = ['roadSetback', 'boundarySetback', 'openSpace', 'envelope']

function Src({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null
  return (
    <span className="src" title={ids.map((id) => `${id}: ${ruleSource(ZONE_RULES, id)}`).join('\n')}>
      {ids.join(', ')}
    </span>
  )
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const n1 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const n2 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 2 })

export function SidePanel() {
  const plot = useAppStore((s) => s.plot)
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const clearPlot = useAppStore((s) => s.clearPlot)
  const frontEdgeIndex = useAppStore((s) => s.frontEdgeIndex)
  const roadWidthM = useAppStore((s) => s.roadWidthM)
  const roadWidthSource = useAppStore((s) => s.roadWidthSource)
  const roadInfo = useAppStore((s) => s.roadInfo)
  const setRoadWidth = useAppStore((s) => s.setRoadWidth)
  const buildingType = useAppStore((s) => s.buildingType)
  const setBuildingType = useAppStore((s) => s.setBuildingType)
  const floorToFloorM = useAppStore((s) => s.floorToFloorM)
  const setFloorToFloor = useAppStore((s) => s.setFloorToFloor)
  const buildingsSource = useAppStore((s) => s.buildingsSource)
  const stageVisibility = useAppStore((s) => s.stageVisibility)
  const toggleStage = useAppStore((s) => s.toggleStage)

  const area = usePlotArea()
  const edges = usePlotEdges()
  const frontEdge = useFrontEdge()
  const validation = usePlotValidation()
  const pipeline = usePipelineResult()
  const zone = useZone()

  const [copied, setCopied] = useState(false)
  const [showStages, setShowStages] = useState(true)
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
        <h1>Bangkok plot feasibility</h1>
        <p className="muted">
          Zone {ZONE_RULES.zone.code} ({ZONE_RULES.zone.thaiCode}), Sukhumvit Phrom Phong - Thong Lo. FAR {ZONE_RULES.zone.far}, OSR {ZONE_RULES.zone.osrPercent}%.
        </p>
      </header>

      <section className="section">
        <h2>1 · Plot</h2>
        <div className="button-row">
          <button type="button" className={mode === 'draw' ? 'primary active' : 'primary'} onClick={() => setMode('draw')}>
            {hasPlot ? 'Redraw plot' : 'Draw plot'}
          </button>
          <button type="button" className={mode === 'edit' ? 'active' : ''} disabled={!hasPlot} onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}>
            {mode === 'edit' ? 'Done editing' : 'Edit vertices'}
          </button>
          <button type="button" className="danger" disabled={!hasPlot} onClick={clearPlot}>
            Delete
          </button>
        </div>
        <p className="hint">{MODE_HINTS[mode]}</p>
        <dl className="kv">
          <dt>Area</dt>
          <dd>
            <strong>{formatArea(area)}</strong>
            {area !== null && <span className="sub">{formatThaiLandUnits(area)}</span>}
          </dd>
          <dt>Vertices</dt>
          <dd>
            {edges.length || '—'}
            {edges.length > 0 && <span className="sub-inline"> (max {MAX_PLOT_VERTICES})</span>}
          </dd>
          <dt>Perimeter</dt>
          <dd>{formatLength(edges.length ? edges.reduce((s, e) => s + e.lengthM, 0) : null)}</dd>
          <dt>Zone</dt>
          <dd>
            {zone === null ? (
              <span className="muted">—</span>
            ) : zone.subzone ? (
              <span className="badge ok">inside {zone.subzone.code} · FAR {zone.subzone.far} · OSR {zone.subzone.osrPercent}%</span>
            ) : (
              <span className="badge warn">Plot is outside zone Y.10 (approximate boundary); Y.10 rules still applied</span>
            )}
          </dd>
        </dl>
        {hasPlot && !plotOk && <p className="warn">{validation.reason}</p>}
      </section>

      <section className="section">
        <h2>2 · Road</h2>
        <div className="button-row">
          <button
            type="button"
            className={mode === 'pickFront' ? 'active' : ''}
            disabled={!plotOk}
            onClick={() => setMode(mode === 'pickFront' ? 'idle' : 'pickFront')}
          >
            {mode === 'pickFront' ? 'Cancel picking' : frontEdge ? 'Re-pick front edge' : 'Pick front edge'}
          </button>
        </div>
        <dl className="kv">
          <dt>Front edge</dt>
          <dd>
            {frontEdge ? (
              <>
                <span className="swatch front" /> edge {frontEdgeIndex! + 1} of {edges.length}, {formatLength(frontEdge.lengthM)}
              </>
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
      </section>

      <section className="section">
        <h2>3 · Building</h2>
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
        <p className="hint">{BUILDING_TYPES.find((t) => t.id === buildingType)?.description}</p>
        <label className="slider">
          <span>
            Floor-to-floor <strong>{n2(floorToFloorM)} m</strong>
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
          <span className="sub">Legal minimum 2.6 m for dwellings (MR-55 ข้อ 22); 3.0 m is a typical Bangkok condo.</span>
        </label>
      </section>

      <section className="section">
        <h2>4 · Envelope</h2>
        {!pipeline.ok || !env ? (
          <>
            <p className="muted">{pipeline.annotations[0] ?? 'Draw a valid plot and pick its front edge to see the buildable envelope.'}</p>
            {pipeline.stages.find((s) => s.id === 'envelope')?.annotations.map((a, i) => (
              <p key={i} className="warn">
                {a}
              </p>
            ))}
          </>
        ) : (
          <>
            <div className={`regime regime-${pipeline.regime}`}>
              <strong>{pipeline.regime === 'highRise' ? 'High-rise / extra-large regime (MR-33)' : 'Standard regime (MR-55 + BMA bylaw)'}</strong>
              <span className="sub">{pipeline.regimeReason}</span>
            </div>
            {pipeline.warnings.map((w, i) => (
              <p key={i} className="warn">
                {w}
              </p>
            ))}
            <table className="numbers">
              <tbody>
                <tr>
                  <th>Plot area</th>
                  <td>{n0(stage('plot')?.numbers.plotAreaM2 ?? 0)} m²</td>
                  <td>
                    <Src ids={['road-width-definition']} />
                  </td>
                </tr>
                <tr>
                  <th>Front (road) setback</th>
                  <td>{n2(stage('roadSetback')?.numbers.frontSetbackM ?? 0)} m</td>
                  <td>
                    <Src ids={stage('roadSetback')?.sources ?? []} />
                  </td>
                </tr>
                <tr>
                  <th>Boundary setback</th>
                  <td>{n2(stage('boundarySetback')?.numbers.boundarySetbackM ?? 0)} m</td>
                  <td>
                    <Src ids={stage('boundarySetback')?.sources ?? []} />
                  </td>
                </tr>
                <tr>
                  <th>Footprint</th>
                  <td>
                    {n0(env.footprintAreaM2)} m² <span className="sub-inline">({Math.round(env.coverage * 100)}% coverage, limited by {env.footprintLimitedBy === 'setbacks' ? 'setbacks' : env.footprintLimitedBy === 'osr' ? 'OSR 4%' : '30% open space'})</span>
                  </td>
                  <td>
                    <Src ids={stage('openSpace')?.sources ?? []} />
                  </td>
                </tr>
                <tr>
                  <th>Max height</th>
                  <td>{n1(env.maxHeightM)} m</td>
                  <td>
                    <Src ids={['mr55-height-road']} />
                  </td>
                </tr>
                <tr>
                  <th>Max floors</th>
                  <td>
                    {env.maxFloors} <span className="sub-inline">({n1(env.heightM)} m built; by height {env.floorsByHeight}, by FAR {env.floorsByFar})</span>
                  </td>
                  <td>
                    <Src ids={['floor-to-floor', 'height-measurement']} />
                  </td>
                </tr>
                <tr>
                  <th>GFA cap (FAR {ZONE_RULES.zone.far})</th>
                  <td>{n0(env.maxGfaM2)} m²</td>
                  <td>
                    <Src ids={['zone-far', 'far-counts-all-floors']} />
                  </td>
                </tr>
                {env.gfaCapM2 < env.maxGfaM2 - 0.5 && (
                  <tr>
                    <th>GFA cap applied</th>
                    <td>
                      {n0(env.gfaCapM2)} m² <span className="sub-inline">(MR-33 ข้อ 2 road tier)</span>
                    </td>
                    <td>
                      <Src ids={['mr33-road-access']} />
                    </td>
                  </tr>
                )}
                <tr>
                  <th>GFA in envelope</th>
                  <td>
                    {n0(env.gfaM2)} m² <span className="sub-inline">({Math.round((100 * env.gfaM2) / env.gfaCapM2)}% of cap)</span>
                  </td>
                  <td />
                </tr>
                <tr>
                  <th>Open space</th>
                  <td>
                    {n0(env.openSpaceM2)} m² <span className="sub-inline">(need {n0(env.openSpaceRequiredM2)}; OSR {n1((100 * env.openSpaceM2) / Math.max(env.gfaM2, 1))}% of GFA)</span>
                  </td>
                  <td>
                    <Src ids={['zone-osr', 'bcl-open-space-plot']} />
                  </td>
                </tr>
                <tr>
                  <th>Binding rule</th>
                  <td>
                    <span className={`badge ${env.bindingRule}`}>{env.bindingRule === 'height' ? 'Height (2 x road)' : env.bindingRule === 'far' ? 'FAR' : 'Footprint'}</span>
                  </td>
                  <td />
                </tr>
                {env.parking && (
                  <tr>
                    <th>Parking (indicative)</th>
                    <td>
                      {env.parking.spaces} spaces, {n0(env.parking.areaM2)} m² <span className="sub-inline">saleable ~{n0(env.parking.saleableGfaM2)} m²</span>
                    </td>
                    <td>
                      <Src ids={['bma-parking-indicative']} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {pipeline.alternatives.length > 0 && (
              <div className="alternatives">
                {pipeline.alternatives.map((alt) => (
                  <div key={alt.label} className="alt">
                    <strong>{alt.label}</strong>
                    <span>
                      {alt.maxFloors} floors · {n1(alt.heightM)} m · footprint {n0(alt.footprintAreaM2)} m² · GFA {n0(alt.gfaM2)} m²
                    </span>
                    <span className="sub">{alt.note}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="stage-toggles">
              {TOGGLEABLE.map((id) => (
                <label key={id} className="toggle">
                  <input type="checkbox" checked={stageVisibility[id]} onChange={() => toggleStage(id)} />
                  <span className={`swatch stage-${id}`} /> {STAGE_LABELS[id]}
                </label>
              ))}
            </div>

            <button type="button" className="link" onClick={() => setShowStages((v) => !v)}>
              {showStages ? 'Hide' : 'Show'} rule-by-rule notes
            </button>
            {showStages && (
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
                        <Src ids={st.sources} />
                      </li>
                    ),
                )}
              </ol>
            )}
          </>
        )}
      </section>

      <section className="section">
        <h2>5 · Concept designs</h2>
        <DesignsPanel />
      </section>

      <footer className="panel-footer">
        <button type="button" onClick={copyLink} disabled={!hasPlot}>
          {copied ? 'Link copied' : 'Copy link to this scene'}
        </button>
        <p className="muted small">
          Buildings: OpenStreetMap via{' '}
          {buildingsSource === 'tiles' && 'OpenFreeMap tiles (render_height)'}
          {buildingsSource === 'overpass' && 'Overpass API (height / levels × 3.5 m / 12 m)'}
          {buildingsSource === 'overpass-failed' && 'Overpass API (unreachable, heights missing)'}
          {buildingsSource === 'unknown' && 'OpenFreeMap tiles (checking heights…)'}
          . Zone boundary from BMA GIS, approximate (±50-100 m). Lengths and areas are planar in UTM 47N (EPSG:32647). Rules as of Nov 2026: Bangkok Comprehensive Plan B.E. 2556, MR-55, MR-33, BMA Building Bylaw B.E. 2544. Not legal advice.
        </p>
      </footer>
    </aside>
  )
}
