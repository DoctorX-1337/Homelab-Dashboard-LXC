import type { LucideIcon } from 'lucide-react'
import { Activity, Bot, Boxes, Cloud, CloudLightning, CloudRain, CloudSnow, CloudSun, Database, Download, ExternalLink, FileText, Gauge, Globe2, HardDrive, HeartPulse, Home, Image, LayoutDashboard, Link2, Music, Network, NotebookPen, PanelTop, Router, Server, Settings, ShieldCheck, Star, Sun, Tv, Wifi } from 'lucide-react'

const icons: Record<string, LucideIcon> = {
  activity: Activity, bot: Bot, boxes: Boxes, cloud: Cloud, database: Database, download: Download,
  file: FileText, gauge: Gauge, globe: Globe2, harddrive: HardDrive, health: HeartPulse, home: Home,
  image: Image, dashboard: LayoutDashboard, link: Link2, music: Music, network: Network,
  notebook: NotebookPen, panel: PanelTop, router: Router, server: Server, settings: Settings,
  shield: ShieldCheck, star: Star, tv: Tv, wifi: Wifi, proxmox: Boxes, nas: HardDrive,
  fritzbox: Router, netflix: Tv, nginx: Settings, qnap: HardDrive, windows: Server, wireguard: ShieldCheck,
  jellyfin: Tv, joplin: NotebookPen, immich: Image, patchmon: HeartPulse, checkmk: Gauge,
  adguard: ShieldCheck, lokaleki: Bot, iventoy: Network, jdownloader: Download, lyrion: Music,
  backup: Database, certificate: ShieldCheck, monitoring: Gauge, notes: NotebookPen, pxe: Network,
  container: Boxes, vm: Server, storage: HardDrive, ai: Bot, github: Globe2,
  sun: Sun, 'cloud-sun': CloudSun, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const Component = icons[name.toLowerCase()] ?? Server
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" />
}

export { ExternalLink }
