import { useEffect, useState } from 'react'
import { deviceGroupsApi } from '../../lib/api'
import type { DeviceGroup } from '../../types'
import { ALL_DEVICES } from './deviceViews'

const VIEW_KEY = 'valkyrie.screentime.view'

/** The view the page is showing (all devices, one device, or a group), remembered so the page opens on the one you last used. */
export function useDeviceView() {
  const [choice, setChoice] = useState(() => localStorage.getItem(VIEW_KEY) ?? ALL_DEVICES)
  const choose = (next: string) => {
    setChoice(next)
    if (next === ALL_DEVICES) localStorage.removeItem(VIEW_KEY)
    else localStorage.setItem(VIEW_KEY, next)
  }
  return [choice, choose] as const
}

/** The groups of devices the person made. */
export function useDeviceGroups() {
  const [groups, setGroups] = useState<DeviceGroup[]>([])
  useEffect(() => {
    let cancelled = false
    deviceGroupsApi.list().then(
      (list) => !cancelled && setGroups(list),
      () => undefined, // not essential: the page still works on all devices
    )
    return () => {
      cancelled = true
    }
  }, [])
  return {
    groups,
    saved: (saved: DeviceGroup) => setGroups((list) => (list.some((g) => g.id === saved.id) ? list.map((g) => (g.id === saved.id ? saved : g)) : [...list, saved])),
    deleted: (id: string) => setGroups((list) => list.filter((g) => g.id !== id)),
  }
}
