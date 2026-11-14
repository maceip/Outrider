"use client";

import {KPI} from "@heroui-pro/react/kpi";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";

export function AnalyticsKpiRow() {
  const {clefStatus, snapshot} = useOutrider();

  const stats = useMemo(() => {
    const evals = snapshot?.clef_evaluations ?? [];
    const verified = evals.filter((e) => e.status === "Verified").length;
    const completedProbes = (snapshot?.probe_runs ?? []).filter(
      (p) => p.status === "Completed",
    ).length;
    const mcpFrames = snapshot?.mcp_frames.length ?? 0;

    return {completedProbes, evalCount: evals.length, mcpFrames, verified};
  }, [snapshot]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KPI>
        <KPI.Header>
          <KPI.Title>CLEF Evaluations</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value className="tabular-nums" maximumFractionDigits={0} value={stats.evalCount} />
          <span className="text-muted text-xs">{formatClefState(clefStatus)}</span>
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Verified Picks</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value className="tabular-nums" maximumFractionDigits={0} value={stats.verified} />
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Completed Probes</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            value={stats.completedProbes}
          />
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>MCP Frames</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value className="tabular-nums" maximumFractionDigits={0} value={stats.mcpFrames} />
        </KPI.Content>
      </KPI>
    </div>
  );
}
