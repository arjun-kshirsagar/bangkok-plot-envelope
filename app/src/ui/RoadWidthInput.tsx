import { useEffect, useState } from 'react'

interface Props {
  valueM: number
  onCommit: (m: number) => void
}

/** Number input that can be cleared while typing; commits on a valid parse or blur. */
export function RoadWidthInput({ valueM, onCommit }: Props) {
  const [text, setText] = useState(String(valueM))
  useEffect(() => {
    setText(String(valueM))
  }, [valueM])

  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'))
    if (Number.isFinite(v) && v > 0 && v <= 200) {
      if (Math.abs(v - valueM) > 1e-9) onCommit(v)
      return true
    }
    return false
  }

  return (
    <div className="input-row">
      <input
        id="road-width"
        type="number"
        inputMode="decimal"
        min={1}
        max={200}
        step={0.5}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => {
          if (!commit(text)) setText(String(valueM))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <span className="unit">m</span>
    </div>
  )
}
