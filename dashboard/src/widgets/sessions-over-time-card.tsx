"use client";

import {Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {LineChart} from "@heroui-pro/react/line-chart";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

export function SessionsOverTimeCard() {
  const {snapshot, unlocked} = useOutrider();

  const {points, totalInputTokens} = useMemo(() => {
    const evals = [...(snapshot?.clef_evaluations ?? [])].reverse();
    const mapped = evals.map((e, idx): Record<string, number | string> => {
      const point: Record<string, number | string> = {index: `#${idx + 1}`};

      if (e.input_tokens !== null) point.inputTokens = e.input_tokens;
      if (e.output_tokens !== null) point.outputTokens = e.output_tokens;

      return point;
    });
    const sumInput = evals.reduce((acc, e) => acc + (e.input_tokens ?? 0), 0);

    return {points: mapped, totalInputTokens: sumInput};
  }, [snapshot?.clef_evaluations]);

  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Card.Title className="text-base text-balance">CLEF Token Usage</Card.Title>
          <NumberValue
            className="text-foreground text-2xl font-semibold tabular-nums"
            maximumFractionDigits={0}
            value={totalInputTokens}
          />
          <span className="text-muted text-xs">Cumulative input tokens</span>
        </div>
      </Card.Header>
      <Card.Content>
        {points.length === 0 ? (
          <p className="text-muted py-12 text-center text-xs">
            {unlocked
              ? "No CLEF evaluations recorded yet."
              : "Unlock with the admin token to inspect CLEF token counts."}
          </p>
        ) : (
          <LineChart data={points} height={220}>
            <LineChart.Grid vertical={false} />
            <LineChart.XAxis dataKey="index" tickMargin={8} />
            <LineChart.YAxis allowDecimals={false} width={40} />
            <LineChart.Line
              dataKey="inputTokens"
              dot
              isAnimationActive={false}
              name="Input tokens"
              stroke="var(--chart-2)"
              strokeWidth={2}
              type="linear"
            />
            <LineChart.Line
              dataKey="outputTokens"
              dot
              isAnimationActive={false}
              name="Output tokens"
              stroke="var(--chart-4)"
              strokeWidth={2}
              type="linear"
            />
            <LineChart.Tooltip content={<LineChart.TooltipContent />} />
          </LineChart>
        )}
      </Card.Content>
    </Card>
  );
}
