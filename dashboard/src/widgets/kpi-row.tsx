"use client";

import {KPI} from "@heroui-pro/react/kpi";

export type StatsCard = {
  currency?: string;
  label: string;
  trend?: "down" | "up" | "neutral";
  trendValue?: string;
  value: number;
};

const STATS_CARDS: readonly StatsCard[] = [];

export function KpiRow() {
  if (STATS_CARDS.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STATS_CARDS.map((stat) => (
        <KPI key={stat.label}>
          <KPI.Header>
            <KPI.Title>{stat.label}</KPI.Title>
          </KPI.Header>
          <KPI.Content>
            <KPI.Value
              currency={stat.currency}
              maximumFractionDigits={0}
              style={stat.currency ? "currency" : "decimal"}
              value={stat.value}
            />
            {stat.trend && stat.trendValue ? (
              <KPI.Trend trend={stat.trend}>{stat.trendValue}</KPI.Trend>
            ) : null}
          </KPI.Content>
        </KPI>
      ))}
    </div>
  );
}
