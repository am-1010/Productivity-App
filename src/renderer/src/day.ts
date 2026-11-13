/** Local calendar day as 'YYYY-MM-DD'. Not toISOString(), which is UTC. */
export const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 'YYYY-MM-DD' → a heading like "Tomorrow" or "Thursday, 12 November". */
export const dayHeading = (day: string, today: Date): string => {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow'
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(y !== today.getFullYear() ? { year: 'numeric' } : {})
  })
}
