"use client";

import type {AgentSession} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {Chip} from "@heroui/react";
import {DataGrid, KPIGroup} from "@heroui-pro/react";
import {KPI} from "@heroui-pro/react/kpi";
import {Fragment, useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

const SESSION_STATES = ["Unprobed", "Probed", "CLEF Evaluated", "Entitled"] as const;

export function TrackerPage() {
  const {snapshot, unlocked} = useOutrider();

  const sessions = useMemo(() => snapshot?.agent_sessions ?? [], [snapshot?.agent_sessions]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {
      "CLEF Evaluated": 0,
      Entitled: 0,
      Probed: 0,
      Unprobed: 0,
    };

    for (const s of sessions) {
      map[s.state] = (map[s.state] ?? 0) + 1;
    }

    return map;
  }, [sessions]);

  const columns = useMemo<DataGridColumn<AgentSession>[]>(
    () => [
      {
        accessorKey: "session_id",
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            {row.session_id.slice(0, 14)}
          </span>
        ),
        header: "Session ID",
        id: "session_id",
        isRowHeader: true,
        minWidth: 150,
      },
      {
        cell: (row) => (
          <span className="text-xs font-medium">
            {row.client_config?.clientInfo?.name || "Unreported MCP client"}
          </span>
        ),
        header: "Client",
        id: "client",
        minWidth: 200,
      },
      {
        accessorKey: "transport",
        cell: (row) => <span className="font-mono text-xs">{row.transport}</span>,
        header: "Transport",
        id: "transport",
        minWidth: 110,
      },
      {
        accessorKey: "state",
        cell: (row) => (
          <Chip
            color={
              row.state === "Entitled"
                ? "success"
                : row.state === "CLEF Evaluated"
                  ? "accent"
                  : "default"
            }
            size="sm"
            variant="soft"
          >
            {row.state}
          </Chip>
        ),
        header: "State",
        id: "state",
        minWidth: 140,
      },
      {
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {new Date(row.created_at * 1000).toLocaleTimeString()}
          </span>
        ),
        header: "Created",
        id: "created_at",
        minWidth: 120,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm text-pretty">
        Persisted agent sessions, TLS/HTTP handshake observations, and active probe runs.
      </p>

      <KPIGroup>
        {SESSION_STATES.map((stateName, index) => (
          <Fragment key={stateName}>
            {index > 0 ? <KPIGroup.Separator /> : null}
            <KPI>
              <KPI.Header>
                <KPI.Title>{stateName}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value
                  className="tabular-nums"
                  maximumFractionDigits={0}
                  value={counts[stateName] ?? 0}
                />
              </KPI.Content>
            </KPI>
          </Fragment>
        ))}
      </KPIGroup>

      <DataGrid
        aria-label="Recorded agent sessions"
        columns={columns}
        contentClassName="min-w-[740px]"
        data={sessions}
        getRowId={(item) => item.session_id}
        renderEmptyState={() => (
          <span className="text-muted py-6 text-xs">
            {unlocked
              ? "No agent sessions recorded yet."
              : "Unlock with the admin token to inspect session evidence."}
          </span>
        )}
      />
    </div>
  );
}
