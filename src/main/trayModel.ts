import type { HealthSnapshot } from '../shared/connectionHealth'

/** Chromium captures the icon transport synchronously in the native Tray
 * constructor. GNOME's temporary-file path fails on the affected strict Snap;
 * select its D-Bus pixmap backend only during that constructor call. */
export function withTrayPixmap<T>(create: () => T, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): T {
  const desktop = env.XDG_CURRENT_DESKTOP
  if (platform !== 'linux' || env.SNAP_NAME !== 'k1vpn' || !desktop?.split(':').includes('GNOME')) return create()
  try {
    env.XDG_CURRENT_DESKTOP = 'Unity'
    return create()
  } finally {
    env.XDG_CURRENT_DESKTOP = desktop
  }
}

// core24 has no gdbus; the Snap stages its own below the revision mount.
export function gdbusPath(env: NodeJS.ProcessEnv = process.env): string {
  const snap = env.SNAP
  return env.SNAP_NAME === 'k1vpn' && snap && /^\/snap\/k1vpn\/(?:x?\d+|current)$/.test(snap) ? `${snap}/usr/bin/gdbus` : '/usr/bin/gdbus'
}

export function trayState(snapshot: HealthSnapshot): 'green' | 'red' | 'amber' {
  if (snapshot.operation !== null) return 'amber'
  if (snapshot.display === 'protected') return 'green'
  if (snapshot.display === 'disconnected') return 'red'
  return 'amber'
}

export function trayActions(snapshot: HealthSnapshot): { connect: boolean; disconnect: boolean } {
  return {
    connect: snapshot.operation === null && snapshot.display === 'disconnected',
    disconnect: snapshot.operation === null && snapshot.tunnelUp
  }
}

export const desktopText = {
  en: {
    checking: 'Checking VPN status…', unknown: 'VPN status unavailable',
    blocked: 'Recovery required', disconnected: 'VPN disconnected',
    connecting: 'Connecting…', disconnecting: 'Disconnecting…',
    verifying: 'Verifying VPN connection…', protected: 'VPN connected',
    'no-internet': 'No internet', quitting: 'Closing K1VPN…',
    open: 'Open K1VPN', connect: 'Connect', disconnect: 'Disconnect',
    quit: 'Disconnect and quit…', cancel: 'Cancel',
    quitTitle: 'Quit K1VPN?',
    quitMessage: 'The app will quit and disconnect the VPN. Your connection will no longer be protected by K1VPN.',
    hiddenTitle: 'K1VPN is still running',
    hiddenMessage: 'Closing the window does not disconnect the VPN. Reopen K1VPN from its status icon or the application launcher.',
    hiddenAgain: "Don't show again", error: 'The action could not be completed',
    errorMessage: 'K1VPN remains open. Check your connection and try again.',
    chooseServer: 'Sign in and choose a server in the app for your first connection.'
  },
  el: {
    checking: 'Έλεγχος κατάστασης VPN…', unknown: 'Η κατάσταση VPN δεν είναι διαθέσιμη',
    blocked: 'Απαιτείται ανάκτηση', disconnected: 'VPN αποσυνδεδεμένο',
    connecting: 'Σύνδεση…', disconnecting: 'Αποσύνδεση…',
    verifying: 'Επαλήθευση σύνδεσης VPN…', protected: 'VPN συνδεδεμένο',
    'no-internet': 'Χωρίς internet', quitting: 'Τερματισμός K1VPN…',
    open: 'Άνοιγμα K1VPN', connect: 'Σύνδεση', disconnect: 'Αποσύνδεση',
    quit: 'Αποσύνδεση και τερματισμός…', cancel: 'Ακύρωση',
    quitTitle: 'Τερματισμός K1VPN;',
    quitMessage: 'Η εφαρμογή θα κλείσει και το VPN θα αποσυνδεθεί. Η σύνδεσή σου δεν θα προστατεύεται πλέον από το K1VPN.',
    hiddenTitle: 'Το K1VPN παραμένει ενεργό',
    hiddenMessage: 'Το κλείσιμο του παραθύρου δεν αποσυνδέει το VPN. Άνοιξε ξανά το K1VPN από το εικονίδιο κατάστασης ή από το μενού εφαρμογών.',
    hiddenAgain: 'Να μην εμφανιστεί ξανά', error: 'Η ενέργεια δεν ολοκληρώθηκε',
    errorMessage: 'Το K1VPN παραμένει ανοιχτό. Έλεγξε τη σύνδεση και δοκίμασε ξανά.',
    chooseServer: 'Συνδέσου στον λογαριασμό σου και επίλεξε server στην εφαρμογή για την πρώτη σύνδεση.'
  }
} as const
