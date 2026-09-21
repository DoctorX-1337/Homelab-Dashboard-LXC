export type Memory = { used: number; total: number }

export type Resource = {
  vmid: number | null
  name: string
  type: 'node' | 'lxc' | 'qemu' | 'storage' | 'unknown'
  node: string
  status: string
  cpu: number
  memory: Memory
  disk: Memory
  uptime: number
  icon: string
  url: string | null
  description: string
  favorite: boolean
  reachable: boolean | null
}

export type Service = {
  id: string
  name: string
  description: string
  icon: string
  url: string
  favorite: boolean
  reachable: boolean | null
  status_code: number | null
}

export type Link = { name: string; description: string; icon: string; url: string }
export type ThemeName = 'multicolor' | 'blue' | 'green' | 'yellow' | 'red' | 'black' | 'purple' | 'cyan' | 'orange' | 'pink'
export type ThemePreference = { theme: ThemeName }
export type UpdateStatus = {
  current_version: string
  latest_version: string | null
  update_available: boolean
  repository_url: string
  checked_at: string
  error: string | null
  installation: {
    status: 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'rollback'
    message: string
    progress: number
    target_version: string | null
    updated_at: string | null
  }
}
export type EditableItem = Link & { id?: string; favorite?: boolean }
export type ManagedItem = EditableItem & { id: string; source: 'builtin' | 'custom'; hidden: boolean }
export type SettingsItems = { applications: ManagedItem[]; links: ManagedItem[] }
export type DashboardEvent = { id: string; timestamp: string; level: string; title: string; detail: string }
export type Cluster = {
  nodes: number; containers: number; vms: number; running: number; stopped: number; healthy: boolean
  cpu: number; memory_used: number; memory_total: number; storage_used: number; storage_total: number
}
export type ApiStatus = {
  ok: boolean; api_configured: boolean; last_refresh: string | null; last_success: string | null
  error: string | null; refresh_interval: number; dashboard_name: string; dashboard_subtitle: string
  verify_ssl: boolean; latest_backup: Record<string, unknown> | null
}
