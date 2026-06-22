"""Network information & syslog ingestion endpoints."""
import asyncio
import json
import socketserver
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.deps import get_current_user, get_db
from models.user import User
from services.network import network_info, get_subnet_cidr

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/info")
async def get_network_info(user: User = Depends(get_current_user)):
    """Return current interface, IP, subnet, gateway, DNS servers."""
    return network_info()


@router.get("/subnet")
async def get_subnet(user: User = Depends(get_current_user)):
    """Quick endpoint — just the CIDR used for scanning."""
    return {"cidr": get_subnet_cidr()}


# ── Syslog UDP receiver ───────────────────────────────────────────────────────
# Listens on UDP 5140 (not 514 — no root needed).
# Routers, switches, APs can send syslog here.
# Point your device at: udp://<this-mac-ip>:5140

_syslog_server: socketserver.UDPServer | None = None
_syslog_thread: threading.Thread | None = None
_syslog_tenant_id: str | None = None


class _SyslogHandler(socketserver.BaseRequestHandler):
    def handle(self):
        global _syslog_tenant_id
        raw = self.request[0]
        try:
            msg = raw.decode("utf-8", errors="replace").strip()
        except Exception:
            return
        if not msg or not _syslog_tenant_id:
            return

        # Fire-and-forget into the event loop
        try:
            loop = asyncio.get_event_loop()
            asyncio.run_coroutine_threadsafe(
                _ingest_syslog(msg, self.client_address[0], _syslog_tenant_id),
                loop,
            )
        except Exception:
            pass


async def _ingest_syslog(msg: str, src_ip: str, tenant_id: str):
    from core.database import AsyncSessionLocal
    from routers.logs import _ingest_one
    from core.redis import get_redis

    redis = get_redis()
    async with AsyncSessionLocal() as db:
        await _ingest_one(
            db, tenant_id, msg,
            index_name="syslog",
            source=f"syslog:{src_ip}",
            sourcetype="syslog",
            host=src_ip,
            redis=redis,
        )
        await db.commit()


def start_syslog_receiver(tenant_id: str, port: int = 5140):
    """Start UDP syslog listener in a background thread."""
    global _syslog_server, _syslog_thread, _syslog_tenant_id

    if _syslog_server:
        return  # already running

    _syslog_tenant_id = tenant_id
    try:
        _syslog_server = socketserver.UDPServer(("0.0.0.0", port), _SyslogHandler)
        _syslog_thread = threading.Thread(target=_syslog_server.serve_forever, daemon=True)
        _syslog_thread.start()
    except Exception as e:
        import structlog
        structlog.get_logger().warning("syslog receiver failed to start", port=port, error=str(e))


def stop_syslog_receiver():
    global _syslog_server
    if _syslog_server:
        _syslog_server.shutdown()
        _syslog_server = None


@router.get("/syslog/status")
async def syslog_status(user: User = Depends(get_current_user)):
    from services.network import get_local_ip
    return {
        "running": _syslog_server is not None,
        "port": 5140,
        "target": f"udp://{get_local_ip()}:5140",
        "instructions": "Point your router/switch/AP syslog to this address.",
    }
