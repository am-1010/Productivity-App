import { createHash } from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SCOPES,
  SignInCancelledError,
  SignedOutError,
  accessToken,
  authUrl,
  listEvents,
  pkcePair,
  signIn,
  toSyncedEvent
} from './google'

const client = { clientId: 'client-id', clientSecret: 'client-secret' }
const realFetch = globalThis.fetch

/**
 * Answers requests to Google with `reply` and lets everything else (the app's
 * own sign-in page on 127.0.0.1) through. Records what was sent to Google.
 */
function fakeGoogle(
  reply: (url: string, body?: URLSearchParams) => unknown,
  status = 200
): { url: string; body?: URLSearchParams }[] {
  const calls: { url: string; body?: URLSearchParams }[] = []
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
    const body = init?.body instanceof URLSearchParams ? init.body : undefined
    calls.push({ url, body })
    return Promise.resolve(new Response(JSON.stringify(reply(url, body)), { status }))
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pkcePair', () => {
  it('makes a challenge that is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('authUrl', () => {
  it('asks for both permissions, offline access, and the PKCE challenge', () => {
    const url = new URL(authUrl('id', 'http://127.0.0.1:5000', 'chal', 'st'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'id',
      redirect_uri: 'http://127.0.0.1:5000',
      scope: SCOPES.join(' '),
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline'
    })
  })
})

describe('signIn', () => {
  /** Plays the browser: opens Google's page, and Google sends it back with `params`. */
  const browser =
    (params: (sent: URL) => Record<string, string>) =>
    (url: string): void => {
      const sent = new URL(url)
      const back = new URL(sent.searchParams.get('redirect_uri')!)
      for (const [key, value] of Object.entries(params(sent))) back.searchParams.set(key, value)
      void fetch(back)
    }

  it('swaps the code for a refresh token, sending the PKCE verifier', async () => {
    const calls = fakeGoogle(() => ({ refresh_token: 'refresh', scope: SCOPES.join(' ') }))
    let challenge = ''
    const pending = signIn(
      client,
      browser((sent) => {
        challenge = sent.searchParams.get('code_challenge')!
        return { code: 'the-code', state: sent.searchParams.get('state')! }
      })
    )

    await expect(pending.done).resolves.toEqual({ refreshToken: 'refresh' })
    const body = calls[0].body!
    expect(body.get('code')).toBe('the-code')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(
      challenge
    )
  })

  it('ignores a reply with the wrong state', async () => {
    fakeGoogle(() => ({ refresh_token: 'refresh', scope: SCOPES.join(' ') }))
    const pending = signIn(
      client,
      browser(() => ({ code: 'stolen', state: 'wrong' }))
    )
    // Still waiting, so cancelling is what ends it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    pending.cancel()
    await expect(pending.done).rejects.toBeInstanceOf(SignInCancelledError)
  })

  it('treats "Cancel" on Google’s page as cancelled', async () => {
    fakeGoogle(() => ({}))
    const pending = signIn(
      client,
      browser((sent) => ({ error: 'access_denied', state: sent.searchParams.get('state')! }))
    )
    await expect(pending.done).rejects.toBeInstanceOf(SignInCancelledError)
  })

  it('says so when a permission box was unticked', async () => {
    fakeGoogle(() => ({ refresh_token: 'refresh', scope: SCOPES[0] }))
    const pending = signIn(
      client,
      browser((sent) => ({ code: 'c', state: sent.searchParams.get('state')! }))
    )
    await expect(pending.done).rejects.toThrow('tick both boxes')
  })
})

describe('accessToken', () => {
  it('reports an expired sign-in as signed out', async () => {
    fakeGoogle(() => ({ error: 'invalid_grant' }), 400)
    await expect(accessToken(client, 'old')).rejects.toBeInstanceOf(SignedOutError)
  })
})

describe('toSyncedEvent', () => {
  it('turns a timed event into milliseconds', () => {
    expect(
      toSyncedEvent('cal', {
        id: 'e1',
        etag: '"1"',
        summary: 'Standup',
        start: { dateTime: '2026-11-24T09:00:00-05:00' },
        end: { dateTime: '2026-11-24T09:15:00-05:00' }
      })
    ).toEqual({
      calendarId: 'cal',
      externalId: 'e1',
      etag: '"1"',
      title: 'Standup',
      location: undefined,
      notes: undefined,
      startMs: Date.parse('2026-11-24T14:00:00Z'),
      endMs: Date.parse('2026-11-24T14:15:00Z')
    })
  })

  it('keeps all-day events as dates, and names untitled ones', () => {
    expect(
      toSyncedEvent('cal', { id: 'e2', start: { date: '2026-11-26' }, end: { date: '2026-11-27' } })
    ).toMatchObject({ title: '(No title)', startDay: '2026-11-26', endDay: '2026-11-27' })
  })

  it('skips cancelled events and ones you declined', () => {
    const when = { start: { date: '2026-11-26' }, end: { date: '2026-11-27' } }
    expect(toSyncedEvent('cal', { id: 'a', status: 'cancelled', ...when })).toBeUndefined()
    expect(
      toSyncedEvent('cal', {
        id: 'b',
        attendees: [{ self: true, responseStatus: 'declined' }],
        ...when
      })
    ).toBeUndefined()
  })
})

describe('listEvents', () => {
  it('follows every page and expands repeating events', async () => {
    const event = (id: string): object => ({
      id,
      start: { date: '2026-11-26' },
      end: { date: '2026-11-27' }
    })
    const calls = fakeGoogle((url) =>
      new URL(url).searchParams.get('pageToken')
        ? { items: [event('b')] }
        : { items: [event('a')], nextPageToken: 'p2' }
    )

    const events = await listEvents('token', 'me@x', new Date(0), new Date(1))

    expect(events.map((e) => e.externalId)).toEqual(['a', 'b'])
    expect(calls).toHaveLength(2)
    const first = new URL(calls[0].url)
    expect(first.pathname).toBe('/calendar/v3/calendars/me%40x/events')
    expect(first.searchParams.get('singleEvents')).toBe('true')
  })
})
