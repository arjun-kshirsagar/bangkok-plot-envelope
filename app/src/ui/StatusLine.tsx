import { useMapStatus } from '../map/mapStatus'
import { useAppStore } from '../store'

export function StatusLine() {
  const tilesLoading = useMapStatus((s) => s.tilesLoading)
  const roadLookup = useAppStore((s) => s.roadWidthSource.kind === 'lookup')
  const buildingsSource = useAppStore((s) => s.buildingsSource)
  const mode = useAppStore((s) => s.mode)
  let text: string
  let busy = false
  if (roadLookup) {
    text = 'Looking up the road in OpenStreetMap…'
    busy = true
  } else if (tilesLoading) {
    text = 'Loading map tiles…'
    busy = true
  } else if (mode === 'draw') {
    text = 'Drawing: click corners, close on the first point. Enter finishes, Esc cancels.'
  } else if (mode === 'pickFront') {
    text = 'Click the plot edge that faces the road.'
  } else if (mode === 'edit') {
    text = 'Editing: drag vertices or midpoints, right-click a vertex to remove it, Delete removes the plot.'
  } else {
    text =
      buildingsSource === 'overpass'
        ? 'Buildings from Overpass (height / levels x 3.5 m / 12 m).'
        : buildingsSource === 'overpass-failed'
          ? 'Building heights unavailable.'
          : 'Building heights from OpenFreeMap tiles.'
  }
  return (
    <div className={`status-line${busy ? ' busy' : ''}`} role="status" aria-live="polite">
      <span className="status-dot" />
      {text}
    </div>
  )
}
