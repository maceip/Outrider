"use client";

import type {TimeRange} from "../lib/types";

import {Segment} from "@heroui-pro/react";

import {useCoreStore} from "../lib/core-store";
import {AnalyticsKpiRow} from "../widgets/analytics-kpi-row";
import {DeviceBreakdownCard} from "../widgets/device-breakdown-card";
import {EmployeesTable} from "../widgets/employees-table";
import {SessionsOverTimeCard} from "../widgets/sessions-over-time-card";

const TIME_RANGES: readonly TimeRange[] = ["5M", "1H", "24H", "ALL"] as const;

export function OverviewPage() {
  const {setTimeRange, timeRange} = useCoreStore();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-foreground text-xl font-semibold tracking-tight">Overview</h1>
        <Segment
          aria-label="Time range"
          className="shrink-0 font-mono tabular-nums"
          selectedKey={timeRange}
          size="sm"
          onSelectionChange={(key) => setTimeRange(String(key) as TimeRange)}
        >
          {TIME_RANGES.map((range) => (
            <Segment.Item key={range} className="font-mono tabular-nums" id={range}>
              {range}
            </Segment.Item>
          ))}
        </Segment>
      </div>

      <AnalyticsKpiRow />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SessionsOverTimeCard />
        <DeviceBreakdownCard />
      </div>

      <EmployeesTable />
    </div>
  );
}
