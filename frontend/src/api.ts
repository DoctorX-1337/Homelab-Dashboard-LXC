import type { ApiStatus, Cluster, DashboardEvent, EditableItem, Link, Resource, Service, SettingsItems, ThemeName, ThemePreference, UpdateStatus } from './types'

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`)
  return response.json() as Promise<T>
}

export async function loadDashboard() {
  const [status, cluster, resources, services, links, events] = await Promise.all([
    get<ApiStatus>('/api/status'), get<Cluster>('/api/cluster'), get<Resource[]>('/api/resources'),
    get<Service[]>('/api/services'), get<Link[]>('/api/links'), get<DashboardEvent[]>('/api/events'),
  ])
  return { status, cluster, resources, services, links, events }
}

export const loadSettings = () => get<SettingsItems>('/api/settings/items')
export const loadTheme = () => get<ThemePreference>('/api/settings/theme')
export const loadUpdateStatus = () => get<UpdateStatus>('/api/update-status')

export async function installUpdate() {
  const response = await fetch('/api/update', {
    method: 'POST',
    headers: { 'X-Dashboard-Settings': '1' },
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<{ started: boolean; target_version: string }>
}

export async function updateTheme(theme: ThemeName) {
  const response = await fetch('/api/settings/theme', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify({ theme }),
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<ThemePreference>
}

const settingsPayload = (item: EditableItem) => ({
  name: item.name, description: item.description, icon: item.icon, url: item.url, favorite: Boolean(item.favorite),
})

export async function addSetting(kind: 'hosts' | 'links', item: EditableItem) {
  const response = await fetch(`/api/settings/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify(settingsPayload(item)),
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<EditableItem>
}

export async function updateSetting(kind: 'applications' | 'links', item: EditableItem) {
  if (!item.id) throw new Error('Missing item ID')
  const path = `/api/settings/${kind}/${encodeURIComponent(item.id)}`
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify(settingsPayload(item)),
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<EditableItem>
}

export async function deleteSetting(kind: 'applications' | 'links', id: string) {
  const response = await fetch(`/api/settings/${kind}/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'X-Dashboard-Settings': '1' },
  })
  if (!response.ok) throw new Error(await response.text())
}
