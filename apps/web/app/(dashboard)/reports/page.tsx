"use client";
import { useState, useCallback } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { BandwidthChart } from "@/components/charts/BandwidthChart";
import { formatBytes, formatMbps, timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Download, ShieldAlert, Wifi, Globe2, Activity,
  CheckCircle2, XCircle, Calendar, MonitorCheck,
} from "lucide-react";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e", info: "#6b7280",
};

function StatCard({ label, value, sub, color = "text-foreground", icon: Icon, iconColor }: any) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ background: iconColor + "18", border: `1px solid ${iconColor}33` }}>
        <Icon className="h-5 w-5" style={{ color: iconColor }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-bold font-mono truncate", color)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
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

export default function ReportsPage() {
  const [hours, setHours] = useState(168); // default 7 days

  const { data: traffic }    = useSWR(`/traffic/overview?hours=${hours}`, fetcher, { refreshInterval: 60_000 });
  const { data: alertStats } = useSWR(`/alerts/stats?hours=${hours}`,     fetcher, { refreshInterval: 60_000 });
  const { data: alerts }     = useSWR(`/alerts?limit=50&hours=${hours}`,  fetcher, { refreshInterval: 60_000 });
  const { data: devices }    = useSWR("/devices?limit=200",               fetcher, { refreshInterval: 120_000 });
  const { data: dns }        = useSWR(`/dns/overview?hours=${hours}`,     fetcher, { refreshInterval: 60_000 });
  const { data: scans }      = useSWR("/scans?limit=10",                  fetcher, { refreshInterval: 120_000 });

  const totalAlerts = alertStats ? Object.values(alertStats as Record<string, number>).reduce((a, b) => a + b, 0) : 0;
  const criticalHigh = (alertStats?.critical ?? 0) + (alertStats?.high ?? 0);
  const onlineDevices = devices?.items?.filter((d: any) => d.status === "online").length ?? 0;

  const handleExportAlerts = useCallback(() => {
    if (!Array.isArray(alerts) || !alerts.length) return;
    const rows = [
      ["ID", "Title", "Severity", "Category", "Status", "Source", "Triggered At"],
      ...alerts.map((a: any) => [a.id, a.title, a.severity, a.category, a.status, a.source, a.triggered_at]),
    ];
    exportCSV(`vex-alerts-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }, [alerts]);

  const handleExportDevices = useCallback(() => {
    if (!devices?.items?.length) return;
    const rows = [
      ["IP", "MAC", "Hostname", "Vendor", "Category", "Status", "First Seen", "Last Seen"],
      ...devices.items.map((d: any) => [d.ip_address, d.mac_address, d.hostname, d.vendor, d.category, d.status, d.first_seen_at, d.last_seen_at]),
    ];
    exportCSV(`vex-devices-${new Date().toISOString().slice(0,10)}.csv`, rows);
  }, [devices]);

  const RANGES = [
    { label: "24h",    hours: 24 },
    { label: "7 days", hours: 168 },
    { label: "30 days",hours: 720 },
  ];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Reports"
        subtitle="Network health summary and exports"
        actions={
          <div className="flex items-center gap-2">
            {RANGES.map(r => (
              <button key={r.hours} onClick={() => setHours(r.hours)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  hours === r.hours
                    ? "border-brand-500/40 bg-brand-500/10 text-brand-400"
                    : "border-border bg-muted text-muted-foreground hover:bg-accent"
                )}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-6">

        {/* Summary stats */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Devices Online"  value={`${onlineDevices} / ${devices?.total ?? "—"}`}
            icon={MonitorCheck} iconColor="#8b5cf6"
            sub={`${devices?.total ?? 0} total known`} />
          <StatCard label="Total Alerts"    value={totalAlerts || "0"}
            icon={ShieldAlert} iconColor={criticalHigh > 0 ? "#ef4444" : "#10b981"}
            color={criticalHigh > 0 ? "text-red-400" : "text-emerald-400"}
            sub={criticalHigh > 0 ? `${criticalHigh} critical/high` : "all clear"} />
          <StatCard label="Download"        value={formatMbps(traffic?.summary?.peak_mbps_in ?? 0)}
            icon={Activity} iconColor="#22d3ee"
            sub={`Total: ${formatBytes(traffic?.summary?.total_bytes_in ?? 0)}`} />
          <StatCard label="DNS Queries"     value={(dns?.total ?? 0).toLocaleString()}
            icon={Globe2} iconColor="#f59e0b"
            sub={`${dns?.malicious ?? 0} malicious · ${dns?.block_rate ?? 0}% blocked`} />
        </div>

        {/* Bandwidth + Alert breakdown */}
        <div className="grid gap-4 lg:grid-cols-3">

          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Bandwidth — {RANGES.find(r => r.hours === hours)?.label}
              </p>
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" />Download</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" />Upload</span>
              </div>
            </div>
            {traffic?.timeseries?.length > 0
              ? <BandwidthChart data={traffic.timeseries} height={180} />
              : <div className="flex h-[180px] items-center justify-center text-xs text-muted-foreground">No traffic data yet — collecting…</div>
            }
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Alert Severity Breakdown</p>
            {totalAlerts > 0 ? (
              <div className="space-y-3">
                {Object.entries(alertStats ?? {}).map(([sev, count]) => {
                  const pct = Math.round(((count as number) / totalAlerts) * 100);
                  const color = SEV_COLOR[sev] ?? "#6b7280";
                  return (
                    <div key={sev}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <SeverityBadge severity={sev} />
                        <span className="font-mono text-muted-foreground tabular-nums">{count as number}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center">
                <div className="text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/40 mb-2" />
                  <p className="text-xs text-muted-foreground">No alerts in this period</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Alerts table + Scan history */}
        <div className="grid gap-4 lg:grid-cols-3">

          {/* Recent alerts */}
          <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Alerts — {RANGES.find(r => r.hours === hours)?.label}
              </p>
              <button onClick={handleExportAlerts}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <Download className="h-3 w-3" /> Export CSV
              </button>
            </div>
            {Array.isArray(alerts) && alerts.length > 0 ? (
              <div className="divide-y divide-border/50">
                {alerts.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex items-start gap-3 px-5 py-3 hover:bg-accent/20 transition-colors">
                    <SeverityBadge severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{a.title}</p>
                      <p className="text-[10px] text-muted-foreground">{a.category?.replace("_", " ")} · {a.source}</p>
                    </div>
                    <div className="text-right shrink-0">
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
              <div className="flex h-32 items-center justify-center">
                <p className="text-xs text-muted-foreground">No alerts in this period</p>
              </div>
            )}
          </div>

          {/* Scan history */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Recent Scans</p>
            </div>
            <div className="divide-y divide-border/50">
              {Array.isArray(scans) && scans.length > 0 ? scans.map((s: any) => (
                <div key={s.id} className="px-5 py-3 hover:bg-accent/20 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {s.status === "completed"
                        ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                        : <XCircle      className="h-3 w-3 shrink-0 text-red-500" />
                      }
                      <p className="text-[10px] font-medium text-foreground capitalize">{s.scan_type.replace("_", " ")}</p>
                    </div>
                    <span className="text-[9px] text-muted-foreground">{timeAgo(s.started_at)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground pl-4.5">
                    {s.devices_found} devices · {s.new_devices} new
                  </p>
                </div>
              )) : (
                <div className="flex h-24 items-center justify-center">
                  <p className="text-xs text-muted-foreground">No scans yet</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Device export */}
        <Section title="Device Inventory" action={
          <button onClick={handleExportDevices}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Download className="h-3 w-3" /> Export CSV
          </button>
        }>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Status", "IP", "Hostname / Name", "Vendor", "Category", "Last Seen"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {devices?.items?.slice(0, 12).map((d: any) => (
                    <tr key={d.id} className="hover:bg-accent/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className={cn("h-1.5 w-1.5 inline-block rounded-full mr-1.5",
                          d.status === "online" ? "bg-emerald-500" : "bg-muted-foreground")} />
                        <span className={cn("text-[10px]", d.status === "online" ? "text-emerald-400" : "text-muted-foreground")}>
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-foreground">{d.ip_address}</td>
                      <td className="px-4 py-2.5 text-foreground truncate max-w-[160px]">{d.display_name || d.hostname || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[120px]">{d.vendor || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground capitalize">{d.category || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{timeAgo(d.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(devices?.total ?? 0) > 12 && (
              <div className="border-t border-border px-5 py-2.5 text-[10px] text-muted-foreground">
                Showing 12 of {devices.total} devices — export CSV for full list
              </div>
            )}
          </div>
        </Section>

      </div>
    </div>
  );
}
