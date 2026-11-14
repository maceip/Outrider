"use client";

import type {Key} from "react";

import {Button} from "@heroui/react";
import {Segment} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {useOutrider} from "../lib/outrider-store";
import {AnalyticsKpiRow} from "../widgets/analytics-kpi-row";
import {DeviceBreakdownCard} from "../widgets/device-breakdown-card";
import {SessionsOverTimeCard} from "../widgets/sessions-over-time-card";
import {TopChannelsCard} from "../widgets/top-channels-card";
import {TopPagesCard} from "../widgets/top-pages-card";

const TELEMETRY_SCOPES = ["All", "CLEF", "Audit"] as const;
type TelemetryScope = (typeof TELEMETRY_SCOPES)[number];

export function AnalyticsPage() {
  const {
    busy,
    clefStatus,
    openDialog,
    selectedSession,
    setSelectedSessionId,
    snapshot,
    unlocked,
  } = useOutrider();
  const [scope, setScope] = useState<TelemetryScope>("All");

  const sessionCount = snapshot?.agent_sessions.length ?? 0;

  const clefEvalDisabledReason = useMemo(() => {
    if (!unlocked) {
      return "Admin token required — unlock above to run CLEF evaluations.";
    }
    if (busy) {
      return "Backend action in progress.";
    }
    if (sessionCount === 0) {
      return "No agent session recorded — connect an MCP client before running CLEF.";
    }
    if (clefStatus?.status === "ModelError") {
      return `CLEF ModelError: ${clefStatus.error}`;
    }
    if (clefStatus?.status !== "Ready") {
      return "CLEF Unconfigured — start Outrider with a .litertlm model to evaluate sessions.";
    }

    return undefined;
  }, [busy, clefStatus, sessionCount, unlocked]);

  const handleRunClefEval = () => {
    if (!selectedSession && snapshot?.agent_sessions[0]) {
      setSelectedSessionId(snapshot.agent_sessions[0].session_id);
    }
    openDialog("evaluate-clef");
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-muted text-sm text-pretty">
            Measured CLEF evaluations, token budgets, passive fingerprints, MCP frame methods, and
            persisted admin audit events.
          </p>
          {clefEvalDisabledReason ? (
            <p className="text-muted text-xs text-pretty" id="analytics-clef-reason">
              {clefEvalDisabledReason}
            </p>
          ) : selectedSession ? (
            <p className="text-muted font-mono text-xs tabular-nums">
              Target session: {selectedSession.session_id.slice(0, 12)} ({selectedSession.transport})
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segment
            aria-label="Telemetry scope"
            selectedKey={scope}
            size="sm"
            onSelectionChange={(key: Key) => setScope(String(key) as TelemetryScope)}
          >
            {TELEMETRY_SCOPES.map((item) => (
              <Segment.Item key={item} id={item}>
                {item}
              </Segment.Item>
            ))}
          </Segment>

          <span title={clefEvalDisabledReason ?? "Run schema-constrained CLEF evaluation"}>
            <Button
              aria-describedby={clefEvalDisabledReason ? "analytics-clef-reason" : undefined}
              isDisabled={Boolean(clefEvalDisabledReason)}
              size="sm"
              variant="primary"
              onPress={handleRunClefEval}
            >
              Run CLEF Eval
            </Button>
          </span>
        </div>
      </div>

      <AnalyticsKpiRow />

      {scope !== "Audit" ? <SessionsOverTimeCard /> : null}

      {scope === "All" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <DeviceBreakdownCard />
          <TopChannelsCard />
        </div>
      ) : null}

      {scope !== "CLEF" ? <TopPagesCard /> : null}
    </div>
  );
}
