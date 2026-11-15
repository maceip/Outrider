"use client";

import type {TimeRange, TrafficHead} from "../lib/types";

import {KPI} from "@heroui-pro/react/kpi";
import {useMemo} from "react";

import {useCoreStore} from "../lib/core-store";

import {extractTrafficHost, formatBucketTimestamp, useEffectiveNowMs} from "./kpi-row";

export type SparklinePoint = {value: number};

export type AnalyticsBucket = {
  avgLatencyMs: number;
  bucket: string;
  errorRatePct: number;
  errors: number;
  requests: number;
  uniqueHosts: number;
};

const TIME_RANGE_WINDOW_MS: Record<Exclude<TimeRange, "ALL">, number> = {
  "1H": 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
  "5M": 5 * 60 * 1000,
};

const ZERO_SPARKLINE: SparklinePoint[] = Array.from({length: 12}, () => ({value: 0}));

export function countUniqueHosts(items: readonly TrafficHead[]): number {
  const hosts = new Set<string>();

  for (const item of items) {
    const host = extractTrafficHost(item.uri);

    if (host) {
      hosts.add(host);
    }
  }

  return hosts.size;
}

export function computeAvgLatencyMs(items: readonly TrafficHead[]): number {
  let sum = 0;
  let count = 0;

  for (const item of items) {
    if (typeof item.time === "number") {
      sum += item.time;
      count += 1;
    }
  }

  return count === 0 ? 0 : Math.round(sum / count);
}

export function filterAnalyticsTraffics(
  traffics: readonly TrafficHead[],
  timeRange: TimeRange,
  nowMs: number | null,
): TrafficHead[] {
  if (timeRange === "ALL") {
    return [...traffics];
  }
  if (nowMs === null) {
    return [];
  }
  const cutoffMs = nowMs - TIME_RANGE_WINDOW_MS[timeRange];

  return traffics.filter(
    (item) => typeof item.start_time_unix_ms === "number" && item.start_time_unix_ms >= cutoffMs,
  );
}

export function buildAnalyticsBuckets(
  rangeTraffics: readonly TrafficHead[],
  timeRange: TimeRange,
  nowMs: number | null,
): AnalyticsBucket[] {
  if (nowMs === null) return [];

  let spanMs: number;
  let startMs: number;

  if (timeRange !== "ALL") {
    spanMs = TIME_RANGE_WINDOW_MS[timeRange];
    startMs = nowMs - spanMs;
  } else {
    let minTs = Number.POSITIVE_INFINITY;

    for (const item of rangeTraffics) {
      if (typeof item.start_time_unix_ms === "number" && item.start_time_unix_ms < minTs) {
        minTs = item.start_time_unix_ms;
      }
    }

    const minSpanMs = 5 * 60 * 1000;

    if (!Number.isFinite(minTs) || nowMs - minTs < minSpanMs) {
      spanMs = minSpanMs;
      startMs = nowMs - spanMs;
    } else {
      startMs = minTs;
      spanMs = nowMs - startMs;
    }
  }

  const stepMs = spanMs / 12;
  const grouped: TrafficHead[][] = Array.from({length: 12}, () => []);

  for (const item of rangeTraffics) {
    const ts = item.start_time_unix_ms;

    if (typeof ts !== "number" || ts < startMs) continue;
    const rawIdx = Math.floor(((ts - startMs) / spanMs) * 12);
    const idx = Math.min(11, Math.max(0, rawIdx));

    grouped[idx].push(item);
  }

  return grouped.map((items, index) => {
    const requests = items.length;
    const errors = items.filter((t) => t.status !== null && t.status >= 400).length;

    return {
      avgLatencyMs: computeAvgLatencyMs(items),
      bucket: formatBucketTimestamp(Math.round(startMs + (index + 1) * stepMs), spanMs),
      errorRatePct: requests === 0 ? 0 : (errors / requests) * 100,
      errors,
      requests,
      uniqueHosts: countUniqueHosts(items),
    };
  });
}

export function AnalyticsKpiRow() {
  const {timeRange, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const rangeTraffics = useMemo(
    () => filterAnalyticsTraffics(traffics, timeRange, nowMs),
    [traffics, timeRange, nowMs],
  );

  const buckets = useMemo(
    () => buildAnalyticsBuckets(rangeTraffics, timeRange, nowMs),
    [rangeTraffics, timeRange, nowMs],
  );

  const metrics = useMemo(() => {
    const events = rangeTraffics.length;
    const uniqueHosts = countUniqueHosts(rangeTraffics);
    const errors = rangeTraffics.filter((t) => t.status !== null && t.status >= 400).length;
    const errorRateRatio = events === 0 ? 0 : errors / events;
    const avgLatencyMs = computeAvgLatencyMs(rangeTraffics);

    const eventsSparkline =
      buckets.length === 12 ? buckets.map((b) => ({value: b.requests})) : ZERO_SPARKLINE;
    const hostsSparkline =
      buckets.length === 12 ? buckets.map((b) => ({value: b.uniqueHosts})) : ZERO_SPARKLINE;
    const errorSparkline =
      buckets.length === 12 ? buckets.map((b) => ({value: b.errorRatePct})) : ZERO_SPARKLINE;
    const latencySparkline =
      buckets.length === 12 ? buckets.map((b) => ({value: b.avgLatencyMs})) : ZERO_SPARKLINE;

    return {
      avgLatencyMs,
      errorRateRatio,
      errorSparkline,
      events,
      eventsSparkline,
      hostsSparkline,
      latencySparkline,
      uniqueHosts,
    };
  }, [buckets, rangeTraffics]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KPI>
        <KPI.Header>
          <KPI.Title className="min-w-0 truncate">Events</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="font-mono tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.events}
          />
        </KPI.Content>
        <KPI.Chart
          color="var(--chart-3)"
          data={metrics.eventsSparkline}
          height={60}
          strokeWidth={2}
        />
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title className="min-w-0 truncate">Unique Hosts</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="font-mono tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.uniqueHosts}
          />
        </KPI.Content>
        <KPI.Chart
          color="var(--chart-2)"
          data={metrics.hostsSparkline}
          height={60}
          strokeWidth={2}
        />
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title className="min-w-0 truncate">Error Rate</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="font-mono tabular-nums"
            maximumFractionDigits={1}
            style="percent"
            value={metrics.errorRateRatio}
          />
        </KPI.Content>
        <KPI.Chart
          color="var(--chart-1)"
          data={metrics.errorSparkline}
          height={60}
          strokeWidth={2}
        />
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title className="min-w-0 truncate">Avg. Latency</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <span className="text-foreground font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {metrics.avgLatencyMs} ms
          </span>
        </KPI.Content>
        <KPI.Chart
          color="var(--chart-2)"
          data={metrics.latencySparkline}
          height={60}
          strokeWidth={2}
        />
      </KPI>
    </div>
  );
}
