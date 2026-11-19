export type CheckStatus = 'pass' | 'fail' | 'info'

export interface CheckRow {
  /** Rule id in rules/bangkok-zone.json (or a tool id for derived checks). */
  ruleId: string
  label: string
  /** One line: what the rule requires. */
  requirement: string
  actual: string
  allowed: string
  pass: boolean
  /** Informational rows do not count towards the overall verdict. */
  informational?: boolean
  source: string
  note?: string
}

export interface ChecklistResult {
  rows: CheckRow[]
  pass: boolean
  passed: number
  total: number
  /** Regime the design itself falls into (it may push itself into MR-33). */
  designRegime: 'standard' | 'highRise'
}
