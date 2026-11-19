import { usePipelineResult } from '../store'
import { RuleRef } from './RuleRef'
import { useSelectedDesign } from './useSelectedDesign'

export function Checklist() {
  const pipeline = usePipelineResult()
  const { selected } = useSelectedDesign()
  if (!selected) return <p className="muted">The checklist appears with the first concept design.</p>
  const { design, checks } = selected
  return (
    <div className="checklist-wrap">
      <div className={`verdict ${checks.pass ? 'ok' : 'fail'}`}>
        <span>
          {design.name}: {checks.pass ? 'passes' : 'fails'} {checks.passed}/{checks.total} checks
        </span>
        {checks.designRegime === 'highRise' && pipeline.regime === 'standard' && <span className="sub">This design triggers MR-33 on its own.</span>}
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
                <RuleRef ids={[r.ruleId]} />
              </td>
              <td className="num">{r.actual}</td>
              <td className="num">{r.allowed}</td>
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
