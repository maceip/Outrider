"use client";

import {Card} from "@heroui/react";
import {ChartTooltip} from "@heroui-pro/react";
import {PieChart} from "@heroui-pro/react/pie-chart";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

const SLICE_COLORS = ["var(--chart-3)", "var(--chart-2)", "var(--chart-4)"];

interface SliceTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    payload?: {fill?: string};
    value?: number | string;
  }>;
}

function SliceTooltip({active, payload}: SliceTooltipProps) {
  const entry = payload?.[0];

  if (!active || !entry) return null;

  return (
    <ChartTooltip>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={entry.payload?.fill} />
        <ChartTooltip.Label>{entry.name}</ChartTooltip.Label>
        <ChartTooltip.Value>{String(entry.value ?? 0)}</ChartTooltip.Value>
      </ChartTooltip.Item>
    </ChartTooltip>
  );
}

export function DeviceBreakdownCard() {
  const {snapshot, unlocked} = useOutrider();

  const {slices, total} = useMemo(() => {
    const sessions = snapshot?.agent_sessions ?? [];
    const counts = new Map<string, number>();

    for (const s of sessions) {
      const key = s.transport || "unknown";

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const items = [...counts.entries()].map(([name, value]) => ({name, value}));

    return {slices: items, total: sessions.length};
  }, [snapshot?.agent_sessions]);

  return (
    <Card className="h-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base text-balance">Sessions by Transport</Card.Title>
        <Card.Description>Persisted MCP transport breakdown.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-1 flex-col items-center justify-center gap-4">
        {total === 0 ? (
          <p className="text-muted py-10 text-xs">
            {unlocked ? "0 agent sessions recorded." : "Unlock to view session transports."}
          </p>
        ) : (
          <div className="relative">
            <PieChart height={220} width={220}>
              <PieChart.Pie
                cornerRadius={6}
                cx="50%"
                cy="50%"
                data={slices}
                dataKey="value"
                innerRadius="65%"
                isAnimationActive={false}
                nameKey="name"
                strokeWidth={0}
              >
                {slices.map((entry, idx) => (
                  <PieChart.Cell
                    key={entry.name}
                    fill={SLICE_COLORS[idx % SLICE_COLORS.length]}
                  />
                ))}
              </PieChart.Pie>
              <PieChart.Tooltip content={<SliceTooltip />} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-foreground text-2xl font-semibold tabular-nums">{total}</span>
              <span className="text-muted text-xs">Sessions</span>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
