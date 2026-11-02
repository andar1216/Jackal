import { useState } from 'react'
import { deviceGroupsApi } from '../../lib/api'
import type { DeviceGroup } from '../../types'
import { ALL_DEVICES, deviceKey, groupKey, type KnownDevice } from './deviceViews'

type Props = {
  devices: KnownDevice[]
  groups: DeviceGroup[]
  /** The view being shown: ALL_DEVICES, `device:<name>` or `group:<id>`. */
  activeKey: string
  onSelect: (key: string) => void
  onSaved: (group: DeviceGroup) => void
  onDeleted: (id: string) => void
  onError: (message: string) => void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

/** Pick what the page shows: all devices, one device, or a group of devices you made (like Work). Make and edit groups here too. */
export default function DeviceViewsBar({ devices, groups, activeKey, onSelect, onSaved, onDeleted, onError }: Props) {
  // null = closed, 'new' = creating, otherwise the id of the group being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const activeGroup = groups.find((g) => groupKey(g.id) === activeKey) ?? null

  const open = (group: DeviceGroup | null) => {
    setEditing(group ? group.id : 'new')
    setName(group?.name ?? '')
    setPicked(new Set(group?.devices ?? []))
  }

  const select = (key: string) => {
    setEditing(null)
    onSelect(key)
  }

  const toggle = (device: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(device)) next.delete(device)
      else next.add(device)
      return next
    })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return onError('Give the group a name.')
    if (groups.some((g) => g.id !== editing && g.name.toLowerCase() === trimmed.toLowerCase())) return onError(`You already have a group named ${trimmed}.`)
    const body = { name: trimmed, devices: [...picked] }
    try {
      const saved = editing === 'new' ? await deviceGroupsApi.create(body) : await deviceGroupsApi.update(editing!, body)
      onSaved(saved)
      onSelect(groupKey(saved.id))
      setEditing(null)
    } catch (err) {
      onError(errorText(err))
    }
  }

  const remove = async () => {
    const target = groups.find((g) => g.id === editing)
    if (!target) return
    if (!window.confirm(`Delete the group "${target.name}"? Your devices and their screen time are not affected.`)) return
    try {
      await deviceGroupsApi.remove(target.id)
      onDeleted(target.id)
      if (activeKey === groupKey(target.id)) onSelect(ALL_DEVICES)
      setEditing(null)
    } catch (err) {
      onError(errorText(err))
    }
  }

  // Devices in a group that have no numbers right now (removed, say) are kept, so they aren't silently dropped.
  const stale = [...picked].filter((p) => !devices.some((d) => d.name === p))

  const button = (key: string, label: string) => (
    <button key={key} className={activeKey === key ? 'active' : ''} aria-pressed={activeKey === key} onClick={() => select(key)}>
      {label}
    </button>
  )

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <strong>View</strong>
          <div className="segmented" role="group" aria-label="Devices" style={{ flexWrap: 'wrap' }}>
            {button(ALL_DEVICES, 'All devices')}
            {devices.map((d) => button(deviceKey(d.name), d.name))}
          </div>
          {groups.length > 0 && (
            <div className="segmented" role="group" aria-label="Groups" style={{ flexWrap: 'wrap' }}>
              {groups.map((g) => button(groupKey(g.id), g.name))}
            </div>
          )}
        </div>
        <div className="row">
          {activeGroup && editing === null && (
            <button className="link" onClick={() => open(activeGroup)}>
              Edit "{activeGroup.name}"
            </button>
          )}
          {editing === null && <button onClick={() => open(null)}>New group</button>}
        </div>
      </div>

      {editing !== null && (
        <form onSubmit={save} style={{ marginTop: 12 }}>
          <div className="form">
            <input placeholder="Group name, like Work" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" autoFocus maxLength={100} />
          </div>
          <p className="stat-label" style={{ marginBottom: 4 }}>
            Choose which devices belong in this group.
          </p>
          {devices.length === 0 && <p className="empty">No devices have sent screen time yet. Add one in Devices first.</p>}
          <ul className="list">
            {devices.map((d) => (
              <li key={d.name}>
                <label className="row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.has(d.name)} onChange={() => toggle(d.name)} />
                  <span>
                    {d.name}
                    <span className="pill" style={{ marginLeft: 8 }}>
                      {d.kind === 'phone' ? 'Phone' : 'Computer'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {stale.length > 0 && <p className="stat-label">Also kept: {stale.join(', ')} (not listed right now).</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" type="submit">
              Save group
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing !== 'new' && (
              <button type="button" className="link" onClick={remove}>
                Delete group
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
