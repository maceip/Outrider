"use client";

import {Card} from "@heroui/react";
import {BarChart} from "@heroui-pro/react/bar-chart";
import {useMemo} from "react";

import {useCoreStore} from "../lib/core-store";

import {filterAnalyticsTraffics} from "./analytics-kpi-row";
import {extractTrafficHost, useEffectiveNowMs} from "./kpi-row";

export type HostDatum = {
  host: string;
  requests: number;
};

function formatThousands(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`;
}

function formatHostTick(host: string): string {
  return host.length > 18 ? `${host.slice(0, 17)}…` : host;
}

export function TopChannelsCard() {
  const {timeRange, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const rangeTraffics = useMemo(
    () => filterAnalyticsTraffics(traffics, timeRange, nowMs),
    [traffics, timeRange, nowMs],
  );

  const topHosts = useMemo<HostDatum[]>(() => {
    const counts = new Map<string, number>();

    for (const item of rangeTraffics) {
      const host = extractTrafficHost(item.uri);

      if (host) {
        counts.set(host, (counts.get(host) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([host, requests]) => ({host, requests}))
      .sort((a, b) => b.requests - a.requests || a.host.localeCompare(b.host))
      .slice(0, 6);
  }, [rangeTraffics]);

  return (
    <Card className="h-full">
      <Card.Header>
        <Card.Title className="min-w-0 truncate text-base">Top Hosts</Card.Title>
      </Card.Header>
      <Card.Content className="relative">
        <BarChart className="font-mono tabular-nums" data={topHosts} height={360} layout="vertical">
          <BarChart.Grid horizontal={false} />
          <BarChart.XAxis
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
            tickFormatter={formatThousands}
            tickMargin={4}
            type="number"
          />
          <BarChart.YAxis
            dataKey="host"
            tickFormatter={formatHostTick}
            tickMargin={6}
            type="category"
            width={140}
          />
          <BarChart.Bar
            barSize={16}
            dataKey="requests"
            fill="var(--chart-3)"
            name="Requests"
            radius={[0, 4, 4, 0]}
          />
          <BarChart.Tooltip content={<BarChart.TooltipContent />} />
        </BarChart>
        {topHosts.length === 0 ? (
          <div className="text-muted pointer-events-none absolute inset-0 flex items-center justify-center text-xs">
            No hosts observed in this range
          </div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
