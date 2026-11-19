/**
 * Checklist evaluators: (design + rules -> pass/fail rows). Pure: no React, no map, no DOM.
 */
export * from './types'
export { evaluateChecks, containedWithin, frontage, CONTAINMENT_TOLERANCE_M } from './evaluate'
