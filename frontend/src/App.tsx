import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Download, Grid2X2, Link2, List, Search, Settings } from 'lucide-react'
import { loadDashboard, loadTheme, loadUpdateStatus } from './api'
import { Icon } from './icons'
import { SettingsModal } from './SettingsModal'
import type { ApiStatus, Cluster, DashboardEvent, Link as LinkType, Resource, Service, ThemeName, UpdateStatus } from './types'

const emptyCluster: Cluster = { nodes: 0, containers: 0, vms: 0, running: 0, stopped: 0, healthy: false, cpu: 0, memory_used: 0, memory_total: 0, storage_used: 0, storage_total: 0 }
const percent = (used: number, total: number) => total ? Math.min(100, Math.round(used / total * 100)) : 0
const bytes = (value: number) => { const units = ['B', 'KB', 'MB', 'GB', 'TB']; let n = value; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i += 1 } return `${n.toFixed(i >= 3 ? 1 : 0)} ${units[i]}` }
type Weather = { temperature: number; code: number; location?: string }
const weatherText = (code: number) => code === 0 ? 'Klar' : code <= 3 ? 'Leicht bewölkt' : code <= 48 ? 'Neblig' : code <= 67 ? 'Regen' : code <= 77 ? 'Schnee' : code <= 82 ? 'Regenschauer' : 'Gewitter'
const weatherIcon = (code: number) => code === 0 ? 'sun' : code <= 3 ? 'cloud-sun' : code <= 48 ? 'cloud' : code <= 67 || (code >= 80 && code <= 82) ? 'rain' : code <= 77 ? 'snow' : 'storm'
const logoFiles: Record<string, string> = {
  adguard: 'adguard.png', certbot: 'certbot.png', checkmk: 'checkmk.png', cloud: 'cloudflare.png',
  cloudflare: 'cloudflare.png', fritzbox: 'fritzbox.png', homedc: 'windows.png', icloud: 'icloud.png',
  immich: 'immich.png', instagram: 'instagram.png', iventoy: 'iventoy.png', jdownloader: 'jdownloader2.png',
  jellyfin: 'jellyfin.png', joplin: 'joplin-server.png', lokaleki: 'lokaleki.png', lyrion: 'lyrionmusicserver.png',
  nas: 'qnap-nas.png', netflix: 'netflix.png', nginx: 'nginx.png', outlook: 'outlook.png', patchmon: 'patchmon.png',
  paypal: 'paypal.png', pbs: 'pbs.png', database: 'pbs.png', qnap: 'qnap-nas.png',
  'prime-video': 'prime-video.png', proxmox: 'proxmox.png', shield: 'certbot.png', twitch: 'twitch.png',
  whatsapp: 'whatsapp.png', windows: 'windows.png', wireguard: 'wireguard.png', x: 'x.png', youtube: 'youtube.png',
}
const logoFor = (icon: string, name = '') => {
  const nameAliases: Record<string, string> = {
    'fritz!box': 'fritzbox', homedc: 'windows', 'nas01': 'qnap',
    'nginx proxyverwaltung': 'nginx', wireguard: 'wireguard',
  }
  const key = nameAliases[name.toLowerCase()] ?? icon.toLowerCase()
  const file = logoFiles[key]
  return file ? `/assets/logos/${encodeURIComponent(file)}` : null
}

function StatusCard({ icon, title, value, detail, progress, accent = false, url, tone }: { icon: string; title: string; value: string; detail: string; progress?: number; accent?: boolean; url?: string; tone?: 'online' | 'offline' }) {
  const content = <>
    <span className="status-icon"><Icon name={icon} size={35} /></span>
    <div className="status-copy"><small>{title}</small><strong className={tone ? `status-value ${tone}` : ''}>{tone && <i />}{value}</strong>{progress !== undefined && <div className="usage"><i style={{ width: `${progress}%` }} /></div>}<span>{detail}</span></div>
    <ChevronRight className="arrow" />
  </>
  const className = `status-card ${accent ? 'accent' : ''}`
  return url ? <a className={className} href={url} target="_blank" rel="noreferrer">{content}</a> : <article className={className}>{content}</article>
}

function ClusterLoadCard({ cluster, running, total }: { cluster: Cluster; running: number; total: number }) {
  const cpu = Math.round(cluster.cpu * 100)
  const ram = percent(cluster.memory_used, cluster.memory_total)
  return <article className="status-card cluster-load-card">
    <span className="status-icon"><Icon name="gauge" size={35} /></span>
    <div className="cluster-load"><small>Cluster-Auslastung</small><div><span>CPU <b>{cpu}%</b></span><i><em style={{ width: `${cpu}%` }} /></i></div><div><span>RAM <b>{ram}%</b></span><i><em style={{ width: `${ram}%` }} /></i></div><p>{running} / {total} Dienste aktiv</p></div>
    <ChevronRight className="arrow" />
  </article>
}

