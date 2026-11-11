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
    notes?: string/** Minutes from midnight. Undefined = no time set. May pass 1440 for past-midnight blocks. */
    start?: number
    end?: number
    done: boolean
}

export interface NewTaskInput {
    title: string
    day?: string
    notes?: string
    start?: number
    end?: number
}