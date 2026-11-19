export function HowToRead() {
  return (
    <details className="howto">
      <summary>How to read this</summary>
      <dl className="howto-list">
        <dt>Regime</dt>
        <dd>
          <em>Standard</em> applies MR-55 setbacks (2-3 m) and the Bangkok bylaw. Once a building reaches 23 m or 10,000 m² it is a high-rise /
          extra-large building and <em>MR-33</em> replaces them with 6 m clearance all round, a 10 m (18 m above 30,000 m²) road and a fire
          road. The tool switches automatically and shows what the other route would give.
        </dd>
        <dt>Binding rule</dt>
        <dd>
          Which rule stops the building growing: <em>height</em> (2 x distance to the far side of the road), <em>FAR</em> (8 x plot area), or the
          open-space rules that limit the footprint.
        </dd>
        <dt>Layers</dt>
        <dd>
          <span className="swatch plot" /> plot · <span className="swatch front" /> front edge · <span className="swatch stage-roadSetback" /> road
          setback strip · <span className="swatch stage-boundarySetback" /> boundary setback band · <span className="swatch stage-openSpace" />{' '}
          open-space shrink · <span className="swatch stage-envelope" /> buildable envelope (translucent, to the height cap) ·{' '}
          <span className="swatch design" /> selected concept design.
        </dd>
        <dt>Numbers</dt>
        <dd>
          Each number carries the id of the rule it comes from; hover for the clause and formula. <span className="assumed-badge">assumed</span>{' '}
          marks values the research could not take from a primary text.
        </dd>
      </dl>
    </details>
  )
}
