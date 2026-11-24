import type { CSSProperties, FC } from 'react'
import type { Connection, Provider } from '../../shared/types'
import { eyebrow, t } from './theme'

/** The services the app can connect to, in the order they're offered. */
const PROVIDERS: { provider: Provider; name: string; blurb: string; status: string }[] = [
  {
    provider: 'google',
    name: 'Google Calendar',
    blurb: 'Your Google calendars on your timelines, kept in sync both ways.',
    status: 'Next'
  },
  {
    provider: 'apple',
    name: 'Apple Calendar',
    blurb: 'Your iCloud calendars, through an app-specific password.',
    status: 'Soon'
  },
  {
    provider: 'canvas',
    name: 'Canvas',
    blurb: 'Assignments and due dates from your school, as tasks.',
    status: 'Soon'
  }
]

const PROVIDER_NAMES: Record<Provider, string> = {
  google: 'Google Calendar',
  apple: 'Apple Calendar',
  canvas: 'Canvas',
  sample: 'Made-up events'
}

/** "Synced just now", "Synced 5 min ago", or the day and time for anything older. */
const syncedLabel = (connection: Connection, now = Date.now()): string => {
  if (connection.lastSyncedAt == null) return 'Not synced yet'
  const minutes = Math.floor((now - connection.lastSyncedAt) / 60_000)
  if (minutes < 1) return 'Synced just now'
  if (minutes < 60) return `Synced ${minutes} min ago`
  const when = new Date(connection.lastSyncedAt)
  return `Synced ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

const card: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '13px 14px',
  borderRadius: 10,
  background: t.surface1
}

const smallButton: CSSProperties = {
  flex: 'none',
  border: 'none',
  borderRadius: 7,
  padding: '6px 12px',
  background: t.control,
  color: t.text2,
  fontFamily: t.serif,
  fontSize: 12.5,
  cursor: 'pointer'
}

/** The Connections page: connected calendars, and the ones that can be added. */
export const ConnectionsView: FC<{
  connections: Connection[]
  onRemove?: (id: string) => void
  /** Only passed while developing. */
  onAddSample?: () => void
}> = ({ connections, onRemove, onAddSample }) => (
  <div style={{ maxWidth: 560 }}>
    <div style={{ fontSize: 14.5, color: t.text4, lineHeight: 1.55, marginBottom: 22 }}>
      Bring your calendars and Canvas into the app. Their events show on your Today and Week
      timelines, next to your tasks.
    </div>

    {connections.length > 0 && (
      <>
        <div style={{ ...eyebrow, marginBottom: 8 }}>Connected</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
          {connections.map((connection) => (
            <div key={connection.id} style={card}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, color: t.text2 }}>{connection.name}</div>
                <div style={{ marginTop: 5, font: `400 11px ${t.mono}`, color: t.text4 }}>
                  {PROVIDER_NAMES[connection.provider]} · {connection.eventCount}{' '}
                  {connection.eventCount === 1 ? 'event' : 'events'} · {syncedLabel(connection)}
                </div>
                {connection.lastError && (
                  <div style={{ marginTop: 5, fontSize: 13, color: '#d98b8b' }}>
                    Last sync failed: {connection.lastError}
                  </div>
                )}
              </div>
              <button
                onClick={() => onRemove?.(connection.id)}
                title="Removes it from this app. Nothing changes in the calendar itself."
                style={smallButton}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </>
    )}

    <div style={{ ...eyebrow, marginBottom: 8 }}>Add a connection</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {PROVIDERS.map(({ provider, name, blurb, status }) => (
        <div key={provider} style={card}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, color: t.text2 }}>{name}</div>
            <div style={{ marginTop: 4, fontSize: 13, color: t.text4 }}>{blurb}</div>
          </div>
          <div style={{ ...eyebrow, flex: 'none', color: t.text6 }}>{status}</div>
        </div>
      ))}
    </div>

    {onAddSample && (
      <div style={{ marginTop: 26 }}>
        <div style={{ ...eyebrow, marginBottom: 8 }}>While developing</div>
        <div style={card}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text4 }}>
            Adds made-up lectures, labs and plans around this week, to see how events look. Remove
            it above when you&apos;re done.
          </div>
          <button onClick={onAddSample} style={smallButton}>
            Add sample calendar
          </button>
        </div>
      </div>
    )}
  </div>
)
