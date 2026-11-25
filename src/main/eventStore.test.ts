import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { openEventStore, type EventStore, type SyncedEvent } from './eventStore'
import { openTaskStore } from './taskStore'

// A fresh in-memory database for every test. The task store makes the tables.
let store: EventStore
beforeEach(() => {
  const db = new Database(':memory:')
  openTaskStore(db)
  store = openEventStore(db)
})

/** Milliseconds for a local date and time, so the tests pass in any time zone. */
const at = (day: string, hour: number, minute = 0): number => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, hour, minute).getTime()
}

const timed = (externalId: string, title: string, start: number, end: number): SyncedEvent => ({
  calendarId: 'cal',
  externalId,
  title,
  startMs: start,
  endMs: end
})

describe('connections', () => {
  it('lists connections with their event count, but never their secret', () => {
    const id = store.addConnection({ provider: 'google', name: 'Work', secret: Buffer.from('s') })
    store.syncEvents(id, 'cal', [timed('a', 'Standup', at('2026-11-23', 9), at('2026-11-23', 10))])

    const [connection] = store.listConnections()
    expect(connection).toEqual({
      id,
      provider: 'google',
      name: 'Work',
      lastSyncedAt: expect.any(Number),
      lastError: undefined,
      eventCount: 1
    })
    expect(store.getSecret(id)?.toString()).toBe('s')
  })

  it('removing a connection removes its events', () => {
    const id = store.addConnection({ provider: 'sample', name: 'Sample' })
    store.syncEvents(id, 'cal', [timed('a', 'Gone', at('2026-11-23', 9), at('2026-11-23', 10))])

    store.removeConnection(id)
    expect(store.listConnections()).toEqual([])
    expect(store.getEventsForRange('2026-11-23', '2026-11-23')).toEqual([])
  })

  it('records a failed sync until the next one works', () => {
    const id = store.addConnection({ provider: 'apple', name: 'iCloud' })
    store.setSyncError(id, 'Wrong password')
    expect(store.listConnections()[0].lastError).toBe('Wrong password')

    store.syncEvents(id, 'cal', [])
    expect(store.listConnections()[0].lastError).toBeUndefined()
  })
})

describe('setSecret', () => {
  it('replaces the saved secret, such as after signing in again', () => {
    const id = store.addConnection({ provider: 'google', name: 'Work', secret: Buffer.from('old') })
    store.setSecret(id, Buffer.from('new'))
    expect(store.getSecret(id)?.toString()).toBe('new')
  })
})

describe('syncEvents', () => {
  it('updates events it already has, keeps their id, and drops ones no longer sent', () => {
    const id = store.addConnection({ provider: 'google', name: 'Work' })
    store.syncEvents(id, 'cal', [
      timed('a', 'Old title', at('2026-11-23', 9), at('2026-11-23', 10)),
      timed('b', 'Cancelled', at('2026-11-23', 11), at('2026-11-23', 12))
    ])
    const [before] = store.getEventsForRange('2026-11-23', '2026-11-23')

    store.syncEvents(id, 'cal', [
      timed('a', 'New title', at('2026-11-23', 9), at('2026-11-23', 10))
    ])

    const after = store.getEventsForRange('2026-11-23', '2026-11-23')
    expect(after.map((e) => [e.id, e.title])).toEqual([[before.id, 'New title']])
  })

  it('leaves the connection’s other calendars alone', () => {
    const id = store.addConnection({ provider: 'google', name: 'Work' })
    store.syncEvents(id, 'cal', [timed('a', 'Mine', at('2026-11-23', 9), at('2026-11-23', 10))])
    store.syncEvents(id, 'other', [])

    expect(store.getEventsForRange('2026-11-23', '2026-11-23').map((e) => e.title)).toEqual([
      'Mine'
    ])
  })

  it('drops the events of calendars that are no longer synced', () => {
    const id = store.addConnection({ provider: 'google', name: 'Work' })
    store.syncEvents(id, 'cal', [timed('a', 'Kept', at('2026-11-23', 9), at('2026-11-23', 10))])
    store.syncEvents(id, 'old', [
      { ...timed('b', 'Gone', at('2026-11-23', 11), at('2026-11-23', 12)), calendarId: 'old' }
    ])

    store.keepCalendars(id, ['cal'])

    expect(store.getEventsForRange('2026-11-23', '2026-11-23').map((e) => e.title)).toEqual([
      'Kept'
    ])
  })
})

describe('getEventsForRange', () => {
  let id: string
  beforeEach(() => {
    id = store.addConnection({ provider: 'sample', name: 'Sample' })
  })

  it('gives timed events their local day and minutes, with late ones running past 1440', () => {
    store.syncEvents(id, 'cal', [
      timed('a', 'Lecture', at('2026-11-23', 10), at('2026-11-23', 11, 20)),
      timed('b', 'Night shift', at('2026-11-23', 23), at('2026-11-24', 1, 30)),
      timed('c', 'Next week', at('2026-11-30', 9), at('2026-11-30', 10))
    ])

    expect(
      store
        .getEventsForRange('2026-11-23', '2026-11-24')
        .map((e) => [e.title, e.day, e.start, e.end])
    ).toEqual([
      ['Lecture', '2026-11-23', 600, 680],
      ['Night shift', '2026-11-23', 1380, 1530]
    ])
  })

  it('finds an event from the day before that runs into the range', () => {
    store.syncEvents(id, 'cal', [timed('b', 'Night', at('2026-11-22', 23), at('2026-11-23', 1))])
    expect(store.getEventsForRange('2026-11-23', '2026-11-23').map((e) => e.day)).toEqual([
      '2026-11-22'
    ])
  })

  it('repeats an all-day event on each day it covers, within the range', () => {
    store.syncEvents(id, 'cal', [
      // Fri to Mon; the end day is the day after the last one.
      {
        calendarId: 'cal',
        externalId: 'trip',
        title: 'Trip',
        startDay: '2026-11-20',
        endDay: '2026-11-24'
      }
    ])

    expect(
      store.getEventsForRange('2026-11-22', '2026-11-29').map((e) => [e.title, e.day, e.start])
    ).toEqual([
      ['Trip', '2026-11-22', undefined],
      ['Trip', '2026-11-23', undefined]
    ])
  })
})
