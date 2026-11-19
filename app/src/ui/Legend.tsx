import { useAppStore } from '../store'

export function Legend() {
  const buildingsSource = useAppStore((s) => s.buildingsSource)
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-row">
        <span className="swatch plot" /> Plot
      </div>
      <div className="legend-row">
        <span className="swatch front" /> Front (road) edge
      </div>
      <div className="legend-row">
        <span className="swatch building" /> Existing buildings{buildingsSource === 'overpass' ? ' (Overpass)' : ''}
      </div>
    </div>
  )
}
