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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <div className="flex items-center justify-end">
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
      <SessionsOverTimeCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeviceBreakdownCard />
        <TopChannelsCard />
      </div>
      <TopPagesCard />
    </div>
  );
}
