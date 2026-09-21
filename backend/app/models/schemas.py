from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Memory(BaseModel):
    used: int = 0
    total: int = 0


class Resource(BaseModel):
    vmid: int | None = None
    name: str
    type: Literal["node", "lxc", "qemu", "storage", "unknown"] = "unknown"
    node: str = ""
    status: str = "unknown"
    cpu: float = 0.0
    memory: Memory = Field(default_factory=Memory)
    disk: Memory = Field(default_factory=Memory)
    uptime: int = 0
    icon: str = "server"
    url: str | None = None
    description: str = ""
    favorite: bool = False
    reachable: bool | None = None


class Service(BaseModel):
    id: str
    name: str
    description: str = ""
    icon: str = "server"
    url: str
    favorite: bool = False
    reachable: bool | None = None
    status_code: int | None = None


class Link(BaseModel):
    name: str
    description: str = ""
    icon: str = "link"
    url: str


class DashboardEvent(BaseModel):
    id: str
    timestamp: datetime
    level: Literal["info", "success", "warning", "error"] = "info"
    title: str
    detail: str = ""
