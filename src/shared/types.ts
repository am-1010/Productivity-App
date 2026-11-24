// Types shared by the main process, the preload bridge and the renderer.
// Change a tasks's shape here and every layer picks it up.

export type TaskSource = 'gmail' | 'slack' | 'linear'

/** A task as the renderer sees it. */
export interface Task {
  id: string
  title: string
  project?: string
  source?: TaskSource
  /** 'YYYY-MM-DD' local day. Undefined = no day yet. */
  day?: string
  notes?: string /** Minutes from midnight. Undefined = no time set. May pass 1440 for past-midnight blocks. */
  start?: number
  end?: number
  done: boolean
  /** When it was ticked off, in milliseconds (Date.now()). Undefined while open */
  doneAt?: number
}

export interface NewTaskInput {
  title: string
  day?: string
  notes?: string
  start?: number
  end?: number
}

/** Where a connected calendar comes from. 'sample' is made-up data for trying the app out. */
export type Provider = 'google' | 'apple' | 'canvas' | 'sample'

/** A connected account, as the Connections page shows it. Its password or token never leaves the main process. */
export interface Connection {
  id: string
  provider: Provider
  /** Shown on the Connections page, such as the account's name. */
  name: string
  /** When it last synced, in milliseconds. Undefined until the first sync. */
  lastSyncedAt?: number
  /** Why the last sync failed. Undefined when it worked. */
  lastError?: string
  eventCount: number
}

/** A calendar event, in local time, shaped like a task so the timelines can draw it. */
export interface CalendarEvent {
  id: string
  connectionId: string
  title: string
  location?: string
  notes?: string
  /** 'YYYY-MM-DD' local day. An all-day event that spans several days comes once per day. */
  day: string
  /** Minutes from that day's midnight. Undefined for all-day events. The end may pass 1440. */
  start?: number
  end?: number
}
