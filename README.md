# Netindavoid

A personal network security monitoring platform — dark Splunk-style interface for your local network. Runs entirely on your Mac with no cloud dependencies, no login required.

---

## What it does

**Dashboard** — Live overview: active devices, open connections, bandwidth, and recent security events.

**Devices** — Auto-discovered LAN devices with MAC address, hostname, vendor, IP, and connection history. 30 devices tracked.

**Traffic** — Real-time bandwidth monitoring. Timeseries chart of bytes in/out, sampled every 60 seconds from `netstat -ibn`. Delta computed between samples.

**Network Flows** — All active TCP connections (via `netstat -anp tcp`). 200 connections shown, external IPs highlighted, protocol classified by port. Cached 30s in Redis.

**DNS Monitor** — Domains resolved from active connections via reverse DNS. Tracks query history, top domains, unique domain count. Collected from live netstat connections.

**Uptime Monitor** — Pings all known LAN devices every 5 minutes. Live status (up/down), latency in ms, 90-minute heartbeat history per device stored in Redis.

**Logs** — Splunk-style log search. Full-text filter, severity filter, sourcetype filter, time range. Live tail via WebSocket (Redis pubsub). 2000+ events indexed from system logs.

**Nmap Scanner** — Real nmap port scans with profiles: Quick, Full, Stealth, OS Detect, Vuln Scan. Live terminal output streamed via WebSocket. Results parsed into host/port table with OS fingerprint.

**Packet Capture** — Wireshark-style live capture using Scapy. BPF filter input, protocol color-coding (TLS/HTTP/DNS/SSH/ICMP/ARP), per-packet detail panel. Requires root/`CAP_NET_RAW`.

**WiFi** — Wireless interface info and nearby access points.

**Alerts** — Security event alerts with severity (critical / high / medium / low / info) and category.

**AI Assistant** — Chat interface with network context. Supports:
- **Ollama** — local models (llama3, mistral, etc.) — configure URL + fetch models
- **LM Studio** — local OpenAI-compatible server — configure URL + fetch models
- **OpenAI** — GPT-4o, GPT-4o-mini via API key
- **Anthropic** — Claude Haiku / Sonnet via API key
- **Custom** — any OpenAI-compatible endpoint + key

**Vuln Scan** — CVE vulnerability scanning against discovered devices.

**Audit Log** — Timestamped record of all scan and config actions.

**Settings** — Network CIDR config, AI provider link, app version + commit info.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, Tailwind CSS, SWR, Recharts |
| Backend | FastAPI (Python 3.11), SQLAlchemy, asyncpg |
| Database | PostgreSQL 16 (Homebrew) |
| Cache / Pubsub | Redis (Homebrew, single connection, fanout via asyncio.Queue) |
| Real-time | WebSockets — nmap, packet capture, log tail, alerts |
| Network tools | nmap, Scapy, netstat, ping (macOS native) |
| Desktop | Electron 33 — spawns API + Next.js, loading screen, system tray |

---

## Requirements

- macOS (Apple Silicon)
- Node.js 20 (via nvm)
- Python 3.11
- PostgreSQL 16 (`brew install postgresql@16`)
- Redis (`brew install redis`)
- nmap (`brew install nmap`)

---

## Setup

```bash
# Start DB + cache
brew services start postgresql@16
brew services start redis

# Backend
cd apps/api
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head

# Frontend
cd apps/web
npm install --legacy-peer-deps

# Run
bash scripts/start.sh
# → API on http://localhost:8000
# → App on http://localhost:3000
```

No login needed — single-user mode.

---

## Desktop app (DMG)

```bash
cd apps/electron
npm install
npm run build          # builds, signs, notarizes, publishes to GitHub releases
# or
npm run build:local    # build only, no publish
```

Output: `apps/electron/dist/Netindavoid-1.0.0-arm64.dmg`

Drag to `/Applications`. The app starts the API + frontend automatically and opens the dashboard in its own window with a system tray icon.

---

## Auto-update

**App binary** — `electron-updater` checks GitHub releases every 4 hours. Downloads in background, prompts to restart.

**Code (API + frontend)** — A LaunchAgent polls GitHub every 5 minutes:

```bash
bash scripts/install-updater.sh
```

Any `git push` to `main` automatically triggers pull + rebuild + service restart.

---

## Publish a new release

```bash
# Tag and push → triggers auto-update on all running installs
git add -A && git commit -m "your changes"
git tag v1.0.1
git push origin main --tags

# Rebuild DMG + publish to GitHub releases
cd apps/electron && npm run build
```

---

## Project structure

```
netindavoid/
├── apps/
│   ├── api/              FastAPI backend
│   │   ├── routers/      devices, traffic, dns, flows, uptime, logs,
│   │   │                 ai, scans, alerts, nmap_scanner, capture,
│   │   │                 websocket, audit, vulnscan, wifi
│   │   ├── models/       SQLAlchemy ORM models
│   │   └── core/         DB, Redis, config, deps (no-auth mode)
│   ├── web/              Next.js 14 frontend
│   │   └── app/          dashboard, logs, scanner, capture, ai,
│   │                     flows, uptime, dns, traffic, settings...
│   └── electron/         Desktop wrapper
│       ├── main.js       Spawns API + Next.js, BrowserWindow, tray
│       └── build/        icon.icns, entitlements
└── scripts/              start, stop, update, LaunchAgent installers
```
