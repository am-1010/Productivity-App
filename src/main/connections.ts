import { BrowserWindow, app, safeStorage, shell } from 'electron'
import { eventStore } from './db'
import * as google from './google'

// Connecting, syncing and removing calendars. The Google sign-in is kept
// encrypted by macOS (safeStorage) and never leaves the main process.

/** How far back and ahead events are copied from Google. */
const PAST_DAYS = 60
const FUTURE_DAYS = 365

function client(): google.GoogleClient {
  const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
  const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Google isn’t set up: the client ID or secret is missing from .env.')
  }
  return { clientId, clientSecret }
}

const encrypt = (token: string): Buffer => safeStorage.encryptString(token)

/** The saved refresh token. A missing or unreadable one counts as signed out. */
function refreshTokenOf(id: string): string {
  const secret = eventStore.getSecret(id)
  if (!secret) throw new google.SignedOutError()
  try {
    return safeStorage.decryptString(secret)
  } catch {
    throw new google.SignedOutError()
  }
}

let pending: google.PendingSignIn | undefined

/** Signs in through the browser and returns the refresh token. Only one sign-in runs at a time. */
async function signInWithBrowser(): Promise<string> {
  pending?.cancel()
  const current = google.signIn(client(), (url) => void shell.openExternal(url))
  pending = current
  try {
    return (await current.done).refreshToken
  } finally {
    if (pending === current) pending = undefined
    // Back to the app from the browser.
    app.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.show()
  }
}

/** Stops a sign-in that is waiting for the browser. */
export function cancelGoogleSignIn(): void {
  pending?.cancel()
}

/** The account a refresh token belongs to: its main calendar's id, which is its email address. */
async function accountOf(refreshToken: string): Promise<string> {
  const token = await google.accessToken(client(), refreshToken)
  const calendars = await google.listCalendars(token)
  return calendars.find((c) => c.primary)?.id ?? 'Google Calendar'
}

/** Copies one Google connection's events into the app. Failures are saved for the Connections page. */
async function syncGoogle(id: string): Promise<void> {
  try {
    const token = await google.accessToken(client(), refreshTokenOf(id))
    const calendars = await google.listCalendars(token)
    const from = new Date()
    from.setDate(from.getDate() - PAST_DAYS)
    const to = new Date()
    to.setDate(to.getDate() + FUTURE_DAYS)
    // Everything is fetched before anything is saved, so a failure halfway changes nothing.
    const events = await Promise.all(calendars.map((c) => google.listEvents(token, c.id, from, to)))
    calendars.forEach((c, i) => eventStore.syncEvents(id, c.id, events[i]))
    eventStore.keepCalendars(
      id,
      calendars.map((c) => c.id)
    )
  } catch (err) {
    eventStore.setSyncError(id, err instanceof Error ? err.message : String(err))
  }
}

/** Signs in to a Google account and syncs it. Signing in to one already connected refreshes it. */
export async function connectGoogle(): Promise<void> {
  const refreshToken = await signInWithBrowser()
  const name = await accountOf(refreshToken)
  const existing = eventStore
    .listConnections()
    .find((c) => c.provider === 'google' && c.name === name)
  const id =
    existing?.id ??
    eventStore.addConnection({ provider: 'google', name, secret: encrypt(refreshToken) })
  if (existing) eventStore.setSecret(id, encrypt(refreshToken))
  await syncGoogle(id)
}

/** Signs in again after Google signed the app out, keeping the connection and its events. */
export async function reconnectGoogle(id: string): Promise<void> {
  const connection = eventStore.listConnections().find((c) => c.id === id)
  if (!connection) return
  const refreshToken = await signInWithBrowser()
  const name = await accountOf(refreshToken)
  if (name !== connection.name) {
    throw new Error(
      `That was ${name}. Sign in as ${connection.name}, or connect it as a new calendar.`
    )
  }
  eventStore.setSecret(id, encrypt(refreshToken))
  await syncGoogle(id)
}

let running: Promise<void> | undefined

/** Syncs every Google connection. Calls made while one is running share it. */
export function syncAll(): Promise<void> {
  running ??= Promise.all(
    eventStore
      .listConnections()
      .filter((c) => c.provider === 'google')
      .map((c) => syncGoogle(c.id))
  )
    .then(() => undefined)
    .finally(() => {
      running = undefined
    })
  return running
}

/** Removes a connection and its events. For Google, also tells Google to forget the app's access. */
export async function removeConnection(id: string): Promise<void> {
  const connection = eventStore.listConnections().find((c) => c.id === id)
  if (connection?.provider === 'google') {
    try {
      await google.revoke(refreshTokenOf(id))
    } catch {
      // Already signed out; nothing to revoke.
    }
  }
  eventStore.removeConnection(id)
}
