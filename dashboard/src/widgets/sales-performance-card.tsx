"use client";

import {Button, Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {BarChart} from "@heroui-pro/react/bar-chart";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

type MethodBarDatum = {
  method: string;
  frames: number;
};

export function SalesPerformanceCard() {
  const {openDialog, snapshot, unlocked} = useOutrider();

  const {chartData, distinctMethods, totalFrames} = useMemo(() => {
    const frames = snapshot?.mcp_frames ?? [];
    const counts = new Map<string, number>();

    for (const frame of frames) {
      const key = frame.method || "unknown";

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const sorted: MethodBarDatum[] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([method, count]) => ({
        frames: count,
        method: method.length > 20 ? `${method.slice(0, 18)}…` : method,
      }));

    return {
      chartData: sorted,
      distinctMethods: counts.size,
      totalFrames: frames.length,
    };
  }, [snapshot?.mcp_frames]);

  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title className="text-base text-balance">MCP Frames by Method</Card.Title>
        <span className="text-muted font-mono text-xs tabular-nums">
          {distinctMethods} methods
        </span>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <NumberValue
              className="text-foreground text-lg font-semibold tabular-nums"
              maximumFractionDigits={0}
              style="decimal"
              value={totalFrames}
            />
            <span className="text-muted text-xs">Persisted MCP frames</span>
          </div>
          <div className="flex flex-col">
            <NumberValue
              className="text-foreground text-lg font-semibold tabular-nums"
              maximumFractionDigits={0}
              style="decimal"
              value={snapshot?.upstream_servers.length ?? 0}
            />
            <span className="text-muted text-xs">Upstream servers</span>
          </div>
        </div>

        {!unlocked ? (
          <div className="border-border flex h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center">
            <p className="text-muted text-xs text-pretty">
              Unlock with the admin bearer token to read persisted MCP frame counts.
            </p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="border-border flex h-[180px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed p-4 text-center">
            <p className="text-muted text-xs text-pretty">
              0 MCP frames recorded in this runtime. Connect an upstream or MCP client to capture
              frames.
            </p>
            <Button size="sm" variant="secondary" onPress={() => openDialog("connect-upstream")}>
              Connect Upstream
            </Button>
          </div>
        ) : (
          <BarChart data={chartData} height={180}>
            <BarChart.Grid vertical={false} />
            <BarChart.XAxis dataKey="method" tickMargin={8} />
            <BarChart.YAxis allowDecimals={false} width={34} />
            <BarChart.Bar
              barSize={18}
              dataKey="frames"
              fill="var(--chart-3)"
              isAnimationActive={false}
              name="Frames"
              radius={[8, 8, 0, 0]}
            />
            <BarChart.Tooltip content={<BarChart.TooltipContent />} />
          </BarChart>
        )}
      </Card.Content>
    </Card>
  );
}
