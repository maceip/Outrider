"use client";

import {Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {LineChart} from "@heroui-pro/react/line-chart";

export type SessionsPoint = {
  day: string;
  sessions: number;
  users: number;
};

const SESSIONS_OVER_TIME: readonly SessionsPoint[] = [];

function formatThousands(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
}

export function SessionsOverTimeCard() {
  const total = SESSIONS_OVER_TIME.reduce((sum, p) => sum + p.sessions, 0);

  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Card.Title className="text-base">Requests over time</Card.Title>
          <NumberValue
            className="text-foreground text-2xl font-semibold tabular-nums"
            maximumFractionDigits={0}
            value={total}
          />
        </div>
        <div className="flex items-center gap-4">
          <LegendDot color="var(--chart-2)" label="Requests" />
          <LegendDot color="var(--chart-4)" label="Sessions" />
        </div>
      </Card.Header>
      <Card.Content>
        <LineChart data={[...SESSIONS_OVER_TIME]} height={240}>
          <LineChart.Grid vertical={false} />
          <LineChart.XAxis dataKey="day" minTickGap={32} tickMargin={8} />
          <LineChart.YAxis tickFormatter={formatThousands} width={40} />
          <LineChart.Line
            dataKey="sessions"
            dot={false}
            name="Requests"
            stroke="var(--chart-2)"
            strokeWidth={2}
            type="monotone"
          />
          <LineChart.Line
            dataKey="users"
            dot={false}
            name="Sessions"
            stroke="var(--chart-4)"
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
      <span className="size-3 rounded-full" style={{backgroundColor: color}} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
