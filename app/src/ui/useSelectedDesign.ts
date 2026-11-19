import { useAppStore, useDesigns, type DesignWithChecks } from '../store'

export function useSelectedDesign(): { designs: DesignWithChecks[]; selected: DesignWithChecks | null } {
  const designs = useDesigns()
  const selectedId = useAppStore((s) => s.selectedDesignId)
  const selected = designs.find((d) => d.design.id === selectedId) ?? designs[0] ?? null
  return { designs, selected }
}
