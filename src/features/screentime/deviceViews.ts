import type { DeviceGroup, ScreenTimeSite, ScreenTimeUsage } from '../../types'

/** A device that has sent screen time, by the name it is shown under. */
export type KnownDevice = { name: string; kind: 'computer' | 'phone' }

/** Which devices the page can show: every one that has numbers, computers first. */
export function devicesIn(usage: ScreenTimeUsage[], sites: ScreenTimeSite[]): KnownDevice[] {
  const byName = new Map<string, KnownDevice>()
  for (const row of [...usage, ...sites]) if (!byName.has(row.device)) byName.set(row.device, { name: row.device, kind: row.kind })
  return [...byName.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'computer' ? -1 : 1))
}

export const ALL_DEVICES = 'all'
export const deviceKey = (name: string) => `device:${name}`
export const groupKey = (id: string) => `group:${id}`

/**
 * What a saved choice means right now: all devices, one device, or one group. A device that has no numbers any more, or a
 * group that was deleted, falls back to everything.
 */
export type DeviceView = { key: string; label: string | null; includes: (device: string) => boolean }

export function resolveView(choice: string, devices: KnownDevice[], groups: DeviceGroup[]): DeviceView {
  const all: DeviceView = { key: ALL_DEVICES, label: null, includes: () => true }
  if (choice.startsWith('device:')) {
    const name = choice.slice('device:'.length)
    return devices.some((d) => d.name === name) ? { key: choice, label: name, includes: (device: string) => device === name } : all
  }
  if (choice.startsWith('group:')) {
    const group = groups.find((g) => g.id === choice.slice('group:'.length))
    return group ? { key: choice, label: group.name, includes: (device: string) => group.devices.includes(device) } : all
  }
  return all
}
