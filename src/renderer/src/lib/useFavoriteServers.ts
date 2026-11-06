import { useCallback, useState } from 'react'

const STORAGE_KEY = 'k1vpn-favorite-servers'

// Renderer-only UI preference (which servers are starred), not anything
// sensitive — same localStorage/try-catch reasoning as i18n/LanguageContext.tsx's
// language preference. Falls back to "no favorites" for this session on
// any read/write failure, never crashes the app over it.
function loadFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

function storeFavorites(favorites: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]))
  } catch {
    // Non-fatal — the choice just won't survive a restart this time.
  }
}

export function useFavoriteServers(): {
  favorites: Set<string>
  isFavorite: (serverId: string) => boolean
  toggleFavorite: (serverId: string) => void
} {
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())

  const toggleFavorite = useCallback((serverId: string): void => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(serverId)) {
        next.delete(serverId)
      } else {
        next.add(serverId)
      }
      storeFavorites(next)
      return next
    })
  }, [])

  const isFavorite = useCallback(
    (serverId: string): boolean => favorites.has(serverId),
    [favorites]
  )

  return { favorites, isFavorite, toggleFavorite }
}
