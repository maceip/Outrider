"use client";

import {Button, Card} from "@heroui/react";
import {BarChart} from "@heroui-pro/react/bar-chart";
import {useRouter} from "next/navigation";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

function focusAdminTokenInput() {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Admin token"]');

  input?.focus();
}

export function TopChannelsCard() {
  const {snapshot, unlocked} = useOutrider();
  const router = useRouter();

  const {data, totalFrames} = useMemo(() => {
    const frames = snapshot?.mcp_frames ?? [];
    const counts = new Map<string, number>();

    for (const frame of frames) {
      const method = frame.method || "(unnamed)";

      counts.set(method, (counts.get(method) ?? 0) + 1);
    }

    const sorted = [...counts.entries()]
      .map(([method, count]) => ({count, method}))
      .sort((a, b) => b.count - a.count || a.method.localeCompare(b.method));

    return {data: sorted, totalFrames: frames.length};
  }, [snapshot?.mcp_frames]);

  const chartHeight = Math.max(220, Math.min(360, data.length * 36 + 48));

  return (
    <Card className="h-full rounded-2xl">
      <Card.Header>
        <Card.Title className="text-base text-balance">MCP Frames by Method</Card.Title>
        <Card.Description className="tabular-nums">
          {unlocked
            ? `${totalFrames} persisted JSON-RPC frames grouped by method.`
            : "Persisted MCP JSON-RPC method distribution."}
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-1 flex-col justify-center">
        {!unlocked ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-center">
            <p className="text-muted text-xs text-pretty">
              Unlock with the admin token to inspect MCP frame method counts.
            </p>
            <Button size="sm" variant="secondary" onPress={focusAdminTokenInput}>
              Focus Admin Token
            </Button>
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-center">
            <p className="text-muted text-xs text-pretty">0 MCP frames recorded in SQLite.</p>
            <Button size="sm" variant="secondary" onPress={() => router.push("/inspector")}>
              Open MCP Inspector
            </Button>
          </div>
        ) : (
          <BarChart data={data} height={chartHeight} layout="vertical">
            <BarChart.Grid horizontal={false} />
            <BarChart.XAxis allowDecimals={false} tickMargin={4} type="number" />
            <BarChart.YAxis dataKey="method" tickMargin={4} type="category" width={150} />
            <BarChart.Bar
              barSize={16}
              dataKey="count"
              fill="var(--chart-3)"
              isAnimationActive={false}
              name="Frames"
              radius={[0, 8, 8, 0]}
            />
            <BarChart.Tooltip content={<BarChart.TooltipContent />} />
          </BarChart>
        )}
      </Card.Content>
    </Card>
  );
}
