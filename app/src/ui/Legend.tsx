import { useAppStore } from '../store'

export function Legend() {
  const buildingsSource = useAppStore((s) => s.buildingsSource)
  const hasEnvelope = useAppStore((s) => s.plot !== null && s.frontEdgeIndex !== null)
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-row">
        <span className="swatch plot" /> Plot
      </div>
      <div className="legend-row">
        <span className="swatch front" /> Front (road) edge
      </div>
      {hasEnvelope && (
        <>
          <div className="legend-row">
            <span className="swatch stage-roadSetback" /> Road setback
          </div>
          <div className="legend-row">
            <span className="swatch stage-boundarySetback" /> Boundary setback
          </div>
          <div className="legend-row">
            <span className="swatch stage-openSpace" /> Open-space shrink
          </div>
          <div className="legend-row">
            <span className="swatch stage-envelope" /> Buildable envelope
          </div>
          <div className="legend-row">
            <span className="swatch design" /> Selected concept design
          </div>
        </>
      )}
      <div className="legend-row">
        <span className="swatch zone" /> Zone Y.10 (approx.)
      </div>
      <div className="legend-row">
        <span className="swatch building" /> Existing buildings{buildingsSource === 'overpass' ? ' (Overpass)' : ''}
      </div>
    </div>
  )
}
