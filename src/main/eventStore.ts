import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { CalendarEvent, Connection, Provider } from '../shared/types'

/**
 * One event as a provider (Google, Apple, Canvas) hands it over. A timed event
 * has startMs/endMs; an all-day event has startDay/endDay instead.
 */
export interface SyncedEvent {
  /** The provider's id for the calendar it is on. */
  calendarId: string
  /** The provider's id for the event, so the next sync updates it instead of adding it again. */
  externalId: string
  /** The provider's version tag, needed later to edit the event safely. */
  etag?: string
  title: string
  location?: string
  notes?: string
  /** Timed events: start and end in milliseconds since 1970 (Date.getTime()). */
  startMs?: number
  endMs?: number
  /** All-day events: the first day, and the day after the last one ('YYYY-MM-DD'). */
  startDay?: string
  endDay?: string
}

export interface EventStore {
  listConnections(): Connection[]
  addConnection(input: { provider: Provider; name: string; secret?: Buffer }): string
  removeConnection(id: string): void
  /** The connection's encrypted password or token. Main process only. */
  getSecret(id: string): Buffer | undefined
  /** Replaces the connection's password or token, such as after signing in again. */
  setSecret(id: string, secret: Buffer): void
  /** Makes `calendarId` of this connection hold exactly `events`, and records the sync. */
  syncEvents(connectionId: string, calendarId: string, events: SyncedEvent[]): void
  /** Drops the events of any calendar of this connection not in `calendarIds`. */
  keepCalendars(connectionId: string, calendarIds: string[]): void
  /** Records why a sync failed, so the Connections page can say so. */
  setSyncError(connectionId: string, message: string): void
  /** Events that touch any day from `from` to `to`, both included ('YYYY-MM-DD'). */
  getEventsForRange(from: string, to: string): CalendarEvent[]
}

interface ConnectionRow {
  id: string
  provider: string
  name: string
  last_synced_at: number | null
  last_error: string | null
  event_count: number
}

interface EventRow {
  id: string
  connection_id: string
  title: string
  location: string | null
  notes: string | null
  start_ms: number | null
  end_ms: number | null
  start_day: string | null
  end_day: string | null
}

const DAY_MIN = 24 * 60

/** Local calendar day as 'YYYY-MM-DD'. */
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 'YYYY-MM-DD' → local midnight of that day, `plus` days later. */
const midnight = (day: string, plus = 0): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d + plus)
}

/**
 * The event as the timelines see it: one entry for a timed event, one per day
 * for an all-day event, cut to the days from `from` to `to`.
 */
function toEvents(r: EventRow, from: string, to: string): CalendarEvent[] {
  const base = {
    id: r.id,
    connectionId: r.connection_id,
    title: r.title,
    location: r.location ?? undefined,
    notes: r.notes ?? undefined
  }
  if (r.start_ms != null && r.end_ms != null) {
    const start = new Date(r.start_ms)
    const startMin = start.getHours() * 60 + start.getMinutes()
    // Longer than two days can't be drawn on a day column; it is cut at the end of the next day.
    const length = Math.round((r.end_ms - r.start_ms) / 60_000)
    const end = Math.min(startMin + Math.max(length, 0), 2 * DAY_MIN)
    return [{ ...base, day: dayKey(start), start: startMin, end }]
  }
  const days: CalendarEvent[] = []
  if (!r.start_day || !r.end_day) return days
  for (let d = midnight(r.start_day); dayKey(d) < r.end_day; d = midnight(dayKey(d), 1)) {
    const day = dayKey(d)
    if (day > to) break
    if (day >= from) days.push({ ...base, day })
  }
  return days
}

/**
 * Queries for connected calendars. Expects the tables made by migration v3 in
 * taskStore.ts, so open the task store on `db` first.
 */
