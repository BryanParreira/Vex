"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { TopBar } from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/useWebSocket";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, ArrowRight, RefreshCw, Activity, Shield, Globe } from "lucide-react";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const PROTO_COLORS: Record<string, string> = {
  "TLS/HTTPS":  "#8b5cf6",
  "DNS":        "#22d3ee",
  "SSH":        "#f59e0b",
  "HTTP":       "#60a5fa",
  "HTTP-ALT":   "#34d399",
  "SMTP":       "#f97316",
  "MySQL":      "#e879f9",
  "PostgreSQL": "#818cf8",
  "Redis":      "#fb7185",
  "FTP":        "#a3e635",
  "UNKNOWN":    "#6b7280",
};

const STATE_META: Record<string, { dot: string; label: string }> = {
  ESTABLISHED: { dot: "bg-emerald-500", label: "Active" },
  CLOSE_WAIT:  { dot: "bg-yellow-500",  label: "Closing" },
  SYN_SENT:    { dot: "bg-blue-400",    label: "Connecting" },
};

const RISK_META: Record<string, { label: string; color: string }> = {
  c2_comms:    { label: "C2 Comms",    color: "text-red-400   bg-red-500/10   border-red-500/20" },
  brute_force: { label: "Brute Force", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
};

function parseLocal(local: string): { ip: string; port: string } {
  const parts = local.rsplit ? local.rsplit(".", 1) : local.split(".");
  const port = parts[parts.length - 1];
  const ip   = parts.slice(0, -1).join(".");
  return { ip, port };
}

// Can't use Python's rsplit in JS — reimplement
function splitLocal(local: string) {
  const idx = local.lastIndexOf(".");
  if (idx === -1) return { ip: local, port: "" };
  return { ip: local.slice(0, idx), port: local.slice(idx + 1) };
}

function duration(startedAt: string): string {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60)   return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}

function RiskBadge({ risk }: { risk: string }) {
  const meta = RISK_META[risk] ?? { label: risk, color: "text-muted-foreground bg-muted border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold", meta.color)}>
      <AlertTriangle className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

function ProtoChip({ proto }: { proto: string }) {
  const color = PROTO_COLORS[proto] ?? "#6b7280";
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold font-mono"
      style={{ background: color + "22", color, border: `1px solid ${color}44` }}>
      {proto}
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  const meta = STATE_META[state] ?? { dot: "bg-muted-foreground", label: state };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot,
        state === "ESTABLISHED" && "animate-pulse")} />
      <span className="text-[10px] text-muted-foreground">{meta.label}</span>
    </span>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">{payload[0].value} connection{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

