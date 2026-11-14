"use client";

import {KPI} from "@heroui-pro/react/kpi";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";

export function KpiRow() {
  const {clefStatus, lastUpdatedAt, publicStatus, snapshot, unlocked} = useOutrider();
  const observedPolicy = snapshot?.probe_policy ?? publicStatus?.probe_policy ?? null;

  const metrics = useMemo(() => {
    const sessions = snapshot?.agent_sessions.length ?? 0;
    const connectedPeers =
      snapshot?.active_peers.filter((peer) => peer.connected).length ?? 0;

    const nowUnix = lastUpdatedAt ? Math.floor(lastUpdatedAt / 1000) : 0;
    const receipts = snapshot?.capability_receipts ?? [];
    const activeReceipts = receipts.filter(
      (r) => !r.revoked && r.remaining_calls > 0 && r.expires_at_unix > nowUnix,
    ).length;

    const probes = snapshot?.probe_runs ?? [];
    const completedProbes = probes.filter((p) => p.status === "Completed").length;

    const evaluations = snapshot?.clef_evaluations.length ?? 0;

    return {
      activeReceipts,
      completedProbes,
      connectedPeers,
      evaluations,
      sessions,
      totalReceipts: receipts.length,
    };
  }, [lastUpdatedAt, snapshot]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KPI>
        <KPI.Header>
          <KPI.Title>Agent Sessions</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.sessions}
          />
          <span className="text-muted text-xs tabular-nums">
            {unlocked ? `${metrics.connectedPeers} live peers` : "Locked"}
          </span>
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>Active Receipts</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.activeReceipts}
          />
          <span className="text-muted text-xs tabular-nums">
            {unlocked ? `${metrics.totalReceipts} issued` : "Locked"}
          </span>
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
            style="decimal"
            value={metrics.completedProbes}
          />
          <span className="text-muted text-xs tabular-nums">
            Policy: {observedPolicy ?? "—"}
          </span>
        </KPI.Content>
      </KPI>

      <KPI>
        <KPI.Header>
          <KPI.Title>CLEF Evaluations</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <KPI.Value
            className="tabular-nums"
            maximumFractionDigits={0}
            style="decimal"
            value={metrics.evaluations}
          />
          <span className="text-muted text-xs">{formatClefState(clefStatus)}</span>
        </KPI.Content>
      </KPI>
    </div>
  );
}
