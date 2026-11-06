export type Language = 'en' | 'el'

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'el', label: 'Ελληνικά' },
  { code: 'en', label: 'English' }
]

export const DEFAULT_LANGUAGE: Language = 'en'

// Only static UI copy lives here — error messages that come back from the
// backend (ApiError etc.) are not translated by this dictionary and are
// shown verbatim, same as before; translating those would mean either the
// backend itself returning localized text or a second, much larger
// mapping from backend message strings to keys, neither of which this
// first pass takes on.
const en = {
  recoveryBlocked:
    'A previous VPN session ended unexpectedly. Its network protection may still be blocking internet access.',
  recoveryUnavailable: 'The VPN service is unavailable. Its protection status cannot be confirmed.',
  recoveryReleaseHint:
    'Restoring internet access removes the remaining VPN protection. Traffic will use your normal connection until you connect to the VPN again.',
  recoveryRestartHint:
    'Start the service to check its status. This does not remove any remaining network protection.',
  recoveryRelease: 'Remove protection and restore internet',
  recoveryRestart: 'Start VPN service',
  autoStart: 'Start at login',
  autoStartHint: 'Open K1VPN when you sign in.',
  loginItemApprovalRequired:
    'Allow K1VPN in System Settings > General > Login Items to enable startup at login.',
  loginItemFailed: 'Could not change startup at login. Check Login Items in System Settings.',
  autoConnect: 'Connect automatically on launch',
  autoConnectHint:
    'Connect to your last server when K1VPN opens. Enable Remember Credentials for unattended sign-in. Sign out prevents automatic sign-in.',
  autoConnectFailedLabel: 'Automatic connection failed',
  autoConnectErrorAuth: 'Sign in again, or check that your K1VPN account is active.',
  autoConnectErrorNetwork: 'Could not reach the network. Check your internet connection.',
  autoConnectErrorProtocol: 'The K1VPN server returned an unexpected response.',
  autoConnectErrorVpnPermission: 'The system did not grant K1VPN permission to create the VPN.',
  autoConnectErrorSnapPermission:
    'K1VPN needs permission to manage the network. In a terminal, run: sudo snap connect k1vpn:network-control && sudo snap connect k1vpn:firewall-control && sudo snap connect k1vpn:k1vpn-polkit :polkit',
  autoConnectErrorVpn: 'The VPN tunnel could not be started.',
  autoConnectErrorConfig: 'The VPN configuration for this server is invalid.',
  autoConnectErrorBusy: 'K1VPN was busy with another operation.',
  autoConnectErrorSuperseded: 'Cancelled by a newer connection request.',
  autoConnectErrorGeneric: 'Something went wrong. Please try again.',
  dismiss: 'Dismiss',
  autoConnectSystemHint:
    'Connect to your last server when K1VPN opens with remembered credentials, and reconnect using VPN On Demand after connecting. Disconnect pauses On Demand until you connect again.',
  killSwitchSystemHint:
    'Route traffic through the VPN and block fallback while the system keeps the VPN active. Some system traffic is exempt. Disconnect allows internet access outside the VPN. Applies from the next connection.',
  killSwitch: 'Kill switch',
  allowLocalNetwork: 'Allow local network access',
  allowLocalNetworkHint:
    'With kill switch on, allow access to your router, printers and NAS outside the VPN. Applies from the next connection.',
  killSwitchHint:
    'While connected, block all internet traffic outside the VPN so nothing leaks if the tunnel drops. Disconnect restores normal access. Applies from the next connection.',
  dnsProvider: 'DNS server',
  dnsHint:
    'DNS requests always go through the VPN tunnel, whichever you choose. Applies from the next connection.',
  dnsDefault: 'K1VPN default',
  dnsCloudflare: 'Cloudflare (1.1.1.1)',
  dnsQuad9: 'Quad9 (9.9.9.9)',
  dnsGoogle: 'Safe Browsing (AdGuard)',
  dnsCustom: 'Custom',
  dnsCustomHint: 'Public IPv4 addresses only. The DNS server you choose can see your DNS requests.',
  dnsPrimary: 'Primary DNS',
  dnsSecondary: 'Secondary DNS (optional)',
  dnsInvalid: 'Enter a valid IP address.',
  dnsIpv4Only: 'This VPN tunnel currently supports IPv4 DNS servers only.',
  dnsNotPublic: 'Local or private addresses cannot be used, the VPN server cannot reach them.',
  dnsCustomRequired: 'Enter at least one DNS server.',
  saveDns: 'Save',
  quitApp: 'Quit K1VPN',
  quitting: 'Closing K1VPN…',
  endingSession: 'Disconnecting…',
  quitDescription: 'Disconnect VPN and close K1VPN',
  brand: 'K1VPN',
  loginTagline: 'Secure by Default',
  subscriptionRequired: 'An active K1VPN subscription is required to use this app.',

  // LoginScreen
  loginSubtitle: 'Sign in to your VPN account',
  welcomeBack: 'Welcome back',
  continueAsQuestion: 'Continue as {username}?',
  continueAs: 'Continue as {username}',
  signingIn: 'Signing in...',
  useDifferentAccount: 'Use a different account',
  vpnUsername: 'VPN Username',
  usernameRequired: 'Please enter your VPN username.',
  passwordRequired: 'Please enter your VPN password.',
  vpnPassword: 'VPN Password',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  rememberCredentials: 'Remember Credentials',
  consentAcceptThe: 'I accept the',
  consentAnd: 'and the',
  termsOfUse: 'Terms of Use',
  vpnNoticeTitle: 'Before you start',
  vpnNoticeIntro:
    'K1VPN creates an encrypted VPN connection between your device and K1VPN servers to help protect your internet traffic.',
  vpnNoticeCredentials:
    'Signing in requires only your VPN username and VPN password, not your email address. These credentials are linked to your K1VPN account and are transmitted over an encrypted connection only to K1VPN servers for authentication and service delivery.',
  vpnNoticeIp:
    'The app retrieves your public IP address before and after you connect so you can see the IP address currently used for your internet connection.',
  vpnNoticeIpLookup:
    'This IP lookup is performed exclusively by K1VPN infrastructure. The displayed IP address is not stored, linked to your VPN account, or sent to a third-party IP lookup service.',
  vpnNoticeSessionIp:
    'During a VPN session, your source IP address is processed only as technically necessary to establish and maintain the connection and is not stored in persistent connection logs.',
  vpnNoticeServers:
    'The app communicates only with K1VPN infrastructure and the VPN servers you choose to connect to.',
  vpnNoticeNoAds: 'K1VPN does not use third-party advertising or analytics services.',
  vpnNoticeMore: 'More details are available in our',
  vpnNoticeAccept: 'Accept',
  vpnNoticeDecline: 'Decline',
  vpnNoticeBlockedTitle: 'Declined',
  vpnNoticeBlockedText:
    'Without accepting this notice, K1VPN’s VPN service cannot be used on this device. You can go back and read it again whenever you are ready to accept it.',
  signIn: 'Sign in',

  // ConnectScreen
  menu: 'Menu',
  statusNotConnected: 'Not protected',
  statusConnecting: 'Connecting...',
  statusConnected: 'Protected',
  statusDisconnecting: 'Disconnecting...',
  selectServerFirst: 'Select a server first.',
  connect: 'Connect',
  disconnect: 'Disconnect',
  allServers: 'All',
  favorites: 'Favorites',
  loadingServers: 'Loading servers...',
  retry: 'Retry',
  noFavoriteServers: 'No favorite servers yet.',
  noServersAvailable: 'No servers available.',
  recommended: 'Recommended',
  addFavorite: 'Add to favorites',
  removeFavorite: 'Remove from favorites',
  yourIp: 'Your IP',
  ipChecking: 'Checking IP...',
  ipUnavailable: 'Could not verify the current IP.',
  statusChecking: 'Checking connection...',
  statusUnknown: 'Connection status unavailable',
  statusVerifying: 'Securing connection...',
  statusConnectedUnverified: 'VPN connected',
  statusNoInternet: 'NO INTERNET',
  connectionNoUplink:
    'This device has no network connection. The VPN stays on and is checked again when it returns.',
  connectionNoResponse:
    'Internet access through the VPN is unavailable. Your internet connection or the VPN service may be interrupted. K1VPN keeps checking.',
  connectionNoUplinkDisconnected:
    'This device has no network connection. The VPN is disconnected. K1VPN keeps checking.',
  connectionNoResponseDisconnected:
    'Internet access is unavailable. The VPN is disconnected. K1VPN keeps checking.',
  connectionAddressUnchecked: 'The VPN is on. The current address is still being checked.',
  connectionStale:
    'No recent traffic could be confirmed through the VPN. K1VPN is checking the connection.',
  connectionDetails: 'Connection details',
  serverLocation: 'Server Location',
  selectedLocation: 'Selected Location',
  vpnIp: 'VPN IP',
  connectionReady: 'Connected through your VPN server.',
  connectionPrompt: 'Choose a location to connect.',
  connectionInProgress: 'Your connection details update automatically.',
  connectionUnavailable: 'Trying to reach the VPN service.',
  chooseLocation: 'Choose a location',
  locationUnavailable: 'Location unavailable',
  selected: 'Selected',
  menuHeading: 'Make yourself at home.',
  menuDescription: 'Your account and preferences, in one place.',
  accountDescription: 'Subscription and account details',
  settingsDescription: 'Make K1VPN feel like yours',
  aboutDescription: 'A closer look at your app',
  languageDescription: 'Choose the language you feel at home in.',
  aboutTagline: 'Your connection. Your space.',
  aboutStatement: 'Simple, Straightforward, Secure.\nNo bells and whistles, just Privacy.',
  dnsLeakTest: 'DNS Leak Test',
  webrtcLeakTest: 'WebRTC Leak Test',
  privacyPolicy: 'Privacy policy',
  aboutTech:
    'Built on open-source WireGuard®. ChaCha20-Poly1305 encryption, Curve25519 key exchange, BLAKE2s hashing.',
  copyright: '© {year}, K1VPN. All rights reserved.',
  checkUpdates: 'Check',
  updateIdle: 'Updates',
  updateChecking: 'Checking...',
  updateUpToDate: "You're up to date",
  updateAvailable: 'New version {version} available',
  updateFailed: "Couldn't check for updates",
  startingApp: 'Getting things ready...',
  checkingAccount: 'Checking your account...',
  accountActive: 'Active',
  accountInactive: 'Inactive',

  // MenuScreen
  back: 'Back',
  account: 'Account',
  settings: 'Settings',
  about: 'About',
  licenses: '3rd party licences',

  // AccountScreen
  status: 'Status',
  created: 'Created',
  modified: 'Modified',
  expires: 'Expires',
  never: 'Never',
  signOut: 'Sign out',

  // SettingsScreen
  language: 'Language',

  // AboutScreen
  application: 'Application',
  serverCount: 'Servers',
  version: 'Version'
}

