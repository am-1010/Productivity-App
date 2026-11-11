/** Local calendar day as 'YYYY-MM-DD'. Not toISOString(), which is UTC. */
export const localDay = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`