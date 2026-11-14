"use client";

import {KPI} from "@heroui-pro/react/kpi";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";

export function AnalyticsKpiRow() {
  const {clefStatus, snapshot, unlocked} = useOutrider();

  const metrics = useMemo(() => {
    const evals = snapshot?.clef_evaluations ?? [];
    const verifiedEvals = evals.filter((e) => e.status === "Verified").length;

    let inputTokens = 0;
    let outputTokens = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const evaluation of evals) {
      inputTokens += evaluation.input_tokens ?? 0;
      outputTokens += evaluation.output_tokens ?? 0;
      if (evaluation.latency_ms !== null) {
        latencySum += evaluation.latency_ms;
        latencyCount += 1;
      }
    }

    const totalTokens = inputTokens + outputTokens;
    const meanLatencyMs = latencyCount > 0 ? latencySum / latencyCount : 0;

    const auditLog = snapshot?.admin_audit_log ?? [];
    const auditEvents = auditLog.length;
    const latestAuditAction = auditLog[0]?.action ?? null;

    return {
      auditEvents,
      evalCount: evals.length,
      inputTokens,
      latencyCount,
      latestAuditAction,
      meanLatencyMs,
      outputTokens,
      totalTokens,
      verifiedEvals,
    };
  }, [snapshot]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KPI>
        <KPI.Header>
          <KPI.Title>Verified CLEF Evals</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.verifiedEvals}
          />
          <span className="text-muted text-xs tabular-nums">
            {unlocked
              ? `${metrics.evalCount} total · ${clefStatus ? formatClefState(clefStatus) : "—"}`
              : clefStatus
                ? formatClefState(clefStatus)
                : "Locked"}
          </span>
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Total CLEF Tokens</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.totalTokens}
          />
          <span className="text-muted text-xs tabular-nums">
            {unlocked ? `${metrics.inputTokens} in · ${metrics.outputTokens} out` : "Locked"}
          </span>
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Mean CLEF Latency (ms)</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={1}
            minimumFractionDigits={0}
            style="decimal"
            value={metrics.meanLatencyMs}
          />
          <span className="text-muted text-xs tabular-nums">
            {unlocked ? `${metrics.latencyCount} measured` : "Locked"}
          </span>
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Admin Audit Events</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.auditEvents}
          />
          <span className="text-muted truncate font-mono text-xs">
            {unlocked
              ? metrics.latestAuditAction
                ? `Latest: ${metrics.latestAuditAction}`
                : "No mutations recorded"
              : "Locked"}
          </span>
        </KPI.Content>
      </KPI>
    </div>
  );
}
