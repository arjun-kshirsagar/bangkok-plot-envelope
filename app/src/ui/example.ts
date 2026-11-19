import { decodeScene, useAppStore } from '../store'
import { fitToPlot } from '../map/mapStatus'

/** Worked example from docs/RESEARCH.md: 40 x 40 m plot in ย.10-4 on a 12 m soi, condo. */
export const EXAMPLE_HASH =
  '#plot=100.5724,13.7363;100.5727699,13.7363;100.5727699,13.73666175;100.5724,13.73666175&front=0&road=12&type=condo'

export function loadExamplePlot(): void {
  const scene = decodeScene(EXAMPLE_HASH)
  const s = useAppStore.getState()
  s.hydrate({
    plot: scene.plot,
    frontEdgeIndex: scene.frontEdgeIndex,
    roadWidthM: scene.roadWidthM ?? 12,
    roadWidthSource: { kind: 'link', detail: 'Worked example (docs/RESEARCH.md): 12 m soi.' },
    buildingType: scene.buildingType ?? 'condo',
    floorToFloorM: 3,
  })
  s.setRoadInfo('example soi')
  s.setMode('idle')
  // Let the map pick the plot up, then frame it.
  setTimeout(() => fitToPlot(useAppStore.getState().plot), 50)
}
