"use client";

import type {TimeRange} from "../lib/types";

import {Segment} from "@heroui-pro/react";

import {useCoreStore} from "../lib/core-store";
import {AnalyticsKpiRow} from "../widgets/analytics-kpi-row";
import {DeviceBreakdownCard} from "../widgets/device-breakdown-card";
import {SessionsOverTimeCard} from "../widgets/sessions-over-time-card";
import {TopChannelsCard} from "../widgets/top-channels-card";
import {TopPagesCard} from "../widgets/top-pages-card";

const TIME_RANGES: readonly TimeRange[] = ["5M", "1H", "24H", "ALL"] as const;

export function AnalyticsPage() {
  const {setTimeRange, timeRange} = useCoreStore();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted text-sm">Live gateway telemetry and protocol breakdown.</p>
        <Segment
          aria-label="Time range"
          selectedKey={timeRange}
          size="sm"
          onSelectionChange={(key) => setTimeRange(String(key) as TimeRange)}
        >
          {TIME_RANGES.map((range) => (
            <Segment.Item key={range} id={range}>
              {range}
            </Segment.Item>
          ))}
        </Segment>
      </div>

      <AnalyticsKpiRow />

      <SessionsOverTimeCard />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DeviceBreakdownCard />
        <TopChannelsCard />
      </div>

      <TopPagesCard />
    </div>
  );
}
