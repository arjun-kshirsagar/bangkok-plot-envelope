import { useAppStore } from '../store'
import { loadExamplePlot } from './example'

export function EmptyState() {
  const setMode = useAppStore((s) => s.setMode)
  const mode = useAppStore((s) => s.mode)
  return (
    <div className="empty-card">
      <h2>Three steps</h2>
      <ol className="steps">
        <li>
          <strong>Draw the plot</strong>
          <span>Click the corners on the map, close on the first point.</span>
        </li>
        <li>
          <strong>Pick the front edge</strong>
          <span>Click the edge that faces the road.</span>
        </li>
        <li>
          <strong>Set road width and building type</strong>
          <span>The envelope, concept designs and checklist update live.</span>
        </li>
      </ol>
      <div className="button-row">
        <button type="button" className={mode === 'draw' ? 'primary active' : 'primary'} onClick={() => setMode('draw')}>
          Draw plot
        </button>
        <button type="button" onClick={loadExamplePlot}>
          Load example plot
        </button>
      </div>
      <p className="hint">Example: 40 x 40 m on a 12 m soi in ย.10-4, the worked case from the research notes.</p>
    </div>
  )
}
