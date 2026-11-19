import { useAppStore } from '../store'
import { loadExamplePlot, loadWorkedExample } from './example'

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
        <button type="button" onClick={loadWorkedExample}>
          Load worked example (docs)
        </button>
      </div>
      <p className="hint">Example: an open lot of about 2,300 m² on Soi Sukhumvit 53 (ย.10-4). Worked example: the 40 x 40 m plot on a 12 m soi from the research notes.</p>
    </div>
  )
}
