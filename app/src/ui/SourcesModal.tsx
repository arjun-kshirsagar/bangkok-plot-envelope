import { useEffect, useRef } from 'react'
import sourcesMd from '../rules/SOURCES.md?raw'
import { ZONE_RULES } from '../rules'

interface SourceRow {
  id: string
  title: string
  year: string
  used: string
  url: string | null
}

/** Parses the two tables of docs/SOURCES.md (ID | Document | ... ) into rows. */
function parseSources(md: string): { primary: SourceRow[]; secondary: SourceRow[] } {
  const primary: SourceRow[] = []
  const secondary: SourceRow[] = []
  let section: 'primary' | 'secondary' | null = null
  for (const line of md.split('\n')) {
    if (line.startsWith('## Primary')) section = 'primary'
    else if (line.startsWith('## Secondary')) section = 'secondary'
    else if (line.startsWith('## ')) section = null
    if (!section || !line.startsWith('| ') || line.startsWith('| ID') || line.startsWith('|---')) continue
    const cells = line
      .slice(1, -1)
      .split(' | ')
      .map((c) => c.trim())
    const url = cells.join(' ').match(/https?:\/\/[^\s)]+/)?.[0] ?? null
    if (section === 'primary' && cells.length >= 5) {
      primary.push({ id: cells[0], title: cells[1], year: cells[3], used: cells[4], url })
    } else if (section === 'secondary' && cells.length >= 3) {
      secondary.push({ id: cells[0], title: cells[1], year: '', used: cells[2], url })
    }
  }
  return { primary, secondary }
}

const SOURCES = parseSources(sourcesMd)
const ASSUMED = ZONE_RULES.rules.filter((r) => r.assumed)

export function SourcesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="sources-title">
      <div className="modal-head">
        <h2 id="sources-title">Sources & assumptions</h2>
        <button type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <p className="muted">
          Zone {ZONE_RULES.zone.code} ({ZONE_RULES.zone.thaiCode}), Bangkok Comprehensive Plan B.E. 2556 (2013), still in force in November 2026
          under the Town Planning Act B.E. 2562 transitional provisions. Every number in the rule set cites one of these documents and a clause
          (ข้อ). Indicative only, not a permit assessment.
        </p>

        <h3>Primary documents</h3>
        <ul className="source-list">
          {SOURCES.primary.map((s) => (
            <li key={s.id}>
              <strong>{s.id}</strong> <span>{s.title}</span> {s.year && <span className="muted">({s.year})</span>}
              <div className="sub">{s.used}</div>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.url.replace(/^https?:\/\//, '').slice(0, 60)}
                </a>
              )}
            </li>
          ))}
        </ul>

        <h3>Assumed values ({ASSUMED.length})</h3>
        <p className="muted small">Rules flagged <span className="assumed-badge">assumed</span> in the rule set: judgement calls logged in docs/DECISIONS.md.</p>
        <ul className="source-list">
          {ASSUMED.map((r) => (
            <li key={r.id}>
              <strong>{r.id}</strong>
              <div className="sub">{r.formula}</div>
              <div className="sub muted">{r.source}</div>
            </li>
          ))}
        </ul>

        <h3>Secondary sources</h3>
        <ul className="source-list compact">
          {SOURCES.secondary.map((s) => (
            <li key={s.id}>
              <strong>{s.id}</strong> <span className="sub">{s.used}</span>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  )
}
