import { decodeScene, useAppStore } from '../store'
import { fitToPlot, useMapStatus } from '../map/mapStatus'

/**
 * Demo site: an open lot / car park in the OpenFreeMap tiles on the west side of Soi
 * Sukhumvit 53, north of Sukhumvit Road, inside sub-zone ย.10-4. Five vertices, ~2,280 m2,
 * front edge on the soi. No OSM building footprint overlaps it (checked against the
 * building source layer). The 10 m right-of-way is an assumption, not a survey.
 */
export const EXAMPLE_HASH =
  '#plot=100.5777604,13.7260019;100.5776857,13.7252894;100.5774802,13.7252346;100.5774242,13.7256228;100.5775082,13.7259745&front=0&road=10&type=condo'

/** Worked example from docs/RESEARCH.md: 40 x 40 m plot in ย.10-4 on a 12 m soi, condo. */
export const WORKED_EXAMPLE_HASH =
  '#plot=100.5724,13.7363;100.5727699,13.7363;100.5727699,13.73666175;100.5724,13.73666175&front=0&road=12&type=condo'

function loadScene(hash: string, roadDetail: string, roadName: string, camera?: { bearing: number; pitch: number }): void {
  const scene = decodeScene(hash)
  const s = useAppStore.getState()
  s.hydrate({
    plot: scene.plot,
    frontEdgeIndex: scene.frontEdgeIndex,
    roadWidthM: scene.roadWidthM ?? 12,
    roadWidthSource: { kind: 'link', detail: roadDetail },
    buildingType: scene.buildingType ?? 'condo',
    floorToFloorM: 3,
  })
  s.setRoadInfo(roadName)
  s.setMode('idle')
  const map = useMapStatus.getState().map
  if (map && camera) map.jumpTo({ bearing: camera.bearing, pitch: camera.pitch })
  // Let the map pick the plot up, then frame it.
  setTimeout(() => fitToPlot(useAppStore.getState().plot), 50)
}

/** Open lot on Soi Sukhumvit 53, viewed from the south across the open ground (the soi side is built up). */
export function loadExamplePlot(): void {
  loadScene(EXAMPLE_HASH, 'Example: Soi Sukhumvit 53, assumed 10 m right-of-way (not surveyed).', 'Soi Sukhumvit 53 (example)', { bearing: -20, pitch: 55 })
}

/** The 40 x 40 m worked example of docs/RESEARCH.md (784 m2 footprint, 12 floors, 9,408 m2). */
export function loadWorkedExample(): void {
  loadScene(WORKED_EXAMPLE_HASH, 'Worked example (docs/RESEARCH.md): 12 m soi.', 'example soi', { bearing: -20, pitch: 55 })
}
