export interface LoginInput { username: string; password: string; remember: boolean }

export function parseLoginInput(value: unknown): LoginInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid login request')
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.length !== 3 || !keys.includes('username') || !keys.includes('password') || !keys.includes('remember')) throw new TypeError('Invalid login request')
  if (typeof input.username !== 'string' || typeof input.password !== 'string' || typeof input.remember !== 'boolean') throw new TypeError('Invalid login request')
  return { username: input.username, password: input.password, remember: input.remember }
}

export function parseLanguage(value: unknown): 'el' | 'en' {
  if (value !== 'el' && value !== 'en') throw new TypeError('Invalid language')
  return value
}
