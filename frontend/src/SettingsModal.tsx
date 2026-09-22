import { Fragment, useEffect, useState } from 'react'
import { Database, Download, ExternalLink, GitBranch, HardDrive, Link2, LockKeyhole, Palette, Pencil, Plus, RotateCcw, Server, Trash2, Type, Upload, X } from 'lucide-react'
import { addSetting, changeSettingsPin, deleteSetting, installUpdate, loadAuthStatus, loadBranding, loadInfrastructure, loadSettings, loadUpdateStatus, saveInfrastructure, unlockSettings, updateBranding, updateSetting, updateTheme, uploadCustomLogo } from './api'
import type { BrandingSettings, EditableItem, InfrastructureConfig, ManagedItem, SettingsItems, ThemeName, UpdateStatus } from './types'

type Kind = 'applications' | 'links'
type Editor = { kind: Kind; mode: 'add' | 'edit'; item: EditableItem }

const emptyItems: SettingsItems = { applications: [], links: [] }
const emptyInfrastructure: InfrastructureConfig = {
  proxmox_host: '', proxmox_user: '', proxmox_token_name: '', proxmox_token_configured: false,
  proxmox_verify_ssl: true, storage_source: 'proxmox', storage_ids: [], pbs_host: '', pbs_user: '',
  pbs_token_name: '', pbs_token_configured: false, pbs_datastore: '', pbs_verify_ssl: true,
}
const defaultBranding: BrandingSettings = {
  dashboard_title: 'HomeLab Dashboard', dashboard_subtitle: 'Meine Infrastruktur. Meine Freiheit.',
  footer_title: 'HomeLab Dashboard', footer_text: 'Dein Dashboard. Deine Konfiguration.',
  browser_title: 'HomeLab Dashboard',
}
const blank = (kind: Kind): EditableItem => ({
  name: '', description: '', icon: kind === 'applications' ? 'server' : 'link', url: '', favorite: false,
})
const iconOptions = [
  'server', 'link', 'proxmox', 'pbs', 'jellyfin', 'adguard', 'lokaleki', 'jdownloader', 'joplin',
  'certbot', 'patchmon', 'checkmk', 'lyrion', 'immich', 'iventoy', 'cloudflare',
  'outlook', 'icloud', 'youtube', 'prime-video', 'twitch', 'instagram', 'whatsapp', 'x', 'paypal', 'github',
]

const themes: { id: ThemeName; name: string; color: string; swatch?: string }[] = [
  { id: 'multicolor', name: 'Bunt', color: 'Alle Farben', swatch: 'var(--brand-gradient)' },
  { id: 'blue', name: 'Blau', color: '#007BFF' },
  { id: 'green', name: 'Grün', color: '#28A745' },
  { id: 'yellow', name: 'Gelb', color: '#F4C001' },
  { id: 'red', name: 'Rot', color: '#DC3545' },
  { id: 'black', name: 'Schwarz', color: '#000000' },
  { id: 'purple', name: 'Lila / Violett', color: '#7B2CBF' },
  { id: 'cyan', name: 'Türkis / Cyan', color: '#00B8D4' },
  { id: 'orange', name: 'Orange', color: '#FF8C00' },
  { id: 'pink', name: 'Rosa / Pink', color: '#E83E8C' },
]

const activeUpdateStatuses = new Set<UpdateStatus['installation']['status']>(['queued', 'running', 'rollback'])

