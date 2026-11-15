"use client";

import type {ComponentProps} from "react";

import {KPI} from "@heroui-pro/react/kpi";

export type SparklinePoint = {value: number};

type TrendDir = ComponentProps<typeof KPI.Trend>["trend"];

type AnalyticsKpi = {
  chartColor: string;
  chartData: readonly SparklinePoint[];
  label: string;
  numberProps: Omit<ComponentProps<typeof KPI.Value>, "children">;
  trend?: TrendDir;
  trendValue?: string;
};

const ANALYTICS_KPIS: readonly AnalyticsKpi[] = [];

export function AnalyticsKpiRow() {
  if (ANALYTICS_KPIS.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ANALYTICS_KPIS.map((kpi) => (
        <KPI key={kpi.label}>
          <KPI.Header>
            <KPI.Title>{kpi.label}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value {...kpi.numberProps} />
            {kpi.trend && kpi.trendValue ? (
              <KPI.Trend trend={kpi.trend}>{kpi.trendValue}</KPI.Trend>
            ) : null}
          </KPI.Content>
          <KPI.Chart
            color={kpi.chartColor}
            data={[...kpi.chartData]}
            height={60}
            strokeWidth={1.5}
          />
        </KPI>
      ))}
    </div>
  );
}
