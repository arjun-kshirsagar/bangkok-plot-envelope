import type { StageId } from '../engine/pipeline'
import { useAppStore } from '../store'

const STAGES: Array<{ id: StageId; label: string; cls: string }> = [
  { id: 'roadSetback', label: 'Road setback', cls: 'stage-roadSetback' },
  { id: 'boundarySetback', label: 'Boundary setback', cls: 'stage-boundarySetback' },
  { id: 'openSpace', label: 'Open-space shrink', cls: 'stage-openSpace' },
  { id: 'envelope', label: 'Envelope', cls: 'stage-envelope' },
]

export function Legend() {
  const hasEnvelope = useAppStore((s) => s.plot !== null && s.frontEdgeIndex !== null)
  const visibility = useAppStore((s) => s.stageVisibility)
  const toggle = useAppStore((s) => s.toggleStage)
  return (
    <div className="legend" aria-label="Legend and layer toggles">
      <div className="legend-row">
        <span className="swatch plot" /> Plot
      </div>
      <div className="legend-row">
        <span className="swatch front" /> Front edge
      </div>
      {hasEnvelope &&
        STAGES.map((st) => (
          <label key={st.id} className="legend-row toggle">
            <input type="checkbox" checked={visibility[st.id]} onChange={() => toggle(st.id)} aria-label={`Toggle ${st.label}`} />
            <span className={`swatch ${st.cls}`} /> {st.label}
          </label>
        ))}
      {hasEnvelope && (
        <div className="legend-row">
          <span className="swatch design" /> Concept design
        </div>
      )}
      <div className="legend-row muted">
        <span className="swatch zone" /> Zone Y.10
      </div>
      <div className="legend-row muted">
        <span className="swatch building" /> Buildings
      </div>
    </div>
  )
}