const el: typeof en = {
  recoveryBlocked:
    'Μια προηγούμενη σύνδεση VPN διακόπηκε απρόσμενα. Η προστασία δικτύου της μπορεί να εμποδίζει ακόμα την πρόσβαση στο internet.',
  recoveryUnavailable:
    'Η υπηρεσία VPN δεν είναι διαθέσιμη. Η κατάσταση προστασίας δεν μπορεί να επιβεβαιωθεί.',
  recoveryReleaseHint:
    'Η αποκατάσταση του internet αφαιρεί την προστασία VPN που παραμένει ενεργή. Η κίνηση θα χρησιμοποιεί την κανονική σου σύνδεση μέχρι να συνδεθείς ξανά στο VPN.',
  recoveryRestartHint:
    'Ξεκίνα την υπηρεσία για να ελεγχθεί η κατάστασή της. Αυτό δεν αφαιρεί την προστασία δικτύου που μπορεί να παραμένει ενεργή.',
  recoveryRelease: 'Άρση προστασίας και αποκατάσταση internet',
  recoveryRestart: 'Εκκίνηση υπηρεσίας VPN',
  autoStart: 'Εκκίνηση κατά τη σύνδεση',
  autoStartHint: 'Άνοιγμα του K1VPN όταν συνδέεστε.',
  loginItemApprovalRequired:
    'Επιτρέψτε το K1VPN στις Ρυθμίσεις συστήματος > Γενικά > Στοιχεία σύνδεσης για αυτόματη εκκίνηση.',
  loginItemFailed:
    'Δεν ήταν δυνατή η αλλαγή της αυτόματης εκκίνησης. Ελέγξτε τα Στοιχεία σύνδεσης στις Ρυθμίσεις συστήματος.',
  autoConnect: 'Αυτόματη σύνδεση κατά το άνοιγμα',
  autoConnectHint:
    'Σύνδεση στον τελευταίο server όταν ανοίγει το K1VPN. Για είσοδο χωρίς πληκτρολόγηση, ενεργοποιήστε την απομνημόνευση στοιχείων. Το Sign out αποτρέπει την αυτόματη είσοδο.',
  autoConnectFailedLabel: 'Η αυτόματη σύνδεση απέτυχε',
  autoConnectErrorAuth: 'Συνδεθείτε ξανά ή ελέγξτε ότι ο λογαριασμός σας στην K1VPN είναι ενεργός.',
  autoConnectErrorNetwork: 'Δεν υπάρχει πρόσβαση στο δίκτυο. Ελέγξτε τη σύνδεσή σας στο internet.',
  autoConnectErrorProtocol: 'Ο server της K1VPN έστειλε μη αναμενόμενη απάντηση.',
  autoConnectErrorVpnPermission: 'Το σύστημα δεν έδωσε στο K1VPN άδεια για δημιουργία VPN.',
  autoConnectErrorSnapPermission:
    'Το K1VPN χρειάζεται άδεια για τη διαχείριση του δικτύου. Σε ένα τερματικό, τρέξε: sudo snap connect k1vpn:network-control && sudo snap connect k1vpn:firewall-control && sudo snap connect k1vpn:k1vpn-polkit :polkit',
  autoConnectErrorVpn: 'Δεν ήταν δυνατή η εκκίνηση του VPN tunnel.',
  autoConnectErrorConfig: 'Οι ρυθμίσεις VPN για αυτόν τον server δεν είναι έγκυρες.',
  autoConnectErrorBusy: 'Το K1VPN εκτελούσε ήδη άλλη ενέργεια.',
  autoConnectErrorSuperseded: 'Ακυρώθηκε από νεότερο αίτημα σύνδεσης.',
  autoConnectErrorGeneric: 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.',
  dismiss: 'Απόρριψη',
  killSwitch: 'Kill switch',
  allowLocalNetwork: 'Πρόσβαση στο τοπικό δίκτυο',
  allowLocalNetworkHint:
    'Με ενεργό kill switch, επιτρέπει πρόσβαση σε router, εκτυπωτές και NAS εκτός VPN. Ισχύει από την επόμενη σύνδεση.',
  autoConnectSystemHint:
    'Σύνδεση στον τελευταίο server κατά το άνοιγμα με αποθηκευμένα στοιχεία και επανασύνδεση μέσω VPN On Demand μετά τη σύνδεση. Η αποσύνδεση αναστέλλει το On Demand μέχρι να συνδεθείτε ξανά.',
  killSwitchSystemHint:
    'Η κίνηση περνά από το VPN χωρίς εναλλακτική διαδρομή όσο το σύστημα διατηρεί ενεργό το VPN. Ορισμένη κίνηση συστήματος εξαιρείται. Η αποσύνδεση επιτρέπει πρόσβαση εκτός VPN. Ισχύει από την επόμενη σύνδεση.',
  killSwitchHint:
    'Όσο είσαι συνδεδεμένος, μπλοκάρει κάθε κίνηση στο internet εκτός VPN, ώστε τίποτα να μη διαρρέει αν πέσει το tunnel. Η αποσύνδεση επαναφέρει την κανονική πρόσβαση. Ισχύει από την επόμενη σύνδεση.',
  dnsProvider: 'Διακομιστής DNS',
  dnsHint:
    'Τα αιτήματα DNS περνούν πάντα μέσα από το VPN tunnel, όποιον κι αν επιλέξεις. Ισχύει από την επόμενη σύνδεση.',
  dnsDefault: 'Προεπιλογή K1VPN',
  dnsCloudflare: 'Cloudflare (1.1.1.1)',
  dnsQuad9: 'Quad9 (9.9.9.9)',
  dnsGoogle: 'Ασφαλής περιήγηση (AdGuard)',
  dnsCustom: 'Προσαρμοσμένο',
  dnsCustomHint:
    'Μόνο δημόσιες διευθύνσεις IPv4. Ο διακομιστής DNS που επιλέγεις βλέπει τα αιτήματα DNS σου.',
  dnsPrimary: 'Κύριο DNS',
  dnsSecondary: 'Δευτερεύον DNS (προαιρετικό)',
  dnsInvalid: 'Δώσε μια έγκυρη διεύθυνση IP.',
  dnsIpv4Only: 'Αυτό το VPN tunnel υποστηρίζει προς το παρόν μόνο DNS servers IPv4.',
  dnsNotPublic:
    'Δεν επιτρέπονται τοπικές ή ιδιωτικές διευθύνσεις, ο VPN server δεν μπορεί να τις προσεγγίσει.',
  dnsCustomRequired: 'Δώσε τουλάχιστον έναν διακομιστή DNS.',
  saveDns: 'Αποθήκευση',
  quitApp: 'Τερματισμός K1VPN',
  quitting: 'Τερματισμός K1VPN…',
  endingSession: 'Αποσύνδεση…',
  quitDescription: 'Αποσύνδεση VPN και κλείσιμο του K1VPN',
  brand: 'K1VPN',
  loginTagline: 'Secure by Default',
  subscriptionRequired: 'Για να λειτουργήσει η εφαρμογή, απαιτείται ενεργή συνδρομή στην K1VPN.',

  loginSubtitle: 'Συνδέσου στον λογαριασμό VPN σου',
  welcomeBack: 'Καλώς ήρθες ξανά',
  continueAsQuestion: 'Συνέχεια ως {username};',
  continueAs: 'Συνέχεια ως {username}',
  signingIn: 'Σύνδεση...',
  useDifferentAccount: 'Χρήση άλλου λογαριασμού',
  vpnUsername: 'Όνομα χρήστη VPN',
  usernameRequired: 'Συμπλήρωσε το όνομα χρήστη VPN.',
  passwordRequired: 'Συμπλήρωσε τον κωδικό VPN.',
  vpnPassword: 'Κωδικός VPN',
  showPassword: 'Εμφάνιση κωδικού',
  hidePassword: 'Απόκρυψη κωδικού',
  rememberCredentials: 'Απομνημόνευση στοιχείων',
  consentAcceptThe: 'Αποδέχομαι τους',
  consentAnd: 'και την',
  termsOfUse: 'Όρους χρήσης',
  vpnNoticeTitle: 'Πριν ξεκινήσετε',
  vpnNoticeIntro:
    'Το K1VPN δημιουργεί μια κρυπτογραφημένη σύνδεση VPN ανάμεσα στη συσκευή σας και στους servers της K1VPN, ώστε να συμβάλλει στην προστασία της κίνησης internet σας.',
  vpnNoticeCredentials:
    'Για τη σύνδεση χρειάζεται μόνο το όνομα χρήστη VPN και ο κωδικός VPN, όχι το email σας. Αυτά τα στοιχεία σχετίζονται με τον λογαριασμό σας στην K1VPN και μεταδίδονται μέσω κρυπτογραφημένης σύνδεσης μόνο στους servers της K1VPN για ταυτοποίηση και παροχή της υπηρεσίας.',
  vpnNoticeIp:
    'Η εφαρμογή ανακτά τη δημόσια διεύθυνση IP σας πριν και μετά τη σύνδεση, ώστε να βλέπετε την IP που χρησιμοποιείται εκείνη τη στιγμή για τη σύνδεσή σας στο internet.',
  vpnNoticeIpLookup:
    'Αυτή η αναζήτηση IP γίνεται αποκλειστικά από την υποδομή της K1VPN. Η IP που εμφανίζεται δεν αποθηκεύεται, δεν συσχετίζεται με τον λογαριασμό VPN σας και δεν αποστέλλεται σε τρίτη υπηρεσία αναζήτησης IP.',
  vpnNoticeSessionIp:
    'Κατά τη διάρκεια μιας σύνδεσης VPN, η διεύθυνση IP προέλευσής σας υποβάλλεται σε επεξεργασία μόνο στον βαθμό που είναι τεχνικά απαραίτητος για τη δημιουργία και διατήρηση της σύνδεσης και δεν αποθηκεύεται σε μόνιμα αρχεία καταγραφής συνδέσεων.',
  vpnNoticeServers:
    'Η εφαρμογή επικοινωνεί μόνο με την υποδομή της K1VPN και τους VPN servers στους οποίους επιλέγετε να συνδεθείτε.',
  vpnNoticeNoAds: 'Η K1VPN δεν χρησιμοποιεί υπηρεσίες διαφήμισης ή ανάλυσης τρίτων.',
  vpnNoticeMore: 'Περισσότερες λεπτομέρειες είναι διαθέσιμες στην',
  vpnNoticeAccept: 'Αποδοχή',
  vpnNoticeDecline: 'Απόρριψη',
  vpnNoticeBlockedTitle: 'Απορρίφθηκε',
  vpnNoticeBlockedText:
    'Χωρίς αποδοχή αυτής της ενημέρωσης, η υπηρεσία VPN του K1VPN δεν μπορεί να χρησιμοποιηθεί σε αυτή τη συσκευή. Μπορείτε να επιστρέψετε και να τη διαβάσετε ξανά όποτε είστε έτοιμοι να την αποδεχτείτε.',
  signIn: 'Σύνδεση',

  menu: 'Μενού',
  statusNotConnected: 'Μη προστατευμένο',
  statusConnecting: 'Σύνδεση...',
  statusConnected: 'Προστατευμένο',
  statusDisconnecting: 'Αποσύνδεση...',
  selectServerFirst: 'Επιλέξτε πρώτα διακομιστή.',
  connect: 'Σύνδεση',
  disconnect: 'Αποσύνδεση',
  allServers: 'Όλες',
  favorites: 'Αγαπημένα',
  loadingServers: 'Φόρτωση διακομιστών...',
  retry: 'Επανάληψη',
  noFavoriteServers: 'Δεν υπάρχουν αγαπημένοι διακομιστές ακόμα.',
  noServersAvailable: 'Δεν υπάρχουν διαθέσιμοι διακομιστές.',
  recommended: 'Προτεινόμενος',
  addFavorite: 'Προσθήκη στα αγαπημένα',
  removeFavorite: 'Αφαίρεση από τα αγαπημένα',
  yourIp: 'Η IP σου',
  ipChecking: 'Έλεγχος IP...',
  ipUnavailable: 'Δεν επιβεβαιώθηκε η τρέχουσα IP.',
  statusChecking: 'Έλεγχος σύνδεσης...',
  statusUnknown: 'Η κατάσταση σύνδεσης δεν είναι διαθέσιμη',
  statusVerifying: 'Ολοκλήρωση σύνδεσης...',
  statusConnectedUnverified: 'Συνδέθηκε στο VPN',
  statusNoInternet: 'ΧΩΡΙΣ INTERNET',
  connectionNoUplink:
    'Η συσκευή δεν έχει σύνδεση δικτύου. Το VPN παραμένει ενεργό και θα ελεγχθεί ξανά όταν επανέλθει.',
  connectionNoResponse:
    'Δεν υπάρχει πρόσβαση στο internet μέσω του VPN. Ενδέχεται να έχει διακοπεί η σύνδεση internet ή η υπηρεσία VPN. Το K1VPN συνεχίζει να ελέγχει.',
  connectionNoUplinkDisconnected:
    'Η συσκευή δεν έχει σύνδεση δικτύου. Το VPN είναι αποσυνδεδεμένο. Το K1VPN συνεχίζει να ελέγχει.',
  connectionNoResponseDisconnected:
    'Δεν υπάρχει πρόσβαση στο internet. Το VPN είναι αποσυνδεδεμένο. Το K1VPN συνεχίζει να ελέγχει.',
  connectionAddressUnchecked: 'Το VPN είναι ενεργό. Η τρέχουσα διεύθυνση ελέγχεται ακόμα.',
  connectionStale:
    'Δεν επιβεβαιώθηκε πρόσφατη κίνηση μέσα από το VPN. Το K1VPN ελέγχει τη σύνδεση.',
  connectionDetails: 'Στοιχεία σύνδεσης',
  serverLocation: 'Τοποθεσία server',
  selectedLocation: 'Επιλεγμένη τοποθεσία',
  vpnIp: 'VPN IP',
  connectionReady: 'Σύνδεση μέσω του VPN server σου.',
  connectionPrompt: 'Διάλεξε πού θέλεις να συνδεθείς.',
  connectionInProgress: 'Τα στοιχεία ενημερώνονται αυτόματα.',
  connectionUnavailable: 'Αναζήτηση της υπηρεσίας VPN.',
  chooseLocation: 'Επίλεξε τοποθεσία',
  locationUnavailable: 'Μη διαθέσιμη τοποθεσία',
  selected: 'Επιλεγμένο',
  menuHeading: 'Στα μέτρα σου.',
  menuDescription: 'Ο λογαριασμός και οι προτιμήσεις σου, μαζί.',
  accountDescription: 'Συνδρομή και στοιχεία λογαριασμού',
  settingsDescription: 'Προσάρμοσε το K1VPN',
  aboutDescription: 'Πληροφορίες για την εφαρμογή',
  languageDescription: 'Επίλεξε τη γλώσσα που σε εξυπηρετεί.',
  aboutTagline: 'Η σύνδεσή σου. Ο χώρος σου.',
  aboutStatement: 'Απλό, Κατανοητό, Ασφαλές.\nΚαμία πολυπλοκότητα, μόνο Ιδιωτικότητα.',
  dnsLeakTest: 'DNS Leak Test',
  webrtcLeakTest: 'WebRTC Leak Test',
  privacyPolicy: 'Πολιτική απορρήτου',
  aboutTech:
    'Βασισμένο στο open-source WireGuard®. Κρυπτογράφηση ChaCha20-Poly1305, ανταλλαγή κλειδιών Curve25519, κατακερματισμός BLAKE2s.',
  copyright: '© {year}, K1VPN. Με επιφύλαξη παντός δικαιώματος.',
  checkUpdates: 'Έλεγχος',
  updateIdle: 'Ενημερώσεις',
  updateChecking: 'Έλεγχος...',
  updateUpToDate: 'Έχεις την τελευταία έκδοση',
  updateAvailable: 'Νέα έκδοση {version} διαθέσιμη',
  updateFailed: 'Δεν ήταν δυνατός ο έλεγχος',
  startingApp: 'Ετοιμάζουμε την εφαρμογή...',
  checkingAccount: 'Έλεγχος λογαριασμού...',
  accountActive: 'Ενεργός',
  accountInactive: 'Ανενεργός',

  back: 'Πίσω',
  account: 'Λογαριασμός',
  settings: 'Ρυθμίσεις',
  about: 'Σχετικά',
  licenses: 'Άδειες τρίτων',

  status: 'Κατάσταση',
  created: 'Δημιουργήθηκε',
  modified: 'Τροποποιήθηκε',
  expires: 'Λήγει',
  never: 'Ποτέ',
  signOut: 'Αποσύνδεση λογαριασμού',

  language: 'Γλώσσα',

  application: 'Εφαρμογή',
  serverCount: 'Διακομιστές',
  version: 'Έκδοση'
}

export const translations = { en, el }

export type TranslationKey = keyof typeof en
