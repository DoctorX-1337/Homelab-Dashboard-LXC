from __future__ import annotations

ICON_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("proxmox", "pve"), "proxmox"),
    (("jellyfin",), "jellyfin"),
    (("jdownloader",), "jdownloader"),
    (("backup", "pbs"), "backup"),
    (("certbot", "letsencrypt"), "certificate"),
    (("nginx", "proxyverwaltung"), "nginx"),
    (("wireguard",), "wireguard"),
    (("patchmon",), "patchmon"),
    (("checkmk",), "monitoring"),
    (("lyrion", "lyric", "squeezebox", "music"), "music"),
    (("immich",), "immich"),
    (("adguard",), "shield"),
    (("joplin",), "notes"),
    (("iventoy", "ventoy"), "pxe"),
    (("qnap", "nas"), "qnap"),
    (("github", "git"), "github"),
    (("cloudflare",), "cloud"),
    (("home assistant", "homeassistant"), "home"),
    (("portainer", "docker"), "container"),
    (("debian",), "debian"),
    (("ubuntu",), "ubuntu"),
    (("windows", "homedc"), "windows"),
    (("lokaleki", "ollama", "open-webui"), "ai"),
    (("startseite", "homelab"), "dashboard"),
)


def icon_for(name: str, resource_type: str = "unknown") -> str:
    normalized = name.casefold().replace("-", " ").replace("_", " ")
    for terms, icon in ICON_RULES:
        if any(term in normalized for term in terms):
            return icon
    return {"lxc": "container", "qemu": "vm", "node": "server", "storage": "storage"}.get(
        resource_type, "server"
    )
