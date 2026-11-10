const SNAP_PERMISSION_CONNECTIONS =
  'sudo snap connect k1vpn:network-control && sudo snap connect k1vpn:firewall-control && sudo snap connect k1vpn:k1vpn-polkit :polkit'
export const SNAP_PERMISSION_COMMAND = SNAP_PERMISSION_CONNECTIONS + ' && sudo snap restart k1vpn.k1vpnd'

// Manual connection errors arrive as IPC-wrapped messages; auto-connect has a stable code.
export function isSnapPermissionMessage(message: string): boolean {
  return message.includes('K1VPN needs permission to manage the network.') &&
    message.includes(SNAP_PERMISSION_CONNECTIONS)
}
