"use client";
import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { StatCard } from "@/components/ui/StatCard";
import { BandwidthChart } from "@/components/charts/BandwidthChart";
import { AlertsDonut } from "@/components/charts/AlertsDonut";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { DeviceIcon } from "@/components/ui/DeviceIcon";
import { formatMbps, formatBytes, timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  MonitorCheck, ArrowDownUp, ShieldAlert, Globe2,
  Download, CheckCircle2, XCircle, Activity,
} from "lucide-react";
import Link from "next/link";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const RANGES = [
  { label: "Live",   hours: 0   },
  { label: "24h",    hours: 24  },
  { label: "7 days", hours: 168 },
  { label: "30 days",hours: 720 },
];

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {action}
    </div>
  );
}

function exportCSV(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

export default function OverviewPage() {
  const [rangeIdx, setRangeIdx] = useState(0);
  const range  = RANGES[rangeIdx];
  const isLive = range.hours === 0;
  const hours  = isLive ? 24 : range.hours;

  // Data
  const { data: devices }    = useSWR("/devices?limit=200",              fetcher, { refreshInterval: 30_000 });
  const { data: traffic }    = useSWR(`/traffic/overview?hours=${hours}`,fetcher, { refreshInterval: isLive ? 15_000 : 60_000 });
  const { data: alerts }     = useSWR(`/alerts?hours=${hours}&limit=50`, fetcher, { refreshInterval: isLive ? 10_000 : 60_000 });
  const { data: alertStats } = useSWR(`/alerts/stats?hours=${hours}`,   fetcher, { refreshInterval: isLive ? 15_000 : 60_000 });
  const { data: dns }        = useSWR(`/dns/overview?hours=${hours}`,   fetcher, { refreshInterval: 30_000 });
  const { data: scans }      = useSWR("/scans?limit=8",                  fetcher, { refreshInterval: 120_000 });

  // Live WebSocket bandwidth (live mode only)
  const [liveMbps, setLiveMbps] = useState<{ in: number; out: number } | null>(null);
  const { connected } = useWebSocket("/ws/live-traffic", useCallback((d: unknown) => {
    const msg = d as { bytes_in?: number; bytes_out?: number };
    if (msg.bytes_in !== undefined)
      setLiveMbps({ in: (msg.bytes_in / 60) * 8 / 1e6, out: (msg.bytes_out ?? 0) / 60 * 8 / 1e6 });
  }, []));

  const mbpsIn  = (isLive && liveMbps) ? liveMbps.in  : traffic?.summary?.current_mbps_in  ?? 0;
  const mbpsOut = (isLive && liveMbps) ? liveMbps.out : traffic?.summary?.current_mbps_out ?? 0;
  const criticalCount  = (alertStats?.critical ?? 0) + (alertStats?.high ?? 0);
  const totalAlerts    = alertStats ? Object.values(alertStats as Record<string, number>).reduce((a, b) => a + b, 0) : 0;
  const onlineDevices  = devices?.online ?? 0;
  const alertList: any[] = Array.isArray(alerts) ? alerts : [];

  const handleExportAlerts = () => {
    if (!alertList.length) return;
    exportCSV(`vex-alerts-${new Date().toISOString().slice(0,10)}.csv`, [
      ["ID", "Title", "Severity", "Category", "Status", "Source", "Triggered At"],
      ...alertList.map((a: any) => [a.id, a.title, a.severity, a.category, a.status, a.source, a.triggered_at]),
    ]);
  };

  const handleExportDevices = () => {
    if (!devices?.items?.length) return;
    exportCSV(`vex-devices-${new Date().toISOString().slice(0,10)}.csv`, [
      ["IP", "MAC", "Hostname", "Vendor", "Category", "Status", "First Seen", "Last Seen"],
      ...devices.items.map((d: any) => [d.ip_address, d.mac_address, d.hostname, d.vendor, d.category, d.status, d.first_seen_at, d.last_seen_at]),
    ]);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Overview"
        live={isLive && connected}
        actions={
          <div className="flex items-center gap-2">
            {/* Time range */}
            <div className="flex items-center rounded-lg border border-border bg-muted p-0.5">
              {RANGES.map((r, i) => (
                <button key={r.label} onClick={() => setRangeIdx(i)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    rangeIdx === i
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}>
                  {r.label}
                </button>
              ))}
            </div>
            {/* CSV exports */}
            {!isLive && (
              <>
                <button onClick={handleExportAlerts}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Download className="h-3 w-3" /> Alerts
                </button>
                <button onClick={handleExportDevices}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Download className="h-3 w-3" /> Devices
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-6">

        {/* ── Stat cards ─────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Devices Online"
            value={devices ? onlineDevices : "—"}
            sub={devices ? `${devices.total} total · ${devices.new_today ?? 0} new today` : "Loading…"}
            icon={MonitorCheck}
            accent="brand"
          />
          <StatCard
            title={isLive ? "Bandwidth Now" : "Peak Download"}
            value={formatMbps(isLive ? mbpsIn : (traffic?.summary?.peak_mbps_in ?? 0))}
            sub={isLive
              ? `↑ ${formatMbps(mbpsOut)} upload`
              : `Total: ${formatBytes(traffic?.summary?.total_bytes_in ?? 0)}`}
            icon={ArrowDownUp}
            accent="blue"
          />
          <StatCard
            title="Open Alerts"
            value={totalAlerts || "0"}
            sub={criticalCount > 0 ? `${criticalCount} critical / high` : `last ${range.label}`}
            icon={ShieldAlert}
            accent={criticalCount > 0 ? "red" : "green"}
          />
          <StatCard
            title="DNS Queries"
            value={dns?.total?.toLocaleString() ?? "—"}
            sub={dns ? `${dns.block_rate ?? 0}% blocked · ${dns.malicious ?? 0} malicious` : "Loading…"}
            icon={Globe2}
            accent="violet"
          />
        </div>

        {/* ── Bandwidth + Alert breakdown ─────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">

          <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Network Bandwidth
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {range.label === "Live" ? "Last 24 hours" : range.label}
                </p>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" />Download</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" />Upload</span>
              </div>
            </div>
            {traffic?.timeseries?.length > 0
              ? <BandwidthChart data={traffic.timeseries} height={200} />
              : <Skeleton className="h-[200px] w-full" />
            }
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Alert Breakdown</p>
            <p className="mb-2 text-[10px] text-muted-foreground">{range.label === "Live" ? "Last 24 hours" : range.label}</p>
            <AlertsDonut data={alertStats ?? {}} />
            <div className="mt-3 space-y-1.5">
              {Object.entries(alertStats ?? {}).map(([sev, count]) => (
                <div key={sev} className="flex items-center justify-between text-xs">
                  <SeverityBadge severity={sev} />
                  <span className="font-mono tabular-nums text-muted-foreground">{count as number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Recent alerts + Top talkers ─────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">

          <div className="rounded-xl border border-border bg-card overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Recent Alerts</p>
              <Link href="/threats" className="text-xs text-brand-500 hover:underline dark:text-brand-400">View all →</Link>
            </div>
            {alertList.length ? (
              <div className="divide-y divide-border/60">
                {alertList.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex items-start gap-3 px-5 py-3 hover:bg-accent/30 transition-colors">
                    <SeverityBadge severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{a.title}</p>
                      {a.ai_explanation && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{a.ai_explanation}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-muted-foreground">{timeAgo(a.triggered_at)}</p>
                      <span className={cn("text-[9px] font-semibold uppercase",
                        a.status === "open" ? "text-orange-400" :
                        a.status === "resolved" ? "text-emerald-400" : "text-yellow-400"
                      )}>{a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-36 flex-col items-center justify-center gap-2">
                <ShieldAlert className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground">No alerts in this period</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Top Bandwidth Users</p>
            </div>
            <div className="space-y-4 p-5">
              {(traffic?.top_talkers as any[] | undefined)?.length ? (
                (traffic!.top_talkers as any[]).map((t: any) => (
                  <div key={t.device_id} className="text-xs">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">{t.device_name}</span>
                      <span className="shrink-0 font-mono text-muted-foreground">{t.percentage}%</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${t.percentage}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-muted-foreground">
                      <span>↓ {formatBytes(t.bytes_in)}</span>
                      <span>↑ {formatBytes(t.bytes_out)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </div>
          </div>
        </div>

        {/* ── Scan history (historical modes only) ────────────────────── */}
        {!isLive && (
          <div>
            <SectionHeader title="Recent Scans" />
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="divide-y divide-border/50">
                {Array.isArray(scans) && scans.length > 0 ? scans.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/20 transition-colors">
                    {s.status === "completed"
                      ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      : <XCircle      className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    }
                    <p className="flex-1 text-xs font-medium text-foreground capitalize">
                      {s.scan_type.replace("_", " ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.devices_found} devices · {s.new_devices} new
                    </p>
                    <p className="text-[10px] text-muted-foreground">{timeAgo(s.started_at)}</p>
                  </div>
                )) : (
                  <div className="flex h-16 items-center justify-center">
                    <p className="text-xs text-muted-foreground">No scans yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Online devices grid ─────────────────────────────────────── */}
        <div>
          <SectionHeader
            title={isLive ? "Online Devices" : "Device Inventory"}
            action={<Link href="/devices" className="text-xs text-brand-500 hover:underline dark:text-brand-400">View all →</Link>}
          />
          {devices?.items?.length ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(devices.items as any[])
                .filter((d: any) => isLive ? d.status === "online" : true)
                .slice(0, 16)
                .map((d: any) => (
                <div key={d.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-brand-500/30 transition-colors">
                  <DeviceIcon category={d.category} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {d.display_name || d.hostname || d.mac_address}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground">{d.ip_address}</p>
                  </div>
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
                    d.status === "online" ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          )}
          {devices?.total > 16 && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Showing 16 of {devices.total} ·{" "}
              <Link href="/devices" className="text-brand-400 hover:underline">see all</Link>
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
