import { useState } from 'react'
import { BUILDING_TYPES, isBuildingType } from '../rules'
import { useAppStore, useFrontEdge, usePipelineResult, usePlotArea, usePlotEdges, usePlotValidation } from '../store'
import { formatArea, formatLength, formatThaiLandUnits } from './format'

const MODE_HINTS: Record<string, string> = {
  idle: 'Draw a plot to begin, or move the map with drag (rotate with right-drag or Ctrl+drag).',
  draw: 'Click to place vertices. Click the first point or double-click to close. Esc cancels.',
  edit: 'Drag a vertex to move it, drag a midpoint to add a vertex, right-click a vertex to remove it. Delete key removes the plot.',
  pickFront: 'Click the edge of the plot that faces the road.',
}

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
  const buildingsSource = useAppStore((s) => s.buildingsSource)

  const area = usePlotArea()
  const edges = usePlotEdges()
  const frontEdge = useFrontEdge()
  const validation = usePlotValidation()
  const pipeline = usePipelineResult()

  const [copied, setCopied] = useState(false)
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

  return (
    <aside className="panel" aria-label="Inputs and results">
      <header className="panel-header">
        <h1>Bangkok plot feasibility</h1>
        <p className="muted">Sukhumvit / Asok. Draw a plot, pick its road edge, choose a building type.</p>
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
          <dd>{edges.length || '—'}</dd>
          <dt>Perimeter</dt>
          <dd>{formatLength(edges.length ? edges.reduce((s, e) => s + e.lengthM, 0) : null)}</dd>
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
            <label htmlFor="road-width">Road width</label>
          </dt>
          <dd>
            <div className="input-row">
              <input
                id="road-width"
                type="number"
                min={1}
                max={100}
                step={0.5}
                value={roadWidthM}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v) && v > 0) setRoadWidth(v, { kind: 'manual', detail: 'Entered manually.' })
                }}
              />
              <span className="unit">m</span>
            </div>
            <span className={`sub source source-${roadWidthSource.kind}`}>{roadWidthSource.detail}</span>
          </dd>
        </dl>
      </section>

      <section className="section">
        <h2>3 · Building type</h2>
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
      </section>

      <section className="section">
        <h2>4 · Envelope</h2>
        {pipeline.stages.length === 0 ? (
          <p className="muted">{pipeline.annotations[0] ?? 'Draw a valid plot and pick its front edge to see the buildable envelope.'}</p>
        ) : (
          <ul className="stages">
            {pipeline.stages.map((st) => (
              <li key={st.id}>
                <strong>{st.label}</strong>
                {st.annotations.map((a, i) => (
                  <div key={i} className="sub">
                    {a}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
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
          . Lengths and areas are planar in UTM 47N (EPSG:32647).
        </p>
      </footer>
    </aside>
  )
}
