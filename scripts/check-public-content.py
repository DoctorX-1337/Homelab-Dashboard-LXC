from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SELF = Path(__file__).resolve()
TEXT_SUFFIXES = {
    "", ".css", ".env", ".example", ".html", ".js", ".json", ".md", ".py",
    ".service", ".sh", ".ts", ".tsx", ".yaml", ".yml",
}
CHECKS = {
    "RFC1918-Adresse": re.compile(
        r"(?<!\d)(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?!\d)"
    ),
    "privater DNS-Suffix": re.compile(r"(?i)(?:https?://|\b)[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:lan|local)(?=[:/\s]|$)"),
    "UNC-Freigabe": re.compile(r"\\\\[A-Za-z0-9_.-]+\\"),
}


def tracked_files() -> list[Path]:
    output = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        text=False,
    )
    return [ROOT / raw.decode("utf-8") for raw in output.split(b"\0") if raw]


def main() -> int:
    findings: list[str] = []
    for path in tracked_files():
        if path.resolve() == SELF or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            for label, pattern in CHECKS.items():
                if pattern.search(line):
                    findings.append(f"{path.relative_to(ROOT)}:{line_number}: {label}")
    if findings:
        print("Private Infrastrukturangaben gefunden:")
        print("\n".join(findings))
        return 1
    print("Öffentlicher Inhaltscheck bestanden.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
