"use client";

import {Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {LineChart} from "@heroui-pro/react/line-chart";
import {useMemo} from "react";

import {useCoreStore} from "../lib/core-store";

import {buildAnalyticsBuckets, filterAnalyticsTraffics} from "./analytics-kpi-row";
import {useEffectiveNowMs} from "./kpi-row";

function formatThousands(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
}

export function SessionsOverTimeCard() {
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

  return (
    <Card>
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Card.Title className="min-w-0 truncate text-base">Events Over Time</Card.Title>
          <NumberValue
            className="text-foreground font-mono text-2xl font-semibold tabular-nums"
            maximumFractionDigits={0}
            value={rangeTraffics.length}
          />
        </div>
        <div className="flex items-center gap-4">
          <LegendDot color="var(--chart-3)" label="Requests" />
          <LegendDot color="var(--chart-1)" label="Errors" />
        </div>
      </Card.Header>
      <Card.Content>
        <LineChart className="font-mono tabular-nums" data={buckets} height={240}>
          <LineChart.Grid vertical={false} />
          <LineChart.XAxis dataKey="bucket" minTickGap={24} tickMargin={8} />
          <LineChart.YAxis
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
            tickFormatter={formatThousands}
            width={40}
          />
          <LineChart.Line
            dataKey="requests"
            dot={false}
            name="Requests"
            stroke="var(--chart-3)"
            strokeWidth={2}
            type="monotone"
          />
          <LineChart.Line
            dataKey="errors"
            dot={false}
            name="Errors"
            stroke="var(--chart-1)"
            strokeWidth={2}
            type="monotone"
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
