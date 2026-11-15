"use client";

import {Card} from "@heroui/react";
import {LineChart} from "@heroui-pro/react/line-chart";

export type TrafficPoint = {
  bucket: string;
  http: number;
  mcp: number;
};

const TRAFFIC_DATA: readonly TrafficPoint[] = [];

export function TrafficSourceCard() {
  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-center justify-between">
        <Card.Title className="text-base">Traffic Source</Card.Title>
        <div className="flex items-center gap-3">
          <LegendDot color="var(--chart-2)" label="HTTP" />
          <LegendDot color="var(--chart-4)" label="MCP" />
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-col">
          <span className="text-foreground text-lg font-semibold tabular-nums">
            {TRAFFIC_DATA.length}
          </span>
          <span className="text-muted text-xs">Requests</span>
        </div>
        <LineChart data={[...TRAFFIC_DATA]} height={180}>
          <LineChart.Grid vertical={false} />
          <LineChart.XAxis dataKey="bucket" tickMargin={8} />
          <LineChart.YAxis width={30} />
          <LineChart.Line
            dataKey="http"
            dot={false}
            name="HTTP"
            stroke="var(--chart-2)"
            strokeWidth={2}
            type="linear"
          />
          <LineChart.Line
            dataKey="mcp"
            dot={false}
            name="MCP"
            stroke="var(--chart-4)"
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
      <span className="size-3 rounded-full" style={{backgroundColor: color}} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
