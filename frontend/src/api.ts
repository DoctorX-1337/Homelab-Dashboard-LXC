import type { ApiStatus, AuthStatus, BrandingSettings, Cluster, DashboardEvent, EditableItem, InfrastructureConfig, InfrastructureResponse, Link, Resource, Service, SettingsItems, ThemeName, ThemePreference, UpdateStatus } from './types'

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
export const loadAuthStatus = () => get<AuthStatus>('/api/auth/status')
export const loadBranding = () => get<BrandingSettings>('/api/settings/branding')
export const loadInfrastructure = () => get<InfrastructureResponse>('/api/settings/infrastructure')

export async function saveInfrastructure(config: InfrastructureConfig, proxmoxSecret: string, pbsSecret: string) {
  const response = await fetch('/api/settings/infrastructure', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify({
      ...config,
      proxmox_token_secret: proxmoxSecret || null,
      pbs_token_secret: pbsSecret || null,
    }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || 'Infrastruktur-Konfiguration konnte nicht gespeichert werden')
  }
  return response.json() as Promise<InfrastructureResponse>
}

export async function uploadCustomLogo(file: File, name: string) {
  if (file.size > 3_000_000) throw new Error('Das Logo darf höchstens 3 MB groß sein.')
  const content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Das Logo konnte nicht gelesen werden.'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
    reader.readAsDataURL(file)
  })
  const response = await fetch('/api/settings/logos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify({ name: name || file.name.replace(/\.[^.]+$/, ''), content_base64: content }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || 'Das Logo konnte nicht hochgeladen werden')
  }
  return response.json() as Promise<{ icon: string; filename: string }>
}

export async function unlockSettings(pin: string) {
  const response = await fetch('/api/auth/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify({ pin }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || 'PIN-Prüfung fehlgeschlagen')
  }
  return response.json() as Promise<{ authenticated: boolean }>
}

export async function changeSettingsPin(currentPin: string, newPin: string) {
  const response = await fetch('/api/settings/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || 'PIN konnte nicht geändert werden')
  }
  return response.json() as Promise<{ accepted: boolean }>
}

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

export async function updateBranding(branding: BrandingSettings) {
  const response = await fetch('/api/settings/branding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Settings': '1' },
    body: JSON.stringify(branding),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || 'Texte konnten nicht gespeichert werden')
  }
  return response.json() as Promise<BrandingSettings>
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
