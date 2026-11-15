"use client";

import type {DashboardPeriod} from "../lib/types";

import {Card, ListBox, Select} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {BarChart} from "@heroui-pro/react/bar-chart";
import {useMemo} from "react";

import {useCoreStore} from "../lib/core-store";

import {buildDashboardBuckets, filterDashboardTraffics, useEffectiveNowMs} from "./kpi-row";

export function SalesPerformanceCard() {
  const {dashboardPeriod, dashboardTab, setDashboardPeriod, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const filteredTraffics = useMemo(
    () => filterDashboardTraffics(traffics, dashboardPeriod, dashboardTab, nowMs),
    [traffics, dashboardPeriod, dashboardTab, nowMs],
  );

  const buckets = useMemo(
    () => buildDashboardBuckets(filteredTraffics, dashboardPeriod, nowMs),
    [filteredTraffics, dashboardPeriod, nowMs],
  );

  const payloadBytes = useMemo(
    () => filteredTraffics.reduce((sum, item) => sum + (item.size ?? 0), 0),
    [filteredTraffics],
  );

  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-center justify-between">
        <Card.Title className="text-base">Request Volume</Card.Title>
        <Select
          aria-label="Period"
          className="w-[140px]"
          value={dashboardPeriod}
          variant="secondary"
          onChange={(value) => {
            if (value && !Array.isArray(value)) {
              setDashboardPeriod(String(value) as DashboardPeriod);
            }
          }}
        >
          <Select.Trigger className="h-auto min-h-0 px-3 py-1.5 text-xs font-medium">
            <Select.Value />
            <Select.Indicator className="size-3.5" />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="daily" textValue="Daily">
                Daily
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="weekly" textValue="Weekly">
                Weekly
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="monthly" textValue="Monthly">
                Monthly
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="yearly" textValue="Yearly">
                Yearly
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-col">
            <NumberValue
              className="text-foreground text-lg font-semibold tabular-nums"
              maximumFractionDigits={0}
              style="decimal"
              value={filteredTraffics.length}
            />
            <span className="text-muted text-xs">Requests</span>
          </div>
          <div className="flex flex-col">
            <NumberValue
              className="text-foreground text-lg font-semibold tabular-nums"
              maximumFractionDigits={0}
              style="decimal"
              value={payloadBytes}
            />
            <span className="text-muted text-xs">Payload Bytes</span>
          </div>
        </div>
        <BarChart data={buckets} height={180}>
          <BarChart.Grid vertical={false} />
          <BarChart.XAxis dataKey="bucket" minTickGap={16} tickMargin={8} />
          <BarChart.YAxis
            allowDecimals={false}
            domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
            width={30}
          />
          <BarChart.Bar
            barSize={16}
            dataKey="requests"
            fill="var(--chart-3)"
            name="Requests"
            radius={[24, 24, 24, 24]}
          />
          <BarChart.Tooltip content={<BarChart.TooltipContent />} />
        </BarChart>
      </Card.Content>
    </Card>
  );
}
