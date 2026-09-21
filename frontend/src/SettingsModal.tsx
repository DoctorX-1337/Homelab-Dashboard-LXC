import { Fragment, useEffect, useState } from 'react'
import { Download, ExternalLink, GitBranch, Link2, Palette, Pencil, Plus, RotateCcw, Server, Trash2, X } from 'lucide-react'
import { addSetting, deleteSetting, installUpdate, loadSettings, loadUpdateStatus, updateSetting, updateTheme } from './api'
import type { EditableItem, ManagedItem, SettingsItems, ThemeName, UpdateStatus } from './types'

type Kind = 'applications' | 'links'
type Editor = { kind: Kind; mode: 'add' | 'edit'; item: EditableItem }

const emptyItems: SettingsItems = { applications: [], links: [] }
const blank = (kind: Kind): EditableItem => ({
  name: '', description: '', icon: kind === 'applications' ? 'server' : 'link', url: '', favorite: false,
})
const iconOptions = [
  'server', 'link', 'proxmox', 'pbs', 'jellyfin', 'adguard', 'lokaleki', 'jdownloader', 'joplin',
  'certbot', 'patchmon', 'checkmk', 'lyrion', 'immich', 'iventoy', 'cloudflare',
  'outlook', 'icloud', 'youtube', 'prime-video', 'twitch', 'instagram', 'whatsapp', 'x', 'paypal',
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

export function SettingsModal({ theme, updateStatus, onThemeChanged, onClose, onChanged }: { theme: ThemeName; updateStatus: UpdateStatus | null; onThemeChanged: (theme: ThemeName) => void; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [items, setItems] = useState<SettingsItems>(emptyItems)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [themeBusy, setThemeBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [installation, setInstallation] = useState<UpdateStatus['installation'] | null>(updateStatus?.installation ?? null)

  const reload = async () => {
    try { setItems(await loadSettings()); setError('') }
    catch { setError('Die Einstellungen konnten nicht geladen werden.') }
  }
  useEffect(() => {
    void reload()
    void loadUpdateStatus().then(status => setInstallation(status.installation)).catch(() => undefined)
  }, [])
  useEffect(() => { if (updateStatus?.installation) setInstallation(updateStatus.installation) }, [updateStatus])

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
    setUpdateBusy(true); setUpdateMessage('Update wird vorbereitet…')
    setInstallation({ status: 'queued', message: 'Update-Dienst wird gestartet', progress: 2, target_version: updateStatus?.latest_version ?? null, updated_at: null })
    try {
      const request = await installUpdate()
      setUpdateMessage(`Version ${request.target_version} wird installiert. Das Dashboard startet anschließend neu…`)
      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 1_000))
        try {
          const current = await loadUpdateStatus()
          setInstallation(current.installation)
          setUpdateMessage(current.installation.message)
          if (current.installation.status === 'failed') {
            setUpdateMessage(current.installation.message || 'Update fehlgeschlagen; Details stehen im Systemprotokoll.')
            return
          }
          if (current.current_version === request.target_version && current.installation.status === 'success') {
            await new Promise(resolve => window.setTimeout(resolve, 900))
            window.location.reload()
            return
          }
        } catch { /* The backend is temporarily unavailable while it restarts. */ }
      }
      setUpdateMessage('Das Update läuft länger als erwartet. Bitte die Seite in einigen Minuten neu laden.')
    } catch {
      setUpdateMessage('Das Update konnte nicht gestartet werden. Bitte den Versionsstatus erneut prüfen.')
    } finally {
      setUpdateBusy(false)
    }
  }

  const shownInstallation = installation ?? updateStatus?.installation
  const showProgress = Boolean(updateBusy || (shownInstallation && shownInstallation.status !== 'idle' && shownInstallation.progress > 0))

  const editorForm = () => editor && <form className="settings-form inline-editor" onSubmit={event => void submit(event)}>
    <h3>{editor.mode === 'edit' ? 'Eintrag bearbeiten' : 'Neuen Eintrag anlegen'}</h3>
    <div className="form-grid">
      <label>Name<input autoFocus required maxLength={80} value={editor.item.name} onChange={event => setEditor({ ...editor, item: { ...editor.item, name: event.target.value } })} /></label>
      <label>Icon<select value={editor.item.icon} onChange={event => setEditor({ ...editor, item: { ...editor.item, icon: event.target.value } })}>{iconOptions.map(icon => <option key={icon}>{icon}</option>)}</select></label>
      <label className="wide">Beschreibung<input maxLength={180} value={editor.item.description} onChange={event => setEditor({ ...editor, item: { ...editor.item, description: event.target.value } })} /></label>
      <label className="wide">URL<input required={editor.kind === 'links' || editor.mode === 'add'} type="url" placeholder="https://service.example.com" value={editor.item.url} onChange={event => setEditor({ ...editor, item: { ...editor.item, url: event.target.value } })} /></label>
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

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><h2 id="settings-title">Dashboard-Einstellungen</h2><p>Anwendungen, Hosts und Schnelllinks verwalten – Proxmox-Systeme werden nur im Dashboard ausgeblendet.</p></div><button className="close" onClick={onClose} title="Schließen"><X /></button></header>
      {error && <p className="settings-error">{error}</p>}
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
            <button className="primary" type="button" disabled={!updateStatus?.update_available || updateBusy} onClick={() => void startUpdate()}><Download />{updateBusy ? 'Update läuft…' : updateStatus?.update_available ? 'Jetzt aktualisieren' : 'Kein Update verfügbar'}</button>
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
