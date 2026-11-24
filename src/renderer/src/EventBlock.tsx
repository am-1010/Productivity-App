import type { CSSProperties, FC } from 'react'
import type { CalendarEvent } from '../../shared/types'
import { eventOutline, t } from './theme'
import { fmtRange } from './time'

/** What shows when the pointer rests on an event: title, time and place. */
const eventTip = (event: CalendarEvent): string =>
  [
    event.title,
    event.start != null && event.end != null ? fmtRange(event.start, event.end) : 'All day',
    event.location
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * A calendar event on a timeline. Read-only for now: it can't be dragged, and
 * tasks dropped on the timeline land beside it.
 */
export const EventBlock: FC<{
  event: CalendarEvent
  /** Minutes from midnight of the piece drawn here (a late event is split at midnight). */
  start: number
  end: number
  /** Position and size, worked out by the timeline it sits on. */
  box: CSSProperties
}> = ({ event, start, end, box }) => {
  const short = end - start < 45
  return (
    <div
      title={eventTip(event)}
      style={{
        position: 'absolute',
        ...box,
        boxSizing: 'border-box',
        padding: short ? '2px 7px' : '5px 7px',
        borderRadius: 7,
        overflow: 'hidden',
        border: eventOutline,
        background: t.shell,
        userSelect: 'none'
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          lineHeight: 1.2,
          color: t.text3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {event.title}
      </div>
      {!short && (
        <div
          style={{
            marginTop: 2,
            font: `400 9.5px ${t.mono}`,
            color: t.text5,
            whiteSpace: 'nowrap',
            overflow: 'hidden'
          }}
        >
          {fmtRange(start, end)}
        </div>
      )}
    </div>
  )
}

/** An all-day event, shown as a chip above the timeline. */
export const AllDayChip: FC<{ event: CalendarEvent }> = ({ event }) => (
  <div
    title={eventTip(event)}
    style={{
      padding: '3px 7px',
      borderRadius: 6,
      border: eventOutline,
      fontSize: 12,
      color: t.text3,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      userSelect: 'none'
    }}
  >
    {event.title}
  </div>
)
