"use client";

import type {Key} from "react";

import {Button, Card} from "@heroui/react";
import {ChartTooltip, Segment} from "@heroui-pro/react";
import {PieChart} from "@heroui-pro/react/pie-chart";
import {useRouter} from "next/navigation";
import {useMemo, useState} from "react";

import {useOutrider} from "../lib/outrider-store";

const SLICE_COLORS = [
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-1)",
  "var(--chart-5)",
];

type BreakdownDimension = "fingerprints" | "transports";

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

function focusAdminTokenInput() {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Admin token"]');

  input?.focus();
}

export function DeviceBreakdownCard() {
  const {snapshot, unlocked} = useOutrider();
  const router = useRouter();
  const [dimension, setDimension] = useState<BreakdownDimension>("fingerprints");

  const {slices, total} = useMemo(() => {
    const counts = new Map<string, number>();

    if (dimension === "fingerprints") {
      const observations = snapshot?.fingerprint_observations ?? [];

      for (const obs of observations) {
        const key = obs.kind || "unknown";

        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const sorted = [...counts.entries()]
        .map(([name, value]) => ({name, value}))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

      return {slices: sorted, total: observations.length};
    }

    const sessions = snapshot?.agent_sessions ?? [];

    for (const session of sessions) {
      const key = session.transport || "unknown";

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()]
      .map(([name, value]) => ({name, value}))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    return {slices: sorted, total: sessions.length};
  }, [dimension, snapshot?.agent_sessions, snapshot?.fingerprint_observations]);

  const unitLabel = dimension === "fingerprints" ? "Observations" : "Sessions";

  return (
    <Card className="h-full rounded-2xl">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <Card.Title className="text-base text-balance">
            {dimension === "fingerprints"
              ? "Fingerprint Observations by Kind"
              : "Agent Sessions by Transport"}
          </Card.Title>
          <Card.Description>
            {dimension === "fingerprints"
              ? "Persisted passive TLS, HTTP header-order, and MCP handshake evidence."
              : "Persisted MCP session transport breakdown."}
          </Card.Description>
        </div>

        <Segment
          aria-label="Breakdown dimension"
          selectedKey={dimension}
          size="sm"
          onSelectionChange={(key: Key) => setDimension(String(key) as BreakdownDimension)}
        >
          <Segment.Item id="fingerprints">Fingerprints</Segment.Item>
          <Segment.Item id="transports">Transports</Segment.Item>
        </Segment>
      </Card.Header>

      <Card.Content className="flex flex-1 flex-col items-center justify-center gap-5">
        {!unlocked ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-center">
            <p className="text-muted text-xs text-pretty">
              Unlock with the admin token to inspect persisted {unitLabel.toLowerCase()}.
            </p>
            <Button size="sm" variant="secondary" onPress={focusAdminTokenInput}>
              Focus Admin Token
            </Button>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-center">
            <p className="text-muted text-xs text-pretty">
              0 {unitLabel.toLowerCase()} recorded in SQLite.
            </p>
            <Button size="sm" variant="secondary" onPress={() => router.push("/inspector")}>
              Open MCP Inspector
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <PieChart height={220} width={220}>
                <PieChart.Pie
                  cornerRadius={6}
                  cx="50%"
                  cy="50%"
                  data={slices}
                  dataKey="value"
                  innerRadius="66%"
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
                <span className="text-muted text-xs">{unitLabel}</span>
              </div>
            </div>

            <ul className="flex w-full max-w-[280px] flex-col gap-2">
              {slices.map((entry, idx) => {
                const pct = ((entry.value / total) * 100).toFixed(0);

                return (
                  <li key={entry.name} className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{backgroundColor: SLICE_COLORS[idx % SLICE_COLORS.length]}}
                    />
                    <span className="text-foreground min-w-0 flex-1 truncate font-mono text-xs">
                      {entry.name}
                    </span>
                    <span className="text-foreground font-mono text-xs font-semibold tabular-nums">
                      {entry.value}
                    </span>
                    <span className="text-muted w-9 text-right font-mono text-xs tabular-nums">
                      {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card.Content>
    </Card>
  );
}
