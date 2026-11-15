"use client";

import {Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {BarChart} from "@heroui-pro/react/bar-chart";

export type SalesPoint = {
  bucket: string;
  count: number;
};

export type MiniKpi = {
  currency?: string;
  label: string;
  value: number;
};

const SALES_CHART_DATA: readonly SalesPoint[] = [];
const SALES_MINI_KPIS: readonly MiniKpi[] = [];

export function SalesPerformanceCard() {
  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-center justify-between">
        <Card.Title className="text-base">Throughput</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {SALES_MINI_KPIS.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {SALES_MINI_KPIS.map((kpi) => (
              <div key={kpi.label} className="flex flex-col">
                <NumberValue
                  className="text-foreground text-lg font-semibold tabular-nums"
                  currency={kpi.currency}
                  maximumFractionDigits={0}
                  style={kpi.currency ? "currency" : "decimal"}
                  value={kpi.value}
                />
                <span className="text-muted text-xs">{kpi.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        <BarChart data={[...SALES_CHART_DATA]} height={180}>
          <BarChart.Grid vertical={false} />
          <BarChart.XAxis dataKey="bucket" tickMargin={8} />
          <BarChart.YAxis width={30} />
          <BarChart.Bar
            barSize={16}
            dataKey="count"
            fill="var(--chart-3)"
            radius={[24, 24, 24, 24]}
          />
          <BarChart.Tooltip content={<BarChart.TooltipContent />} />
        </BarChart>
      </Card.Content>
    </Card>
  );
}
