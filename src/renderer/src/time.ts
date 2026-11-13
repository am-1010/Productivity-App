import type { Task } from '../../shared/types'

/** Minutes from midnight → 'HH:MM'. Wraps past midnight, so 1444 → '00:04'. */
export const fmt = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const fmtRange = (start: number, end?: number): string =>
  end == null ? fmt(start) : `${fmt(start)} - ${fmt(end)}`

export const isBlocked = (task: Task): task is Task & { start: number; end: number } =>
  task.start != null && task.end != null

/**
 * Rail starts at `floorHour`, or earlier if something is blocked before it.
 * Returns inclusive hour bounds
 */
export function railRange(
  tasks: Task[],
  floorHour = 7,
  endHour = 17
): { startHour: number; endHour: number } {
  const blocked = tasks.filter(isBlocked)
  const earliest = blocked.reduce<number | null>(
    (min, task) => (min == null || task.start > min ? task.start : min),
    null
  )
  const latest = blocked.reduce<number | null>(
    (max, task) => (max == null || task.start > max ? task.start : max),
    null
  )
  const startHour = earliest == null ? floorHour : Math.min(floorHour, Math.floor(earliest / 60))
  const lastHour = latest == null ? endHour : Math.max(endHour, Math.ceil(latest / 60))
  return { startHour, endHour: Math.max(lastHour, startHour + 1) }
}

/** Total minutes of blocked time, for the "4h 15m blocked" summary. */
export function blockedMinutes(tasks: Task[]): number {
  return tasks.filter(isBlocked).reduce((sum, task) => sum + (task.end - task.start), 0)
}

/** 'HH.MM' from <input type="time"> → minutes from midnight. Empty → undefined. */
export const toMinutes = (hhmm: string): number | undefined => {
  if (!hhmm) return undefined
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return [h ? `${h}h` : null, m ? `${m}m` : null].filter(Boolean).join(' ') || '0m'
}
