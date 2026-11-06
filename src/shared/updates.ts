export interface UpdateState {
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error'
  current: string
  latest?: string
  percent?: number
  error?: 'check' | 'download' | 'install'
}
