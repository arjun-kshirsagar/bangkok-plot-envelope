/**
 * Checklist evaluators: (design, rules) -> pass/fail rows. Filled in Phase 4. Pure module.
 */

export type CheckStatus = 'pass' | 'fail' | 'n/a'

export interface CheckRow {
  id: string
  label: string
  status: CheckStatus
  actual: string
  allowed: string
  source: string
}

export function evaluateChecks(): CheckRow[] {
  return []
}
