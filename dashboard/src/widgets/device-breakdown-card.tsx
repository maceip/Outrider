"use client";

import type {TrafficProtocol} from "./kpi-row";
import type {ReactNode} from "react";

import {Card} from "@heroui/react";
import {ChartTooltip} from "@heroui-pro/react";
import {PieChart} from "@heroui-pro/react/pie-chart";
import {useMemo} from "react";

import {useCoreStore} from "../lib/core-store";

import {filterAnalyticsTraffics} from "./analytics-kpi-row";
import {getTrafficProtocol, useEffectiveNowMs} from "./kpi-row";

type ProtocolDatum = {
  color: string;
  name: TrafficProtocol;
  value: number;
};

const PROTOCOL_ORDER: readonly {color: string; name: TrafficProtocol}[] = [
  {color: "var(--chart-3)", name: "HTTP"},
  {color: "var(--chart-2)", name: "HTTPS"},
  {color: "var(--chart-4)", name: "MCP"},
  {color: "var(--chart-1)", name: "WebSocket"},
];

function formatCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString();
}

interface ProtocolTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    payload?: {color?: string; fill?: string};
    value?: number | string;
  }>;
}

function ProtocolTooltip({active, payload}: ProtocolTooltipProps) {
  const entry = payload?.[0];

  if (!active || !entry) return null;

  return (
    <ChartTooltip>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={entry.payload?.color ?? entry.payload?.fill} />
        <ChartTooltip.Label>{entry.name}</ChartTooltip.Label>
        <ChartTooltip.Value>{formatCount(Number(entry.value ?? 0))}</ChartTooltip.Value>
      </ChartTooltip.Item>
    </ChartTooltip>
  );
}

export function DeviceBreakdownCard() {
  const {timeRange, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const rangeTraffics = useMemo(
    () => filterAnalyticsTraffics(traffics, timeRange, nowMs),
    [traffics, timeRange, nowMs],
  );

  const breakdown = useMemo<ProtocolDatum[]>(() => {
    const counts: Record<TrafficProtocol, number> = {
      HTTP: 0,
      HTTPS: 0,
      MCP: 0,
      WebSocket: 0,
    };

    for (const item of rangeTraffics) {
      counts[getTrafficProtocol(item)] += 1;
    }

    return PROTOCOL_ORDER.map((entry) => ({
      color: entry.color,
      name: entry.name,
      value: counts[entry.name],
    }));
  }, [rangeTraffics]);

  const activeSlices = useMemo(
    () => breakdown.filter((entry) => entry.value > 0),
    [breakdown],
  );

  const total = rangeTraffics.length;
  const formattedTotal = formatCount(total);

  return (
    <Card className="h-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base">Traffic by protocol</Card.Title>
        <Card.Description>Observed requests by transport protocol.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="relative flex size-[240px] items-center justify-center">
          {total === 0 ? (
            <div
              aria-hidden="true"
              className="border-surface-secondary pointer-events-none absolute inset-[22px] rounded-full border-[26px]"
            />
          ) : null}
          <PieChart height={240} width={240}>
            <PieChart.Pie
              cornerRadius={activeSlices.length > 1 ? 8 : 0}
              cx="50%"
              cy="50%"
              data={activeSlices}
              dataKey="value"
              innerRadius="68%"
              nameKey="name"
              paddingAngle={activeSlices.length > 1 ? 2 : 0}
              strokeWidth={0}
            >
              {activeSlices.map((entry) => (
                <PieChart.Cell key={entry.name} fill={entry.color} />
              ))}
            </PieChart.Pie>
            {total > 0 ? <PieChart.Tooltip content={<ProtocolTooltip />} /> : null}
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-foreground text-2xl font-semibold tabular-nums">
              {formattedTotal}
            </span>
            <span className="text-muted text-xs">Events</span>
          </div>
        </div>
        <ProtocolLegend breakdown={breakdown} total={total} />
      </Card.Content>
    </Card>
  );
}

function ProtocolLegend({
  breakdown,
  total,
}: {
  breakdown: readonly ProtocolDatum[];
  total: number;
}): ReactNode {
  return (
    <div className="flex w-full max-w-[240px] flex-col gap-2">
      {breakdown.map((entry) => {
        const pct = total > 0 ? ((entry.value / total) * 100).toFixed(0) : "0";

        return (
          <div key={entry.name} className="flex items-center gap-3">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{backgroundColor: entry.color}}
            />
            <span className="text-foreground flex-1 text-sm">{entry.name}</span>
            <span className="text-foreground text-sm font-semibold tabular-nums">
              {formatCount(entry.value)}
            </span>
            <span className="text-muted w-10 text-right text-xs tabular-nums">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
