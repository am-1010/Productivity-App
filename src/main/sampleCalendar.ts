import type { EventStore, SyncedEvent } from './eventStore'

/** 'YYYY-MM-DD' for the day `plus` days after `d`. */
const dayAfter = (d: Date, plus: number): string => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Adds a made-up calendar around `today`, for trying out how events look before a
 * real account is connected. Remove it from the Connections page.
 */
export function addSampleCalendar(
  store: Pick<EventStore, 'addConnection' | 'syncEvents'>,
  today = new Date()
): void {
  const monday = (today.getDay() + 6) % 7 // days since Monday
  const at = (plus: number, hour: number, minute = 0): number =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + plus, hour, minute).getTime()
  const timed = (
    id: string,
    title: string,
    plus: number,
    from: number[],
    to: number[]
  ): SyncedEvent => ({
    calendarId: 'sample',
    externalId: id,
    title,
    location: 'Sample calendar',
    startMs: at(plus, from[0], from[1]),
    endMs: at(plus + (to[0] < from[0] ? 1 : 0), to[0], to[1])
  })

  const events: SyncedEvent[] = []
  for (let i = 0; i < 5; i++) {
    const plus = i - monday // that weekday this week, counted from today
    events.push(
      i % 2 === 0
        ? timed(`lecture-${i}`, 'Lecture', plus, [10, 0], [11, 20])
        : timed(`lab-${i}`, 'Lab', plus, [13, 0], [15, 0])
    )
  }
  events.push(
    timed('study', 'Study group', 0, [16, 0], [17, 0]),
    timed('coffee', 'Coffee with Sam', 0, [16, 30], [17, 15]),
    timed('late', 'Late film', 1, [22, 30], [0, 30]),
    {
      calendarId: 'sample',
      externalId: 'due',
      title: 'Essay due',
      startDay: dayAfter(today, 0),
      endDay: dayAfter(today, 1)
    },
    {
      calendarId: 'sample',
      externalId: 'trip',
      title: 'Weekend away',
      startDay: dayAfter(today, 5 - monday),
      endDay: dayAfter(today, 7 - monday)
    }
  )

  const id = store.addConnection({ provider: 'sample', name: 'Sample calendar' })
  store.syncEvents(id, 'sample', events)
}
