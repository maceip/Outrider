"use client";

import type {Key} from "react";

import {Segment} from "@heroui-pro/react";
import {useState} from "react";

import {AnalyticsKpiRow} from "../widgets/analytics-kpi-row";
import {DeviceBreakdownCard} from "../widgets/device-breakdown-card";
import {SessionsOverTimeCard} from "../widgets/sessions-over-time-card";
import {TopChannelsCard} from "../widgets/top-channels-card";
import {TopPagesCard} from "../widgets/top-pages-card";

const TELEMETRY_SCOPES = ["All", "CLEF", "Audit"] as const;
type TelemetryScope = (typeof TELEMETRY_SCOPES)[number];

export function AnalyticsPage() {
  const [scope, setScope] = useState<TelemetryScope>("All");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted text-sm text-pretty">
          Measured CLEF token budgets, transport distributions, and admin audit events.
        </p>
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