export function openEventStore(db: Database.Database): EventStore {
  return {
    listConnections(): Connection[] {
      const rows = db
        .prepare(
          `SELECT c.id, c.provider, c.name, c.last_synced_at, c.last_error,
                  (SELECT COUNT(*) FROM event e WHERE e.connection_id = c.id) AS event_count
             FROM connection c
             ORDER BY c.created_at`
        )
        .all() as ConnectionRow[]
      return rows.map((r) => ({
        id: r.id,
        provider: r.provider as Provider,
        name: r.name,
        lastSyncedAt: r.last_synced_at ?? undefined,
        lastError: r.last_error ?? undefined,
        eventCount: r.event_count
      }))
    },

    addConnection({ provider, name, secret }): string {
      const id = randomUUID()
      db.prepare(
        `INSERT INTO connection (id, provider, name, secret, created_at)
           VALUES (?, ?, ?, ?, ?)`
      ).run(id, provider, name, secret ?? null, Date.now())
      return id
    },

    removeConnection(id: string): void {
      db.transaction(() => {
        db.prepare('DELETE FROM event WHERE connection_id = ?').run(id)
        db.prepare('DELETE FROM connection WHERE id = ?').run(id)
      })()
    },

    getSecret(id: string): Buffer | undefined {
      const row = db.prepare('SELECT secret FROM connection WHERE id = ?').get(id) as
        { secret: Buffer | null } | undefined
      return row?.secret ?? undefined
    },

    setSecret(id: string, secret: Buffer): void {
      db.prepare('UPDATE connection SET secret = ? WHERE id = ?').run(secret, id)
    },

    syncEvents(connectionId: string, calendarId: string, events: SyncedEvent[]): void {
      // Keeps the app's own id for an event it already has, so later edits can find it.
      const upsert = db.prepare(
        `INSERT INTO event (id, connection_id, calendar_id, external_id, etag, title, location,
                            notes, start_ms, end_ms, start_day, end_day)
           VALUES (@id, @connectionId, @calendarId, @externalId, @etag, @title, @location,
                   @notes, @startMs, @endMs, @startDay, @endDay)
           ON CONFLICT (connection_id, calendar_id, external_id) DO UPDATE SET
             etag = excluded.etag, title = excluded.title, location = excluded.location,
             notes = excluded.notes, start_ms = excluded.start_ms, end_ms = excluded.end_ms,
             start_day = excluded.start_day, end_day = excluded.end_day`
      )
      db.transaction(() => {
        for (const e of events) {
          upsert.run({
            id: randomUUID(),
            connectionId,
            calendarId,
            externalId: e.externalId,
            etag: e.etag ?? null,
            title: e.title,
            location: e.location ?? null,
            notes: e.notes ?? null,
            startMs: e.startMs ?? null,
            endMs: e.endMs ?? null,
            startDay: e.startDay ?? null,
            endDay: e.endDay ?? null
          })
        }
        // Anything the provider no longer sends was deleted there.
        const keep = new Set(events.map((e) => e.externalId))
        const stored = db
          .prepare('SELECT id, external_id FROM event WHERE connection_id = ? AND calendar_id = ?')
          .all(connectionId, calendarId) as { id: string; external_id: string }[]
        const remove = db.prepare('DELETE FROM event WHERE id = ?')
        for (const row of stored) if (!keep.has(row.external_id)) remove.run(row.id)

        db.prepare('UPDATE connection SET last_synced_at = ?, last_error = NULL WHERE id = ?').run(
          Date.now(),
          connectionId
        )
      })()
    },

    keepCalendars(connectionId: string, calendarIds: string[]): void {
      const keep = new Set(calendarIds)
      const stored = db
        .prepare('SELECT DISTINCT calendar_id FROM event WHERE connection_id = ?')
        .all(connectionId) as { calendar_id: string }[]
      const remove = db.prepare('DELETE FROM event WHERE connection_id = ? AND calendar_id = ?')
      for (const row of stored)
        if (!keep.has(row.calendar_id)) remove.run(connectionId, row.calendar_id)
    },

    setSyncError(connectionId: string, message: string): void {
      db.prepare('UPDATE connection SET last_error = ? WHERE id = ?').run(message, connectionId)
    },

    getEventsForRange(from: string, to: string): CalendarEvent[] {
      const rows = db
        .prepare(
          `SELECT id, connection_id, title, location, notes, start_ms, end_ms, start_day, end_day
             FROM event
             WHERE (start_ms < @rangeEnd AND end_ms > @rangeStart)
                OR (start_day <= @to AND end_day > @from)
             ORDER BY start_day IS NULL, start_day, start_ms`
        )
        .all({
          from,
          to,
          rangeStart: midnight(from).getTime(),
          rangeEnd: midnight(to, 1).getTime()
        }) as EventRow[]
      return rows.flatMap((r) => toEvents(r, from, to))
    }
  }
}
