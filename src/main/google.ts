import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import type { SyncedEvent } from './eventStore'

// Talks to Google: signing in, and reading calendars and events. Kept free of
// Electron so it can be tested; connections.ts wires it into the app.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://www.googleapis.com/calendar/v3'

/** See the list of calendars, and view and edit their events (editing comes in a later stage). */
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events'
]

/** How long the browser sign-in may take before the app stops waiting. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

export interface GoogleClient {
  clientId: string
  clientSecret: string
}

/** Google refused the saved sign-in (it expired or access was taken away). Signing in again fixes it. */
export class SignedOutError extends Error {
  constructor() {
    super('Google signed the app out. Reconnect to keep syncing.')
  }
}

/** The person closed the sign-in, or started another one. */
export class SignInCancelledError extends Error {
  constructor() {
    super('Sign-in cancelled.')
  }
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

/**
 * A PKCE pair. The challenge goes to Google with the sign-in, the verifier only
 * with the code exchange, so a code caught on the way back is useless to anyone else.
 */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** The Google page the browser opens to sign in. */
export function authUrl(
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // A refresh token, so the app keeps access after this sign-in.
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${AUTH_URL}?${params}`
}

const page = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Productivity App</title>
<body style="font:16px -apple-system,sans-serif;background:#0b0b0b;color:#ddd;display:grid;place-items:center;height:90vh">
<p>${message}</p></body>`

/** A sign-in in progress. `cancel` stops it; `done` settles once it ends either way. */
export interface PendingSignIn {
  done: Promise<{ refreshToken: string }>
  cancel: () => void
}

/**
 * Signs in through the browser. A tiny web server on this Mac (127.0.0.1 only)
 * waits for Google to send the browser back with a code, which is then swapped
 * for a refresh token.
 */
export function signIn(client: GoogleClient, openBrowser: (url: string) => void): PendingSignIn {
  const { verifier, challenge } = pkcePair()
  const state = base64url(randomBytes(16))
  const server = createServer()
  let cancel = (): void => {}

  const code = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('Sign-in timed out. Try again.')),
      SIGN_IN_TIMEOUT_MS
    )
    let redirectUri = ''
    const finish = (error?: Error, value?: string): void => {
      clearTimeout(timer)
      server.close()
      if (error) reject(error)
      else resolve({ code: value!, redirectUri })
    }
    cancel = () => finish(new SignInCancelledError())

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const send = (message: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(message))
      }
      if (url.searchParams.get('state') !== state) {
        send('This sign-in link is out of date. Go back to the app and try again.')
        return
      }
      const error = url.searchParams.get('error')
      const value = url.searchParams.get('code')
      if (error || !value) {
        send('Sign-in was cancelled. You can close this tab.')
        finish(
          error === 'access_denied'
            ? new SignInCancelledError()
            : new Error(`Google said: ${error}`)
        )
        return
      }
      send('Signed in. You can close this tab and go back to Productivity App.')
      finish(undefined, value)
    })
    server.on('error', (err) => finish(err))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        return finish(new Error('Could not start sign-in.'))
      redirectUri = `http://127.0.0.1:${address.port}`
      openBrowser(authUrl(client.clientId, redirectUri, challenge, state))
    })
  })

  const done = code.then(async ({ code, redirectUri }) => {
    const token = await postToken({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
    // Google lets people untick permissions on its page; both are needed.
    const granted = String(token.scope ?? '').split(' ')
    if (!SCOPES.every((scope) => granted.includes(scope))) {
      throw new Error(
        'Google didn’t give access to your calendars. Connect again and tick both boxes.'
      )
    }
    if (!token.refresh_token) throw new Error('Google didn’t send a refresh token. Try again.')
    return { refreshToken: String(token.refresh_token) }
  })
  return { done, cancel: () => cancel() }
}

async function postToken(form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (body.error === 'invalid_grant') throw new SignedOutError()
  if (!res.ok) throw new Error(`Google sign-in failed (${body.error ?? res.status}).`)
  return body
}

/** A short-lived access token from the saved refresh token. */
export async function accessToken(client: GoogleClient, refreshToken: string): Promise<string> {
  const token = await postToken({
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token'
  })
  return String(token.access_token)
}

/** Tells Google to forget the app's access. Best effort: the app forgets the token either way. */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken })
  }).catch(() => undefined)
}

async function get<T>(token: string, path: string, query: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(query)}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 401) throw new SignedOutError()
  if (!res.ok) throw new Error(`Google Calendar answered ${res.status}.`)
  return (await res.json()) as T
}

/** Every page of a Google list, one after another. */
async function getAll<T>(token: string, path: string, query: Record<string, string>): Promise<T[]> {
  const items: T[] = []
  let pageToken: string | undefined
  do {
    const page = await get<{ items?: T[]; nextPageToken?: string }>(token, path, {
      ...query,
      ...(pageToken ? { pageToken } : {})
    })
    items.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return items
}

export interface GoogleCalendar {
  id: string
  summary?: string
  primary?: boolean
  /** Ticked in Google Calendar's own list. */
  selected?: boolean
  hidden?: boolean
}

/** The calendars ticked in Google Calendar, so the app shows what Google shows. */
export async function listCalendars(token: string): Promise<GoogleCalendar[]> {
  const calendars = await getAll<GoogleCalendar>(token, '/users/me/calendarList', {})
  return calendars.filter((c) => c.primary || (c.selected && !c.hidden))
}

export interface GoogleEvent {
  id: string
  etag?: string
  status?: string
  summary?: string
  location?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
}

/** A Google event as the event store takes it. Undefined for ones not to show. */
export function toSyncedEvent(calendarId: string, e: GoogleEvent): SyncedEvent | undefined {
  if (e.status === 'cancelled') return undefined
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return undefined
  const base = {
    calendarId,
    externalId: e.id,
    etag: e.etag,
    title: e.summary?.trim() || '(No title)',
    location: e.location || undefined,
    notes: e.description || undefined
  }
  if (e.start?.dateTime && e.end?.dateTime) {
    return {
      ...base,
      startMs: Date.parse(e.start.dateTime),
      endMs: Date.parse(e.end.dateTime)
    }
  }
  if (e.start?.date && e.end?.date) return { ...base, startDay: e.start.date, endDay: e.end.date }
  return undefined
}

/** The events of one calendar between `from` and `to`, with repeating events expanded. */
export async function listEvents(
  token: string,
  calendarId: string,
  from: Date,
  to: Date
): Promise<SyncedEvent[]> {
  const items = await getAll<GoogleEvent>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      singleEvents: 'true',
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      maxResults: '2500'
    }
  )
  return items.flatMap((e) => toSyncedEvent(calendarId, e) ?? [])
}
