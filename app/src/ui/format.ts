/** Number formatting lives in ui/ only; the engine and store stay in raw metres. */
const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export function formatArea(m2: number | null | undefined): string {
  if (m2 === null || m2 === undefined || !Number.isFinite(m2)) return '—'
  return `${nf0.format(m2)} m²`
}

export function formatLength(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—'
  return `${nf1.format(m)} m`
}

/** 1 rai = 1,600 m2; 1 ngan = 400 m2; 1 sq wa = 4 m2 (Thai land units, shown alongside m2). */
export function formatThaiLandUnits(m2: number | null | undefined): string {
  if (m2 === null || m2 === undefined || !Number.isFinite(m2)) return ''
  const totalWa = m2 / 4
  const rai = Math.floor(totalWa / 400)
  const ngan = Math.floor((totalWa - rai * 400) / 100)
  const wa = totalWa - rai * 400 - ngan * 100
  return `${rai} rai ${ngan} ngan ${nf1.format(wa)} sq wa`
}
