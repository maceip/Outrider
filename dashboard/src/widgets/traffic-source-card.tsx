"use client";

import {Button, Card} from "@heroui/react";
import {LineChart} from "@heroui-pro/react/line-chart";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

type TelemetryPoint = Record<string, number | string>;

export function TrafficSourceCard() {
  const {clefStatus, openDialog, selectedSession, snapshot, unlocked} = useOutrider();

  const {points, totalEvaluations, totalProbes} = useMemo(() => {
    const probes = snapshot?.probe_runs ?? [];
    const evals = snapshot?.clef_evaluations ?? [];

    const combined: Array<{
      createdAt: number;
      label: string;
      latencyMs: number | null;
      tokens: number | null;
    }> = [
      ...probes.map((p) => ({
        createdAt: p.created_at,
        label: `P-${p.probe_id.slice(0, 4)}`,
        latencyMs: p.latency_ms,
        tokens:
          p.input_tokens !== null || p.output_tokens !== null
            ? (p.input_tokens ?? 0) + (p.output_tokens ?? 0)
            : null,
      })),
      ...evals.map((e) => ({
        createdAt: e.created_at,
        label: `E-${e.evaluation_id.slice(0, 4)}`,
        latencyMs: e.latency_ms,
        tokens:
          e.input_tokens !== null || e.output_tokens !== null
            ? (e.input_tokens ?? 0) + (e.output_tokens ?? 0)
            : null,
      })),
    ].sort((a, b) => a.createdAt - b.createdAt);

    return {
      points: combined.map(({label, latencyMs, tokens}): TelemetryPoint => {
        const point: TelemetryPoint = {label};

        if (latencyMs !== null) point.latencyMs = latencyMs;
        if (tokens !== null) point.tokens = tokens;

        return point;
      }),
      totalEvaluations: evals.length,
      totalProbes: probes.length,
    };
  }, [snapshot?.clef_evaluations, snapshot?.probe_runs]);

  const canRunClef = unlocked && Boolean(selectedSession) && clefStatus?.status === "Ready";
  const clefDisabledReason = !unlocked
    ? "Admin token required"
    : !selectedSession
      ? "Select an agent session"
      : clefStatus?.status !== "Ready"
        ? "CLEF Unconfigured: load a .litertlm model"
        : undefined;

  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title className="text-base text-balance">Probe & CLEF Telemetry</Card.Title>
        <div className="flex items-center gap-3">
          <LegendDot color="var(--chart-2)" label="Latency (ms)" />
          <LegendDot color="var(--chart-4)" label="Total tokens" />
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="text-foreground text-lg font-semibold tabular-nums">
              {totalProbes}
            </span>
            <span className="text-muted text-xs">Probe runs</span>
          </div>
          <div className="flex flex-col">
            <span className="text-foreground text-lg font-semibold tabular-nums">
              {totalEvaluations}
            </span>
            <span className="text-muted text-xs">CLEF evaluations</span>
          </div>
        </div>

        {!unlocked ? (
          <div className="border-border flex h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center">
            <p className="text-muted text-xs text-pretty">
              Unlock with the admin bearer token to inspect probe and CLEF latency measurements.
            </p>
          </div>
        ) : points.length === 0 ? (
          <div className="border-border flex h-[180px] flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed p-4 text-center">
            <p className="text-muted text-xs text-pretty">
              0 probe runs or CLEF evaluations recorded.
            </p>
            <span title={clefDisabledReason}>
              <Button
                isDisabled={!canRunClef}
                size="sm"
                variant="secondary"
                onPress={() => openDialog("evaluate-clef")}
              >
                Query CLEF Model
              </Button>
            </span>
          </div>
        ) : (
          <LineChart data={points} height={180}>
            <LineChart.Grid vertical={false} />
            <LineChart.XAxis dataKey="label" tickMargin={8} />
            <LineChart.YAxis allowDecimals={false} width={40} />
            <LineChart.Line
              dataKey="latencyMs"
              dot
              isAnimationActive={false}
              name="Latency (ms)"
              stroke="var(--chart-2)"
              strokeWidth={2}
              type="linear"
            />
            <LineChart.Line
              dataKey="tokens"
              dot
              isAnimationActive={false}
              name="Total tokens"
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

function LegendDot({color, label}: {color: string; label: string}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{backgroundColor: color}} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
