"use client";

import type {DashboardPeriod, DashboardTab, TrafficHead} from "../lib/types";

import {KPI} from "@heroui-pro/react/kpi";
import {useEffect, useMemo, useState} from "react";

import {useCoreStore} from "../lib/core-store";

export type TrafficProtocol = "HTTP" | "HTTPS" | "MCP" | "WebSocket";

export type DashboardTimeBucket = {
  bucket: string;
  bytes: number;
  http: number;
  mcp: number;
  requests: number;
};

export const DASHBOARD_PERIOD_MS: Record<DashboardPeriod, number> = {
  daily: 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};

export function parseTrafficUrl(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    if (uri.startsWith("/")) {
      try {
        return new URL(uri, "http://localhost");
      } catch {
        return null;
      }
    }
    if (!uri.includes("://") && uri.includes(":")) {
      try {
        return new URL(`https://${uri}`);
      } catch {
        return null;
      }
    }

    return null;
  }
}

export function isMcpTraffic(t: TrafficHead): boolean {
  const parsed = parseTrafficUrl(t.uri);

  if (!parsed) {
    const clean = t.uri.split("?")[0]?.split("#")[0] ?? "";

    return clean === "/mcp" || clean === "/mcp/";
  }

  return parsed.pathname === "/mcp" || parsed.pathname === "/mcp/";
}

export function extractTrafficHost(uri: string): string | null {
  if (uri.startsWith("/")) return null;
  const parsed = parseTrafficUrl(uri);

  return parsed?.host ? parsed.host : null;
}

export function getTrafficProtocol(t: TrafficHead): TrafficProtocol {
  if (isMcpTraffic(t)) return "MCP";
  if (typeof t.websocket_id === "number" || /^wss?:/i.test(t.uri)) return "WebSocket";
  if (/^https:/i.test(t.uri) || t.method.toUpperCase() === "CONNECT") return "HTTPS";

  return "HTTP";
}

export function formatBucketTimestamp(ms: number, spanMs: number): string {
  const date = new Date(ms);

  if (spanMs <= 15 * 60 * 1000) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (spanMs <= 48 * 60 * 60 * 1000) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
    });
  }
  if (spanMs <= 10 * 24 * 60 * 60 * 1000) {
    return date.toLocaleString("en-US", {
      day: "numeric",
      hour: "numeric",
      month: "short",
    });
  }
  if (spanMs <= 400 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    });
  }

  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export function useEffectiveNowMs(
  traffics: readonly TrafficHead[],
  intervalMs = 5_000,
): number | null {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const initTimer = setTimeout(update, 0);
    const interval = setInterval(update, intervalMs);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [intervalMs]);

  return useMemo(() => {
    let latestMs = 0;

    for (const item of traffics) {
      if (typeof item.start_time_unix_ms === "number" && item.start_time_unix_ms > latestMs) {
        latestMs = item.start_time_unix_ms;
      }
    }

    if (nowMs === null) {
      return latestMs > 0 ? latestMs : null;
    }

    return Math.max(nowMs, latestMs);
  }, [nowMs, traffics]);
}

export function filterDashboardTraffics(
  traffics: readonly TrafficHead[],
  period: DashboardPeriod,
  tab: DashboardTab,
  nowMs: number | null,
): TrafficHead[] {
  if (nowMs === null) return [];
  const cutoffMs = nowMs - DASHBOARD_PERIOD_MS[period];

  return traffics.filter((t) => {
    if (typeof t.start_time_unix_ms !== "number" || t.start_time_unix_ms < cutoffMs) {
      return false;
    }
    if (tab === "traffic") return !isMcpTraffic(t);
    if (tab === "mcp") return isMcpTraffic(t);

    return true;
  });
}

export function buildDashboardBuckets(
  filteredTraffics: readonly TrafficHead[],
  period: DashboardPeriod,
  nowMs: number | null,
): DashboardTimeBucket[] {
  if (nowMs === null) return [];
  const spanMs = DASHBOARD_PERIOD_MS[period];
  const startMs = nowMs - spanMs;
  const stepMs = spanMs / 12;

  const buckets: DashboardTimeBucket[] = Array.from({length: 12}, (_, index) => ({
    bucket: formatBucketTimestamp(Math.round(startMs + (index + 1) * stepMs), spanMs),
    bytes: 0,
    http: 0,
    mcp: 0,
    requests: 0,
  }));

  for (const item of filteredTraffics) {
    const ts = item.start_time_unix_ms;

    if (typeof ts !== "number" || ts < startMs) continue;
    const rawIdx = Math.floor(((ts - startMs) / spanMs) * 12);
    const idx = Math.min(11, Math.max(0, rawIdx));
    const slot = buckets[idx];

    slot.requests += 1;
    slot.bytes += item.size ?? 0;
    if (isMcpTraffic(item)) {
      slot.mcp += 1;
    } else {
      slot.http += 1;
    }
  }

  return buckets;
}

export function KpiRow() {
  const {dashboardPeriod, dashboardTab, snapshot, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const stats = useMemo(() => {
    const filtered = filterDashboardTraffics(traffics, dashboardPeriod, dashboardTab, nowMs);
    const mcpCalls = filtered.filter(isMcpTraffic).length;
    const sessions = snapshot?.agent_sessions?.length ?? 0;
    const errors = filtered.filter((t) => t.status !== null && t.status >= 400).length;

    return [
      {label: "Requests", value: filtered.length},
      {label: "MCP Calls", value: mcpCalls},
      {label: "Sessions", value: sessions},
      {label: "Errors", value: errors},
    ];
  }, [dashboardPeriod, dashboardTab, nowMs, snapshot, traffics]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <KPI key={stat.label}>
          <KPI.Header>
            <KPI.Title className="min-w-0 truncate">{stat.label}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value
              className="font-mono tabular-nums"
              maximumFractionDigits={0}
              style="decimal"
              value={stat.value}
            />
          </KPI.Content>
        </KPI>
      ))}
    </div>
  );
}
