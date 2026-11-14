"use client";

import type {ClefEvaluation} from "../lib/types";

import {Button, Card} from "@heroui/react";
import {NumberValue} from "@heroui-pro/react";
import {LineChart} from "@heroui-pro/react/line-chart";
import {useMemo, useState} from "react";

import {useOutrider} from "../lib/outrider-store";

type TelemetryPoint = Record<string, number | string>;

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString();
}

function formatClefQuestion(question: ClefEvaluation["question"]): string {
  if (question && typeof question === "object" && "question" in question) {
    const q = question as {
      max?: number;
      min?: number;
      options?: string[];
      question?: unknown;
      type?: unknown;
    };
    const prompt = typeof q.question === "string" ? q.question : JSON.stringify(question);
    const kind = typeof q.type === "string" ? q.type : "unknown";

    if (kind === "choice" && Array.isArray(q.options) && q.options.length > 0) {
      return `[choice: ${q.options.join(" | ")}] ${prompt}`;
    }
    if (kind === "score" && typeof q.min === "number" && typeof q.max === "number") {
      return `[score ${q.min}..${q.max}] ${prompt}`;
    }

    return `[${kind}] ${prompt}`;
  }

  return JSON.stringify(question);
}

function focusAdminTokenInput() {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Admin token"]');

  input?.focus();
}