export default function FlowsPage() {
  const [protoFilter, setProtoFilter] = useState("all");
  const [riskOnly, setRiskOnly]       = useState(false);
  const [newIds, setNewIds]           = useState<Set<string>>(new Set());
  const prevIds = useRef<Set<string>>(new Set());
  const [tick, setTick]               = useState(0);

  const { data, mutate, isLoading } = useSWR("/flows", fetcher, { refreshInterval: 5_000 });

  // Tick every second for live duration display
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { connected } = useWebSocket("/ws/flows", useCallback(() => { mutate(); }, [mutate]));

  const allFlows: any[] = data?.flows ?? [];
  const protoBreakdown: any[] = data?.proto_breakdown ?? [];

  // Detect newly appeared flows
  useEffect(() => {
    const curr = new Set(allFlows.map((f: any) => f.id));
    const fresh = new Set<string>();
    curr.forEach(id => { if (!prevIds.current.has(id)) fresh.add(id as string); });
    if (fresh.size) {
      setNewIds(fresh);
      setTimeout(() => setNewIds(new Set()), 2000);
    }
    prevIds.current = curr;
  }, [allFlows]);

  const filtered = allFlows.filter((f) => {
    if (riskOnly && !f.risk) return false;
    if (protoFilter !== "all" && f.protocol !== protoFilter) return false;
    return true;
  });

  const pieData = protoBreakdown.map((p: any) => ({ name: p.protocol, value: p.count }));
  const totalFlows  = data?.total ?? 0;
  const totalExt    = data?.external ?? 0;
  const riskFlows   = allFlows.filter((f) => f.risk).length;
  const protos = ["all", ...Array.from(new Set(allFlows.map((f: any) => f.protocol as string)))];

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <TopBar
        title="Network Flows"
        subtitle={`${totalFlows} connections · ${totalExt} external`}
        live={connected}
        actions={
          <button onClick={() => { api.post("/flows/refresh"); setTimeout(() => mutate(), 400); }}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-5">

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Total Connections", value: String(totalFlows),  icon: Activity, color: "text-brand-400",  iconColor: "#8b5cf6" },
            { label: "External",          value: String(totalExt),    icon: Globe,    color: "text-cyan-400",   iconColor: "#22d3ee" },
            { label: "Suspicious",        value: String(riskFlows),   icon: Shield,   color: riskFlows > 0 ? "text-red-400" : "text-emerald-400", iconColor: riskFlows > 0 ? "#ef4444" : "#10b981" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: s.iconColor + "18", border: `1px solid ${s.iconColor}33` }}>
                  <Icon className="h-5 w-5" style={{ color: s.iconColor }} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                  <p className={cn("text-2xl font-bold font-mono", s.color)}>{s.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pie + Filters */}
        <div className="grid gap-4 lg:grid-cols-3">

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Protocol Mix</p>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={65} paddingAngle={2}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={PROTO_COLORS[entry.name] ?? "#6b7280"} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1.5">
                  {pieData.slice(0, 6).map((e) => (
                    <div key={e.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: PROTO_COLORS[e.name] ?? "#6b7280" }} />
                        <span className="text-muted-foreground">{e.name}</span>
                      </span>
                      <span className="font-mono text-foreground tabular-nums">{e.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[150px] items-center justify-center text-xs text-muted-foreground">No data</div>
            )}
          </div>

          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Filters</p>

            <div className="flex flex-wrap gap-2">
              {protos.map((p) => (
                <button key={p} onClick={() => setProtoFilter(p)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors border",
                    protoFilter === p
                      ? "border-brand-500/40 bg-brand-500/10 text-brand-400"
                      : "border-border bg-muted text-muted-foreground hover:bg-accent"
                  )}>
                  {p === "all" ? "All protocols" : p}
                </button>
              ))}
            </div>

            <button onClick={() => setRiskOnly(!riskOnly)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                riskOnly
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-border bg-muted text-muted-foreground hover:bg-accent"
              )}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Suspicious only
              {riskFlows > 0 && (
                <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {riskFlows}
                </span>
              )}
            </button>

            <p className="text-xs text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {totalFlows} connections
              {connected && (
                <span className="ml-2 inline-flex items-center gap-1 text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  live
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Active Connections</p>
          </div>

          {isLoading ? (
            <div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 border-b border-border/50 px-5 py-3">
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-5 w-20 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <p className="text-sm text-muted-foreground">No connections match the current filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Source", "", "Destination", "Protocol", "State", "Duration", "Country", "Risk"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((f) => {
                    const { ip: srcIp, port: srcPort } = splitLocal(f.local);
                    const isNew = newIds.has(f.id);
                    return (
                      <tr key={f.id}
                        className={cn(
                          "transition-all duration-500",
                          f.risk ? "bg-red-500/[0.03] hover:bg-red-500/[0.06]" : "hover:bg-accent/20",
                          isNew && "bg-emerald-500/10"
                        )}>
                        <td className="px-4 py-2.5 font-mono text-foreground whitespace-nowrap">
                          {srcIp}<span className="text-muted-foreground/60">:{srcPort}</span>
                        </td>
                        <td className="px-1 text-muted-foreground/40">
                          <ArrowRight className="h-3 w-3" />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-foreground whitespace-nowrap">
                          {f.remote_ip}<span className="text-muted-foreground/60">:{f.remote_port}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <ProtoChip proto={f.protocol} />
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <StateBadge state={f.state} />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground whitespace-nowrap tabular-nums">
                          {duration(f.started_at)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {f.flag
                            ? <span title={f.country ?? ""}>{f.flag}</span>
                            : <span className="text-muted-foreground/30">—</span>
                          }
                        </td>
                        <td className="px-4 py-2.5">
                          {f.risk ? <RiskBadge risk={f.risk} /> : <span className="text-muted-foreground/30">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