export function SettingsModal({ theme, updateStatus, onThemeChanged, onUpdateActivityChange, onClose, onChanged }: { theme: ThemeName; updateStatus: UpdateStatus | null; onThemeChanged: (theme: ThemeName) => void; onUpdateActivityChange: (active: boolean) => void; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [items, setItems] = useState<SettingsItems>(emptyItems)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [themeBusy, setThemeBusy] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [installation, setInstallation] = useState<UpdateStatus['installation'] | null>(updateStatus?.installation ?? null)
  const [authenticated, setAuthenticated] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinChangeBusy, setPinChangeBusy] = useState(false)
  const [pinChangeMessage, setPinChangeMessage] = useState('')
  const [infrastructureConfig, setInfrastructureConfig] = useState<InfrastructureConfig>(emptyInfrastructure)
  const [storageIds, setStorageIds] = useState('')
  const [proxmoxSecret, setProxmoxSecret] = useState('')
  const [pbsSecret, setPbsSecret] = useState('')
  const [infrastructureBusy, setInfrastructureBusy] = useState(false)
  const [infrastructureMessage, setInfrastructureMessage] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoMessage, setLogoMessage] = useState('')
  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding)
  const [brandingBusy, setBrandingBusy] = useState(false)
  const [brandingMessage, setBrandingMessage] = useState('')
  const updateActive = Boolean(installation && activeUpdateStatuses.has(installation.status))

  const reload = async () => {
    try {
      const [nextItems, infrastructure, nextBranding] = await Promise.all([loadSettings(), loadInfrastructure(), loadBranding()])
      setItems(nextItems)
      setInfrastructureConfig(infrastructure.config)
      setStorageIds(infrastructure.config.storage_ids.join(', '))
      setBranding(nextBranding)
      setError('')
    }
    catch { setError('Die Einstellungen konnten nicht geladen werden.') }
  }
  useEffect(() => {
    void loadAuthStatus().then(status => {
      setAuthenticated(status.authenticated)
      if (status.authenticated) void reload()
      if (!status.configured) setPinError('Für diese Installation wurde noch kein Einstellungen-PIN eingerichtet.')
    }).catch(() => setPinError('Der PIN-Status konnte nicht geladen werden.')).finally(() => setAuthChecking(false))
    void loadUpdateStatus().then(status => setInstallation(status.installation)).catch(() => undefined)
  }, [])
  useEffect(() => { if (updateStatus?.installation) setInstallation(updateStatus.installation) }, [updateStatus])
  useEffect(() => {
    onUpdateActivityChange(updateActive)
  }, [onUpdateActivityChange, updateActive])
  useEffect(() => {
    if (!updateActive) return
    let disposed = false
    const poll = async () => {
      try {
        const current = await loadUpdateStatus()
        if (disposed) return
        setInstallation(current.installation)
        setUpdateMessage(current.installation.message)
        if (current.installation.status === 'success') {
          window.setTimeout(() => window.location.reload(), 1_500)
        }
      } catch { /* The backend can be briefly unavailable during its restart. */ }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [updateActive])
  const selectTheme = async (nextTheme: ThemeName) => {
    if (nextTheme === theme || themeBusy) return
    const previousTheme = theme
    onThemeChanged(nextTheme)
    setThemeBusy(true); setError('')
    try { await updateTheme(nextTheme) }
    catch { onThemeChanged(previousTheme); setError('Das Farbschema konnte nicht gespeichert werden.') }
    finally { setThemeBusy(false) }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editor) return
    setBusy(true); setError('')
    try {
      if (editor.mode === 'add') await addSetting(editor.kind === 'applications' ? 'hosts' : 'links', editor.item)
      else await updateSetting(editor.kind, editor.item)
      await reload(); await onChanged(); setEditor(null)
    } catch { setError('Der Eintrag konnte nicht gespeichert werden. Bitte URL und Felder prüfen.') }
    finally { setBusy(false) }
  }

  const uploadLogo = async (file: File) => {
    if (!editor) return
    if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) {
      setLogoMessage('Bitte PNG, WebP oder JPEG auswählen.'); return
    }
    setLogoBusy(true); setLogoMessage('Logo wird geprüft und hochgeladen…')
    try {
      const uploaded = await uploadCustomLogo(file, editor.item.name || file.name.replace(/\.[^.]+$/, ''))
      setEditor(current => current ? { ...current, item: { ...current.item, icon: uploaded.icon } } : current)
      setLogoMessage('Logo hochgeladen und diesem Eintrag zugewiesen.')
    } catch (caught) {
      setLogoMessage(caught instanceof Error ? caught.message : 'Logo-Upload fehlgeschlagen.')
    } finally { setLogoBusy(false) }
  }

  const submitInfrastructure = async (event: React.FormEvent) => {
    event.preventDefault(); setInfrastructureBusy(true); setInfrastructureMessage('Verbindungen werden gespeichert und geprüft…')
    const configured = {
      ...infrastructureConfig,
      storage_ids: storageIds.split(',').map(value => value.trim()).filter(Boolean),
    }
    try {
      const result = await saveInfrastructure(configured, proxmoxSecret, pbsSecret)
      setInfrastructureConfig(result.config); setStorageIds(result.config.storage_ids.join(', '))
      setProxmoxSecret(''); setPbsSecret('')
      const failures = [result.proxmox_error && `Proxmox: ${result.proxmox_error}`, result.pbs_error && `PBS: ${result.pbs_error}`].filter(Boolean)
      setInfrastructureMessage(failures.length ? `Gespeichert · ${failures.join(' · ')}` : 'Gespeichert · Infrastrukturstatus erfolgreich aktualisiert.')
      await onChanged()
    } catch (caught) {
      setInfrastructureMessage(caught instanceof Error ? caught.message : 'Infrastruktur-Konfiguration konnte nicht gespeichert werden.')
    } finally { setInfrastructureBusy(false) }
  }

  const submitBranding = async (event: React.FormEvent) => {
    event.preventDefault(); setBrandingBusy(true); setBrandingMessage('')
    try {
      const saved = await updateBranding(branding)
      setBranding(saved); setBrandingMessage('Texte wurden gespeichert.')
      await onChanged()
    } catch (caught) {
      setBrandingMessage(caught instanceof Error ? caught.message : 'Texte konnten nicht gespeichert werden.')
    } finally { setBrandingBusy(false) }
  }

  const remove = async (kind: Kind, item: ManagedItem) => {
    const action = item.source === 'builtin' ? 'aus dem Dashboard ausblenden' : 'löschen'
    if (!window.confirm(`„${item.name}“ wirklich ${action}?`)) return
    setBusy(true); setError('')
    try { await deleteSetting(kind, item.id); await reload(); await onChanged() }
    catch { setError('Der Eintrag konnte nicht entfernt werden.') }
    finally { setBusy(false) }
  }

  const restore = async (kind: Kind, item: ManagedItem) => {
    setBusy(true); setError('')
    try { await updateSetting(kind, item); await reload(); await onChanged() }
    catch { setError('Der Eintrag konnte nicht wiederhergestellt werden.') }
    finally { setBusy(false) }
  }

  const startUpdate = async () => {
    setUpdateMessage('Update wird vorbereitet…')
    setInstallation({ status: 'queued', message: 'Update-Dienst wird gestartet', progress: 2, target_version: updateStatus?.latest_version ?? null, updated_at: null })
    try {
      const request = await installUpdate()
      setUpdateMessage(`Version ${request.target_version} wird installiert. Das Dashboard startet anschließend neu…`)
    } catch (caught) {
      const message = caught instanceof Error && caught.message ? caught.message : 'Das Update konnte nicht gestartet werden.'
      setUpdateMessage(message)
      setInstallation({ status: 'failed', message, progress: 100, target_version: updateStatus?.latest_version ?? null, updated_at: new Date().toISOString() })
    }
  }

  const shownInstallation = installation ?? updateStatus?.installation
  const showProgress = Boolean(updateActive || shownInstallation?.status === 'failed')

  const submitPin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!/^\d{4}$/.test(pin)) { setPinError('Bitte genau vier Ziffern eingeben.'); return }
    setPinBusy(true); setPinError('')
    try {
      await unlockSettings(pin)
      setAuthenticated(true); setPin(''); await reload()
    } catch (caught) {
      setPinError(caught instanceof Error ? caught.message : 'PIN-Prüfung fehlgeschlagen')
    } finally { setPinBusy(false) }
  }

  const submitPinChange = async (event: React.FormEvent) => {
    event.preventDefault(); setPinChangeMessage('')
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) { setPinChangeMessage('Aktueller und neuer PIN müssen genau vier Ziffern enthalten.'); return }
    if (newPin !== confirmPin) { setPinChangeMessage('Die neuen PINs stimmen nicht überein.'); return }
    setPinChangeBusy(true)
    try {
      await changeSettingsPin(currentPin, newPin)
      setPinChangeMessage('PIN wird geändert. Anschließend bitte neu anmelden…')
      setCurrentPin(''); setNewPin(''); setConfirmPin('')
      window.setTimeout(() => window.location.reload(), 1_800)
    } catch (caught) {
      setPinChangeMessage(caught instanceof Error ? caught.message : 'PIN konnte nicht geändert werden')
    } finally { setPinChangeBusy(false) }
  }

  if (authChecking || !authenticated) return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="settings-modal pin-modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <header><div><h2 id="pin-title">Einstellungen entsperren</h2><p>Der vierstellige Installations-PIN schützt Änderungen im lokalen Netzwerk.</p></div><button className="close" onClick={onClose} title="Schließen"><X /></button></header>
      {authChecking ? <p className="pin-checking">PIN-Schutz wird geprüft…</p> : <form className="pin-form" onSubmit={event => void submitPin(event)}>
        <span><LockKeyhole /></span>
        <label>Dashboard-PIN<input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></label>
        <button className="primary" disabled={pinBusy || pin.length !== 4}>{pinBusy ? 'Prüfe…' : 'Entsperren'}</button>
        {pinError && <p className="settings-error">{pinError}</p>}
      </form>}
    </div>
  </div>

  const editorForm = () => editor && <form className="settings-form inline-editor" onSubmit={event => void submit(event)}>
    <h3>{editor.mode === 'edit' ? 'Eintrag bearbeiten' : 'Neuen Eintrag anlegen'}</h3>
    <div className="form-grid">
      <label>Name<input autoFocus required maxLength={80} value={editor.item.name} onChange={event => setEditor({ ...editor, item: { ...editor.item, name: event.target.value } })} /></label>
      <label>Icon<select value={editor.item.icon} onChange={event => setEditor({ ...editor, item: { ...editor.item, icon: event.target.value } })}>{!iconOptions.includes(editor.item.icon) && <option value={editor.item.icon}>{editor.item.icon}</option>}{iconOptions.map(icon => <option key={icon}>{icon}</option>)}</select></label>
      <label className="wide">Beschreibung<input maxLength={180} value={editor.item.description} onChange={event => setEditor({ ...editor, item: { ...editor.item, description: event.target.value } })} /></label>
      <label className="wide">URL<input required={editor.kind === 'links' || editor.mode === 'add'} type="url" placeholder="https://service.example.com" value={editor.item.url} onChange={event => setEditor({ ...editor, item: { ...editor.item, url: event.target.value } })} /></label>
      <label className="wide logo-upload"><span><Upload />Eigenes Logo <small>PNG, WebP oder JPEG · max. 3 MB · wird updatefest gespeichert</small></span><input type="file" accept="image/png,image/webp,image/jpeg" disabled={logoBusy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = '' }} />{logoMessage && <em>{logoMessage}</em>}</label>
      {editor.kind === 'applications' && <label className="checkbox"><input type="checkbox" checked={Boolean(editor.item.favorite)} onChange={event => setEditor({ ...editor, item: { ...editor.item, favorite: event.target.checked } })} />Als Favorit markieren</label>}
    </div>
    <div className="form-actions"><button type="button" onClick={() => setEditor(null)}>Abbrechen</button><button className="primary" disabled={busy}>{busy ? 'Speichert…' : 'Speichern'}</button></div>
  </form>

  const section = (kind: Kind, title: string) => <section className="settings-section">
    <div className="settings-section-head"><h3>{kind === 'applications' ? <Server /> : <Link2 />}{title}</h3><button onClick={() => setEditor({ kind, mode: 'add', item: blank(kind) })}><Plus />{kind === 'applications' ? 'Host' : 'Link'} hinzufügen</button></div>
    {editor?.kind === kind && editor.mode === 'add' && editorForm()}
    {items[kind].length === 0 ? <p className="settings-empty">Noch keine Einträge.</p> : <div className="settings-list">
      {items[kind].map(item => <Fragment key={item.id}>
        <article className={item.hidden ? 'hidden-item' : ''}>
          <div><strong>{item.name}{item.hidden ? ' · ausgeblendet' : ''}</strong><small>{item.description || item.url || 'Keine Beschreibung'}</small></div>
          {item.hidden ? <button title="Wiederherstellen" onClick={() => void restore(kind, item)}><RotateCcw /></button> : <button title="Bearbeiten" onClick={() => setEditor({ kind, mode: 'edit', item: { ...item } })}><Pencil /></button>}
          {!item.hidden && <button className="danger" title={item.source === 'builtin' ? 'Aus Dashboard ausblenden' : 'Löschen'} onClick={() => void remove(kind, item)}><Trash2 /></button>}
        </article>
        {editor?.kind === kind && editor.mode === 'edit' && editor.item.id === item.id && editorForm()}
      </Fragment>)}
    </div>}
  </section>

  return <div className={`modal-backdrop ${updateActive ? 'update-active' : ''}`} role="presentation" onMouseDown={event => { if (!updateActive && event.target === event.currentTarget) onClose() }}>
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><h2 id="settings-title">Dashboard-Einstellungen</h2><p>Anwendungen, Hosts und Schnelllinks verwalten – Proxmox-Systeme werden nur im Dashboard ausgeblendet.</p></div><button className="close" disabled={updateActive} onClick={onClose} title={updateActive ? 'Während des Updates gesperrt' : 'Schließen'}><X /></button></header>
      {error && <p className="settings-error">{error}</p>}
      <section className="settings-section security-settings">
        <div className="settings-section-head"><h3><LockKeyhole />Einstellungen-PIN</h3><span>Vierstelligen PIN sicher ändern</span></div>
        <form className="pin-change-form" onSubmit={event => void submitPinChange(event)}>
          <label>Aktueller PIN<input required inputMode="numeric" autoComplete="current-password" pattern="[0-9]{4}" maxLength={4} value={currentPin} onChange={event => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></label>
          <label>Neuer PIN<input required inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} value={newPin} onChange={event => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></label>
          <label>Neuen PIN bestätigen<input required inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} value={confirmPin} onChange={event => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></label>
          <button className="primary" disabled={pinChangeBusy}>{pinChangeBusy ? 'Ändert…' : 'PIN ändern'}</button>
          {pinChangeMessage && <p>{pinChangeMessage}</p>}
        </form>
      </section>
      <section className="settings-section infrastructure-settings">
        <div className="settings-section-head"><h3><HardDrive />Infrastruktur</h3><span>Cluster, Speicher und Backupserver</span></div>
        <form className="infrastructure-form" onSubmit={event => void submitInfrastructure(event)}>
          <fieldset>
            <legend><Server />Proxmox-Cluster</legend>
            <div className="form-grid infra-grid">
              <label className="wide">API-Adresse<input type="url" placeholder="https://proxmox.example.com:8006" value={infrastructureConfig.proxmox_host} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, proxmox_host: event.target.value })} /></label>
              <label>API-Benutzer<input placeholder="dashboard@pve" value={infrastructureConfig.proxmox_user} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, proxmox_user: event.target.value })} /></label>
              <label>Token-ID<input placeholder="homelab" value={infrastructureConfig.proxmox_token_name} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, proxmox_token_name: event.target.value })} /></label>
              <label className="wide">Token-Geheimnis<input type="password" autoComplete="new-password" placeholder={infrastructureConfig.proxmox_token_configured ? 'Gespeichert · leer lassen zum Beibehalten' : 'Token-Geheimnis'} value={proxmoxSecret} onChange={event => setProxmoxSecret(event.target.value)} /></label>
              <label className="checkbox wide"><input type="checkbox" checked={infrastructureConfig.proxmox_verify_ssl} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, proxmox_verify_ssl: event.target.checked })} />TLS-Zertifikat des Proxmox-Hosts prüfen</label>
            </div>
          </fieldset>
          <fieldset>
            <legend><Database />Speicheranzeige</legend>
            <div className="form-grid infra-grid">
              <label>Quelle<select value={infrastructureConfig.storage_source} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, storage_source: event.target.value as 'proxmox' | 'pbs' })}><option value="proxmox">Proxmox-Cluster</option><option value="pbs">PBS-Datastore</option></select></label>
              <label>Proxmox-Speicher-IDs<input placeholder="local-lvm, qnap-nas" value={storageIds} onChange={event => setStorageIds(event.target.value)} /></label>
              <p className="infra-hint wide">Leer zeigt alle verfügbaren Proxmox-Speicher. Bei Quelle „PBS“ wird der unten angegebene Datastore verwendet.</p>
            </div>
          </fieldset>
          <fieldset>
            <legend><Database />Proxmox Backup Server</legend>
            <div className="form-grid infra-grid">
              <label className="wide">API-Adresse<input type="url" placeholder="https://pbs.example.com:8007" value={infrastructureConfig.pbs_host} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, pbs_host: event.target.value })} /></label>
              <label>API-Benutzer<input placeholder="dashboard@pbs" value={infrastructureConfig.pbs_user} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, pbs_user: event.target.value })} /></label>
              <label>Token-ID<input placeholder="homelab" value={infrastructureConfig.pbs_token_name} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, pbs_token_name: event.target.value })} /></label>
              <label>Datastore<input placeholder="backup" value={infrastructureConfig.pbs_datastore} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, pbs_datastore: event.target.value })} /></label>
              <label>Token-Geheimnis<input type="password" autoComplete="new-password" placeholder={infrastructureConfig.pbs_token_configured ? 'Gespeichert · leer lassen zum Beibehalten' : 'Token-Geheimnis'} value={pbsSecret} onChange={event => setPbsSecret(event.target.value)} /></label>
              <label className="checkbox wide"><input type="checkbox" checked={infrastructureConfig.pbs_verify_ssl} onChange={event => setInfrastructureConfig({ ...infrastructureConfig, pbs_verify_ssl: event.target.checked })} />TLS-Zertifikat des PBS prüfen</label>
            </div>
          </fieldset>
          <div className="infrastructure-actions"><span>{infrastructureMessage}</span><button className="primary" disabled={infrastructureBusy}>{infrastructureBusy ? 'Prüft…' : 'Speichern & Verbindung prüfen'}</button></div>
        </form>
      </section>
      <section className="settings-section branding-settings">
        <div className="settings-section-head"><h3><Type />Texte &amp; Branding</h3><span>Kopfzeile, Footer und Browser-Tab</span></div>
        <form className="branding-form form-grid" onSubmit={event => void submitBranding(event)}>
          <label>Dashboard-Titel<input required maxLength={80} value={branding.dashboard_title} onChange={event => setBranding({ ...branding, dashboard_title: event.target.value })} /></label>
          <label>Browser-Tab-Titel<input required maxLength={80} value={branding.browser_title} onChange={event => setBranding({ ...branding, browser_title: event.target.value })} /></label>
          <label className="wide">Beschreibung unter dem Dashboard-Titel<input maxLength={160} value={branding.dashboard_subtitle} onChange={event => setBranding({ ...branding, dashboard_subtitle: event.target.value })} /></label>
          <label>Footer-Titel<input required maxLength={80} value={branding.footer_title} onChange={event => setBranding({ ...branding, footer_title: event.target.value })} /></label>
          <label>Footer-Text<input maxLength={160} value={branding.footer_text} onChange={event => setBranding({ ...branding, footer_text: event.target.value })} /></label>
          <div className="branding-actions wide"><span>{brandingMessage}</span><button className="primary" disabled={brandingBusy}>{brandingBusy ? 'Speichert…' : 'Texte speichern'}</button></div>
        </form>
      </section>
      <section className="settings-section theme-settings">
        <div className="settings-section-head"><h3><Palette />Farbschema</h3><span>Design und Aufbau bleiben unverändert</span></div>
        <div className="theme-grid">
          {themes.map(option => <button key={option.id} type="button" className={theme === option.id ? 'theme-option active' : 'theme-option'} aria-pressed={theme === option.id} disabled={themeBusy} onClick={() => void selectTheme(option.id)}>
            <i style={{ background: option.swatch || option.color }} /><span><strong>{option.name}</strong><small>{option.color}</small></span>
          </button>)}
        </div>
      </section>
      <section className="settings-section update-settings">
        <div className="settings-section-head"><h3><GitBranch />Dashboard-Update</h3><span>Automatische Prüfung alle 15 Minuten</span></div>
        <div className={updateStatus?.update_available ? 'update-panel available' : 'update-panel'}>
          <div><strong>{updateStatus?.error ? 'Versionsprüfung nicht verfügbar' : updateStatus?.update_available ? `Version ${updateStatus.latest_version} verfügbar` : 'Dashboard ist aktuell'}</strong><small>{updateMessage || (updateStatus ? `Installierte Version: ${updateStatus.current_version}` : 'Versionsstatus wird geladen…')}</small></div>
          <div className="update-actions">
            <button className="primary" type="button" disabled={!updateStatus?.update_available || updateActive} onClick={() => void startUpdate()}><Download />{updateActive ? 'Update läuft…' : updateStatus?.update_available ? 'Jetzt aktualisieren' : 'Kein Update verfügbar'}</button>
            <a href={updateStatus?.repository_url || 'https://github.com/DoctorX-1337/Homelab-Dashboard-LXC'} target="_blank" rel="noreferrer" title="GitHub-Repository öffnen"><ExternalLink /></a>
          </div>
          {showProgress && shownInstallation && <div className={`update-progress ${shownInstallation.status}`} role="progressbar" aria-label="Update-Fortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={shownInstallation.progress}>
            <div><span>{shownInstallation.message}</span><strong>{shownInstallation.progress}%</strong></div>
            <i><em style={{ width: `${shownInstallation.progress}%` }} /></i>
          </div>}
        </div>
      </section>
      {section('applications', 'Anwendungen & Dienste')}
      {section('links', 'Nützliche Links')}
    </div>
  </div>
}