export function SessionsOverTimeCard() {
  const {
    busy,
    clefStatus,
    openDialog,
    selectedSession,
    setSelectedSessionId,
    snapshot,
    unlocked,
  } = useOutrider();
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);

  const evaluations = useMemo(
    () => snapshot?.clef_evaluations ?? [],
    [snapshot?.clef_evaluations],
  );
  const probeRuns = useMemo(() => snapshot?.probe_runs ?? [], [snapshot?.probe_runs]);

  const points = useMemo<TelemetryPoint[]>(() => {
    const chronologicalProbes = [...probeRuns].reverse().map((probe, idx) => ({
      createdAt: probe.created_at,
      latencyMs: probe.latency_ms,
      order: idx,
      refLabel: `P-${probe.probe_id.slice(0, 6)}`,
      tokens:
        probe.input_tokens !== null || probe.output_tokens !== null
          ? (probe.input_tokens ?? 0) + (probe.output_tokens ?? 0)
          : null,
    }));

    const chronologicalEvals = [...evaluations].reverse().map((evaluation, idx) => ({
      createdAt: evaluation.created_at,
      latencyMs: evaluation.latency_ms,
      order: probeRuns.length + idx,
      refLabel: `E-${evaluation.evaluation_id.slice(0, 6)}`,
      tokens:
        evaluation.input_tokens !== null || evaluation.output_tokens !== null
          ? (evaluation.input_tokens ?? 0) + (evaluation.output_tokens ?? 0)
          : null,
    }));

    return [...chronologicalProbes, ...chronologicalEvals]
      .sort((a, b) => a.createdAt - b.createdAt || a.order - b.order)
      .map(({latencyMs, refLabel, tokens}) => {
        const point: TelemetryPoint = {run: refLabel};

        if (latencyMs !== null) {
          point.latencyMs = latencyMs;
        }
        if (tokens !== null) {
          point.totalTokens = tokens;
        }

        return point;
      });
  }, [evaluations, probeRuns]);

  const activeEval = useMemo<ClefEvaluation | null>(() => {
    if (evaluations.length === 0) return null;
    if (selectedEvalId) {
      const found = evaluations.find((item) => item.evaluation_id === selectedEvalId);

      if (found) return found;
    }

    return evaluations[0] ?? null;
  }, [evaluations, selectedEvalId]);

  const sessionCount = snapshot?.agent_sessions.length ?? 0;
  const clefDisabledReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : sessionCount === 0
        ? "No agent session recorded"
        : clefStatus?.status !== "Ready"
          ? clefStatus?.status === "ModelError"
            ? `CLEF ModelError: ${clefStatus.error}`
            : "CLEF Unconfigured: load a .litertlm model"
          : undefined;

  const handleRunClefEval = () => {
    if (!selectedSession && snapshot?.agent_sessions[0]) {
      setSelectedSessionId(snapshot.agent_sessions[0].session_id);
    }
    openDialog("evaluate-clef");
  };

  return (
    <Card className="rounded-2xl">
      <Card.Header className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <Card.Title className="text-base text-balance">
            Chronological Probe & CLEF Telemetry
          </Card.Title>
          <div className="flex items-baseline gap-2">
            <NumberValue
              className="text-foreground text-2xl font-semibold tabular-nums"
              maximumFractionDigits={0}
              value={points.length}
            />
            <span className="text-muted text-xs tabular-nums">
              {unlocked
                ? `${evaluations.length} CLEF · ${probeRuns.length} probes`
                : "Telemetry runs"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <LegendDot color="var(--chart-2)" label="Latency (ms)" />
          <LegendDot color="var(--chart-4)" label="Total tokens" />
        </div>
      </Card.Header>

      <Card.Content className="flex flex-col gap-5">
        {!unlocked ? (
          <div className="border-border flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed py-10 text-center">
            <p className="text-muted text-xs text-pretty">
              Unlock with the admin bearer token to inspect chronological probe and CLEF latency
              and token measurements.
            </p>
            <Button size="sm" variant="secondary" onPress={focusAdminTokenInput}>
              Focus Admin Token
            </Button>
          </div>
        ) : points.length === 0 ? (
          <div className="border-border flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed py-10 text-center">
            <p className="text-muted text-xs text-pretty">
              0 probe runs or CLEF evaluations persisted in SQLite.
            </p>
            <span title={clefDisabledReason}>
              <Button
                isDisabled={Boolean(clefDisabledReason)}
                size="sm"
                variant="secondary"
                onPress={handleRunClefEval}
              >
                Run CLEF Eval
              </Button>
            </span>
          </div>
        ) : (
          <LineChart data={points} height={240}>
            <LineChart.Grid vertical={false} />
            <LineChart.XAxis dataKey="run" minTickGap={24} tickMargin={8} />
            <LineChart.YAxis allowDecimals={false} width={44} />
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
              dataKey="totalTokens"
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

        <div className="border-border flex flex-col gap-3 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-foreground text-sm font-semibold text-balance">
              CLEF Evaluation Inspector
            </h3>
            <span className="text-muted font-mono text-xs tabular-nums">
              {evaluations.length} recorded
            </span>
          </div>

          {evaluations.length === 0 ? (
            <div className="border-border flex flex-col items-start justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
              <div className="flex flex-col gap-1">
                <p className="text-foreground text-xs font-medium">
                  0 CLEF evaluations persisted yet.
                </p>
                <p className="text-muted font-mono text-xs text-pretty">
                  option_scores: null (not exposed by litert-lm-rust 0.2.4)
                </p>
              </div>
              <span title={clefDisabledReason}>
                <Button
                  isDisabled={Boolean(clefDisabledReason)}
                  size="sm"
                  variant="secondary"
                  onPress={handleRunClefEval}
                >
                  Run CLEF Eval
                </Button>
              </span>
            </div>
          ) : (
            <div className="border-border grid grid-cols-1 overflow-hidden rounded-xl border lg:grid-cols-[260px_minmax(0,1fr)]">
              <ul
                aria-label="Recorded CLEF evaluations"
                className="border-border flex max-h-[320px] flex-col overflow-y-auto border-b lg:border-r lg:border-b-0"
              >
                {evaluations.map((evaluation) => {
                  const isSelected = activeEval?.evaluation_id === evaluation.evaluation_id;

                  return (
                    <li key={evaluation.evaluation_id} className="border-border border-b last:border-b-0">
                      <button
                        aria-pressed={isSelected}
                        className={
                          isSelected
                            ? "border-accent bg-accent-soft/20 flex w-full flex-col gap-1 border p-3 text-left"
                            : "hover:bg-default/20 flex w-full flex-col gap-1 p-3 text-left"
                        }
                        style={{boxShadow: "none"}}
                        type="button"
                        onClick={() => setSelectedEvalId(evaluation.evaluation_id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground font-mono text-xs font-medium tabular-nums">
                            E-{evaluation.evaluation_id.slice(0, 8)}
                          </span>
                          <span className="text-accent font-mono text-xs">{evaluation.status}</span>
                        </div>
                        <span className="text-muted truncate font-mono text-xs tabular-nums">
                          {evaluation.session_id.slice(0, 12)} · {formatTimestamp(evaluation.created_at)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {activeEval ? (
                <div className="flex flex-col gap-3 p-4">
                  {activeEval.error ? (
                    <div
                      className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 font-mono text-xs"
                      role="alert"
                    >
                      {activeEval.error}
                    </div>
                  ) : null}

                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-[140px_minmax(0,1fr)]">
                    <dt className="text-muted">evaluation_id</dt>
                    <dd className="break-all font-mono tabular-nums">{activeEval.evaluation_id}</dd>

                    <dt className="text-muted">session_id</dt>
                    <dd className="break-all font-mono tabular-nums">{activeEval.session_id}</dd>

                    <dt className="text-muted">question</dt>
                    <dd className="break-words font-mono">{formatClefQuestion(activeEval.question)}</dd>

                    <dt className="text-muted">pick</dt>
                    <dd className="font-mono font-semibold">
                      {activeEval.pick === null ? "null" : JSON.stringify(activeEval.pick)}
                    </dd>

                    <dt className="text-muted">input_tokens</dt>
                    <dd className="font-mono tabular-nums">
                      {activeEval.input_tokens === null ? "null" : activeEval.input_tokens}
                    </dd>

                    <dt className="text-muted">output_tokens</dt>
                    <dd className="font-mono tabular-nums">
                      {activeEval.output_tokens === null ? "null" : activeEval.output_tokens}
                    </dd>

                    <dt className="text-muted">latency_ms</dt>
                    <dd className="font-mono tabular-nums">
                      {activeEval.latency_ms === null ? "null" : `${activeEval.latency_ms} ms`}
                    </dd>

                    <dt className="text-muted">backend</dt>
                    <dd className="break-all font-mono">
                      {activeEval.backend
                        ? activeEval.model_path
                          ? `${activeEval.backend} (${activeEval.model_path.split("/").pop()})`
                          : activeEval.backend
                        : "null"}
                    </dd>

                    <dt className="text-muted">option_scores</dt>
                    <dd className="font-mono">null (not exposed by litert-lm-rust 0.2.4)</dd>
                  </dl>

                  {activeEval.raw_output ? (
                    <details className="border-border rounded-lg border p-2.5 text-xs">
                      <summary className="text-foreground cursor-pointer font-medium">
                        Raw constrained output
                      </summary>
                      <pre className="text-muted mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap">
                        {activeEval.raw_output}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}

function LegendDot({color, label}: {color: string; label: string}) {
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2.5 rounded-full" style={{backgroundColor: color}} />
      <span className="text-muted text-xs">{label}</span>
    </div>
  );
}
