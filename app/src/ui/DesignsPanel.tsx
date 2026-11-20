import { OVERRIDE_EXTRA_FLOORS, type DesignId } from '../designs/types'
import { selectUnavailableTemplates, useAppStore, usePipelineResult, type DesignWithChecks } from '../store'
import { useSelectedDesign } from './useSelectedDesign'

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
      <div className="design-card-stats num">
        <span>
          {design.floors} fl · {n1(design.heightM)} m
        </span>
        <span>GFA {n0(design.gfaM2)} m²</span>
        <span>
          footprint {n0(design.footprintAreaM2)} m² · {Math.round(design.coverage * 100)}%
        </span>
      </div>
    </button>
  )
}

export function DesignsPanel() {
  const pipeline = usePipelineResult()
  const { designs, selected } = useSelectedDesign()
  const selectDesign = useAppStore((s) => s.selectDesign)
  const overrides = useAppStore((s) => s.designOverrides)
  const setOverride = useAppStore((s) => s.setDesignOverride)
  const resetOverrides = useAppStore((s) => s.resetDesignOverrides)
  const settling = useAppStore((s) => s.plotSettling)

  if (!pipeline.ok || !pipeline.envelope) {
    return <p className="muted">Concept designs appear once the envelope exists.</p>
  }
  const unavailable = selectUnavailableTemplates(useAppStore.getState(), pipeline)
  const unavailableList =
    unavailable.length > 0 ? (
      <ul className="design-notes muted">
        {unavailable.map((u) => (
          <li key={u.id}>
            {u.name} not offered: {u.reason}
          </li>
        ))}
      </ul>
    ) : null
  if (!selected)
    return (
      <>
        <p className="muted">No template fits this envelope.</p>
        {unavailableList}
      </>
    )

  const { design } = selected
  const ov = overrides[design.id] ?? {}
  // Cover a larger override restored from a link, so the thumb is never clamped below the value.
  const maxSlider = Math.max(pipeline.envelope.maxFloors + OVERRIDE_EXTRA_FLOORS, ov.floors ?? 0, design.floors)
  const hasOverride = ov.floors !== undefined || ov.ignoreSetbacks

  return (
    <div className="designs">
      {settling && <p className="hint">Envelope follows the drag; designs and checks update when you let go.</p>}
      <div className="design-cards">
        {designs.map((item) => (
          <DesignCard key={item.design.id} item={item} selected={item.design.id === selected.design.id} onSelect={() => selectDesign(item.design.id as DesignId)} />
        ))}
      </div>
      {unavailableList}

      <p className="hint">{design.description}</p>
      <ul className="design-notes">
        {design.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>

      <div className="overrides">
        <div className="input-label">Stress-test this design</div>
        <label className="slider">
          <span>
            Floors <strong className="num">{design.floors}</strong>
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
          <span className="sub">
            {design.floorsCap !== undefined
              ? `Capped at ${design.floorsCap} storeys by the frontage rule; more floors will fail the frontage row.`
              : `Push past ${pipeline.envelope.maxFloors} floors to see the height and FAR rows fail.`}
          </span>
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
    </div>
  )
}
