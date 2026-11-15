"use client";

import {ArrowsRotateLeft} from "@gravity-ui/icons";
import {Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {LineChart} from "@heroui-pro/react/line-chart";
import {useMemo} from "react";

import {IconButton} from "../components/icon-button";
import {useCoreStore} from "../lib/core-store";

import {buildDashboardBuckets, filterDashboardTraffics, useEffectiveNowMs} from "./kpi-row";

function formatYTick(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`;
}

export function TrafficSourceCard() {
  const {dashboardPeriod, dashboardTab, refresh, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const filteredTraffics = useMemo(
    () => filterDashboardTraffics(traffics, dashboardPeriod, dashboardTab, nowMs),
    [traffics, dashboardPeriod, dashboardTab, nowMs],
  );

  const buckets = useMemo(
    () => buildDashboardBuckets(filteredTraffics, dashboardPeriod, nowMs),
    [filteredTraffics, dashboardPeriod, nowMs],
  );

  return (
    <Card className="h-full">
      <Card.Header className="flex-row flex-wrap items-center justify-between gap-3">
        <Card.Title className="min-w-0 truncate text-base">Traffic by Type</Card.Title>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <LegendDot color="var(--chart-1)" label="HTTP / WS" />
            <LegendDot color="var(--chart-3)" label="MCP" />
          </div>
          <IconButton
            label="Refresh"
            size="sm"
            variant="tertiary"
            onPress={() => void refresh()}
          >
            <ArrowsRotateLeft className="size-4" />
          </IconButton>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col">
          <NumberValue
            className="text-foreground font-mono text-lg font-semibold tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={filteredTraffics.length}
          />
          <span className="text-muted text-xs">Requests</span>
        </div>
        <LineChart className="font-mono tabular-nums" data={buckets} height={180}>
          <LineChart.Grid vertical={false} />
          <LineChart.XAxis dataKey="bucket" minTickGap={16} tickMargin={8} />
          <LineChart.YAxis
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
            tickFormatter={formatYTick}
            width={32}
          />
          <LineChart.Line
            dataKey="http"
            dot={false}
            name="HTTP / WS"
            stroke="var(--chart-1)"
            strokeWidth={2}
            type="linear"
          />
          <LineChart.Line
            dataKey="mcp"
            dot={false}
            name="MCP"
            stroke="var(--chart-3)"
            strokeWidth={2}
            type="linear"
          />
          <LineChart.Tooltip content={<LineChart.TooltipContent />} />
        </LineChart>
      </Card.Content>
    </Card>
  );
}

function LegendDot({color, label}: {color: string; label: string}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2.5 shrink-0 rounded-xs" style={{backgroundColor: color}} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