function AppCard({ item }: { item: Resource }) {
  const online = ['running', 'online'].includes(item.status)
  const logo = logoFor(item.icon, item.name)
  const card = <>
    <span className={`app-icon tone-${item.icon}`}>{logo ? <img src={logo} alt="" /> : <Icon name={item.icon} size={38} />}</span>
    <span className="app-copy"><strong>{item.name}</strong><small>{item.description || (item.type === 'qemu' ? 'Virtuelle Maschine' : 'Container-Dienst')}</small><em className={online ? 'online' : 'offline'}><i />{online ? 'Online' : 'Offline'}</em></span>
    <ChevronRight className="arrow" />
  </>
  return item.url ? <a className="app-card" href={item.url} target="_blank" rel="noreferrer">{card}</a> : <article className="app-card">{card}</article>
}

function LinkCard({ item }: { item: LinkType }) {
  const logo = logoFor(item.icon, item.name)
  return <a className="link-card" href={item.url} target="_blank" rel="noreferrer"><span>{logo ? <img src={logo} alt="" /> : <Icon name={item.icon} size={25} />}</span><p><strong>{item.name}</strong><small>{item.description}</small></p><ChevronRight /></a>
}

function App() {
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [cluster, setCluster] = useState<Cluster>(emptyCluster)
  const [resources, setResources] = useState<Resource[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [links, setLinks] = useState<LinkType[]>([])
  const [, setEvents] = useState<DashboardEvent[]>([])
  const [query, setQuery] = useState('')
  const [grid, setGrid] = useState(true)
  const [now, setNow] = useState(new Date())
  const [weather, setWeather] = useState<Weather | null>(null)
  const [weatherMessage, setWeatherMessage] = useState('Standortwetter wird geladen…')
  const [weatherAttempt, setWeatherAttempt] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeName>('green')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  const refresh = useCallback(async () => {
    try { const data = await loadDashboard(); setStatus(data.status); setCluster(data.cluster); setResources(data.resources); setServices(data.services); setLinks(data.links); setEvents(data.events) }
    catch { /* The last successful snapshot remains visible. */ }
  }, [])

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30_000); return () => window.clearInterval(timer) }, [refresh])
  useEffect(() => { void loadTheme().then(value => setTheme(value.theme)).catch(() => undefined) }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    const check = () => void loadUpdateStatus().then(setUpdateStatus).catch(() => undefined)
    check()
    const timer = window.setInterval(check, 15 * 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    let disposed = false
    const fetchWeather = async (latitude: number, longitude: number, location?: string) => {
      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast')
        url.searchParams.set('latitude', String(Math.round(latitude * 100) / 100)); url.searchParams.set('longitude', String(Math.round(longitude * 100) / 100))
        url.searchParams.set('current', 'temperature_2m,weather_code'); url.searchParams.set('timezone', 'auto')
        const response = await fetch(url); if (!response.ok) throw new Error('weather')
        const payload = await response.json() as { current?: { temperature_2m?: number; weather_code?: number } }
        if (payload.current?.temperature_2m === undefined || payload.current.weather_code === undefined) throw new Error('weather')
        if (!disposed) setWeather({ temperature: payload.current.temperature_2m, code: payload.current.weather_code, location })
      } catch { if (!disposed) setWeatherMessage('Wetter derzeit nicht verfügbar') }
    }
    if (!navigator.geolocation) { setWeatherMessage('Standort nicht verfügbar'); return () => { disposed = true } }
    setWeatherMessage('Standortwetter wird geladen…')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => void fetchWeather(coords.latitude, coords.longitude),
      error => { if (!disposed) setWeatherMessage(error.code === error.PERMISSION_DENIED ? 'Für Wetter Standort anklicken' : 'Standort erneut versuchen') },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 1_800_000 },
    )
    return () => { disposed = true }
  }, [weatherAttempt])

  const applications = useMemo(() => [
    ...resources.filter(item => ['lxc', 'qemu'].includes(item.type)),
    ...services.map((service): Resource => ({
      vmid: null, name: service.name, type: 'unknown', node: 'manual',
      status: service.reachable === false ? 'offline' : 'online', cpu: 0,
      memory: { used: 0, total: 0 }, disk: { used: 0, total: 0 }, uptime: 0,
      icon: service.icon, url: service.url, description: service.description,
      favorite: service.favorite, reachable: service.reachable,
    })),
  ]
    .filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (a.vmid ?? 99_999) - (b.vmid ?? 99_999) || a.name.localeCompare(b.name)), [query, resources, services])

  const runningServices = resources.filter(item => ['lxc', 'qemu'].includes(item.type) && ['running', 'online'].includes(item.status)).length
  const allServices = resources.filter(item => ['lxc', 'qemu'].includes(item.type)).length
  const storage = percent(cluster.storage_used, cluster.storage_total)
  const hour = now.getHours()
  const greeting = hour < 11 ? 'Guten Morgen!' : hour < 18 ? 'Guten Tag!' : 'Guten Abend!'
  const backupTime = status?.latest_backup?.timestamp ? new Date(String(status.latest_backup.timestamp)) : null
  const backupLabel = !status?.api_configured ? 'Nicht eingerichtet' : backupTime ? backupTime.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : 'Bereit'
  const dashboardTitle = status?.dashboard_name || 'HomeLab Dashboard'
  const dashboardSubtitle = status?.dashboard_subtitle || 'Deine Dienste auf einen Blick'

  return <div className="dashboard">
    {updateStatus?.update_available && <aside className="update-banner">
      <span><Download /><strong>Dashboard-Update verfügbar</strong><small>Installiert: v{updateStatus.current_version} · Neu: v{updateStatus.latest_version}</small></span>
      <button type="button" onClick={() => setSettingsOpen(true)}>Update installieren<ChevronRight /></button>
    </aside>}
    <header className="topbar">
      <div className="identity"><span className="cube"><img src="/assets/homelab-logo.png" alt="HomeLab" /></span><div><h1>{dashboardTitle}</h1><p>{dashboardSubtitle}</p></div></div>
      <button className="welcome" type="button" onClick={() => setWeatherAttempt(value => value + 1)} title="Standortwetter erneut laden"><Icon name={weather ? weatherIcon(weather.code) : 'cloud-sun'} size={38} /><p><strong>{greeting}</strong><span>{weather ? `${Math.round(weather.temperature)} °C · ${weatherText(weather.code)}` : weatherMessage}</span></p></button>
      <div className="datetime"><span>{now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</span><strong>{now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</strong></div>
    </header>

    <main>
      <section className="status-grid">
        <StatusCard icon="server" title="Cluster-Status" value={!status?.api_configured ? 'Nicht eingerichtet' : cluster.healthy ? 'Gesund' : 'Warnung'} tone={!status?.api_configured ? undefined : cluster.healthy ? 'online' : 'offline'} detail={!status?.api_configured ? 'Proxmox-Zugang konfigurieren' : `${cluster.nodes} Knoten online`} accent />
        <ClusterLoadCard cluster={cluster} running={runningServices} total={allServices} />
        <StatusCard icon="database" title="Speichernutzung" value={`${storage}%`} detail={`${bytes(cluster.storage_used)} von ${bytes(cluster.storage_total)} belegt`} progress={storage} />
        <StatusCard icon="cloud" title="Letztes Backup" value={backupLabel} detail={status?.latest_backup ? 'Sicherungsstatus erfasst' : 'Wartet auf Status'} accent />
      </section>

      <section className="applications">
        <div className="section-head"><h2>Anwendungen &amp; Dienste</h2><div className="tools"><label><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Dienste suchen…" /></label><div className="switch"><button className={grid ? 'active' : ''} onClick={() => setGrid(true)}><Grid2X2 />Kacheln</button><button className={!grid ? 'active' : ''} onClick={() => setGrid(false)}><List />Liste</button></div></div></div>
        <div className={`apps-grid ${grid ? '' : 'list'}`}>{applications.map(item => <AppCard key={`${item.node}-${item.vmid ?? item.name}`} item={item} />)}</div>
      </section>

      <section className="useful">
        <div className="section-head simple"><h2><Link2 />Nützliche Links</h2></div>
        <div className="links-grid">{links.map(item => <LinkCard item={item} key={item.name} />)}</div>
      </section>
    </main>

    <footer><div><span className="home-mark"><img src="/favicon/favicon-32x32.png" alt="" /></span><strong>{dashboardTitle}</strong><i /><span>Dein Dashboard. Deine Konfiguration.</span></div><nav><button onClick={() => setSettingsOpen(true)}><Settings />Einstellungen</button></nav></footer>
    {settingsOpen && <SettingsModal theme={theme} updateStatus={updateStatus} onThemeChanged={setTheme} onClose={() => setSettingsOpen(false)} onChanged={refresh} />}
  </div>
}

export default App
