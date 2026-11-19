import { OVERRIDE_EXTRA_FLOORS, type DesignId } from '../designs/types'
import { useAppStore, useDesigns, usePipelineResult, type DesignWithChecks } from '../store'

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const n1 = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

function DesignCard({ item, selected, onSelect }: { item: DesignWithChecks; selected: boolean; onSelect: () => void }) {
  const { design, checks } = item
  return (
    <button type="button" className={`design-card${selected ? ' selected' : ''}${checks.pass ? '' : ' failing'}`} onClick={onSelect} aria-pressed={selected}>
      <div className="design-card-head">
        <strong>{design.name}</strong>
        <span className={`badge ${checks.pass ? 'ok' : 'fail'}`}>
          {checks.passed}/{checks.total}
        </span>
      </div>
      <div className="design-card-stats">
        <span>{design.floors} fl · {n1(design.heightM)} m</span>
        <span>GFA {n0(design.gfaM2)} m²</span>
        <span>footprint {n0(design.footprintAreaM2)} m² ({Math.round(design.coverage * 100)}%)</span>
      </div>
    </button>
  )
}

export function DesignsPanel() {
  const pipeline = usePipelineResult()
  const designs = useDesigns()
  const selectedId = useAppStore((s) => s.selectedDesignId)
  const selectDesign = useAppStore((s) => s.selectDesign)
  const overrides = useAppStore((s) => s.designOverrides)
  const setOverride = useAppStore((s) => s.setDesignOverride)
  const resetOverrides = useAppStore((s) => s.resetDesignOverrides)

  if (!pipeline.ok || !pipeline.envelope) {
    return <p className="muted">Concept designs appear once the envelope exists.</p>
  }
  if (designs.length === 0) return <p className="muted">No template fits this envelope.</p>

  const selected = designs.find((d) => d.design.id === selectedId) ?? designs[0]
  const { design, checks } = selected
  const ov = overrides[design.id] ?? {}
  const maxSlider = pipeline.envelope.maxFloors + OVERRIDE_EXTRA_FLOORS
  const hasOverride = ov.floors !== undefined || ov.ignoreSetbacks

  return (
    <div className="designs">
      <div className="design-cards">
        {designs.map((item) => (
          <DesignCard key={item.design.id} item={item} selected={item.design.id === selected.design.id} onSelect={() => selectDesign(item.design.id as DesignId)} />
        ))}
      </div>

      <p className="hint">{design.description}</p>
      <ul className="design-notes">
        {design.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>

      <div className="overrides">
        <label className="slider">
          <span>
            Floors <strong>{design.floors}</strong>
            {ov.floors !== undefined && <span className="sub-inline"> (template {design.defaults.floors})</span>}
          </span>
          <input
            type="range"
            min={1}
            max={maxSlider}
            step={1}
            value={design.floors}
            onChange={(e) => setOverride(design.id, { floors: Number(e.target.value) })}
            aria-label="Design floors override"
          />
          <span className="sub">Push past {pipeline.envelope.maxFloors} to see the height / FAR rows fail.</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={Boolean(ov.ignoreSetbacks)} onChange={(e) => setOverride(design.id, { ignoreSetbacks: e.target.checked })} />
          Ignore setbacks (build to the plot line)
        </label>
        {hasOverride && (
          <button type="button" className="link" onClick={() => resetOverrides(design.id)}>
            Reset to template
          </button>
        )}
      </div>

      <div className={`verdict ${checks.pass ? 'ok' : 'fail'}`}>
        {checks.pass ? 'Passes' : 'Fails'} {checks.passed}/{checks.total} checks
        {checks.designRegime === 'highRise' && pipeline.regime === 'standard' && <span className="sub"> · this design triggers MR-33 on its own</span>}
      </div>

      <table className="checklist">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Actual</th>
            <th>Allowed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {checks.rows.map((r) => (
            <tr key={r.ruleId + r.label} className={r.informational ? 'info' : r.pass ? 'pass' : 'fail'} title={`${r.requirement}\n${r.source}${r.note ? `\n${r.note}` : ''}`}>
              <td>
                {r.label}
                <span className="sub">{r.ruleId}</span>
              </td>
              <td>{r.actual}</td>
              <td>{r.allowed}</td>
              <td className="status">{r.informational ? 'n/a' : r.pass ? 'pass' : 'FAIL'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {checks.rows.some((r) => r.note) && (
        <ul className="design-notes">
          {checks.rows
            .filter((r) => r.note)
            .map((r) => (
              <li key={r.ruleId + 'note'}>
                <strong>{r.label}:</strong> {r.note}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
