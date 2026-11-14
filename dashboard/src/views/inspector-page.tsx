"use client";

import type {InspectorConnection, InspectorState} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {Button, Card} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useCallback, useEffect, useMemo, useState} from "react";

import {useOutrider} from "../lib/outrider-store";

export function InspectorPage() {
  const {busy, fetchInspectorState, mutate, unlocked} = useOutrider();
  const [inspectorState, setInspectorState] = useState<InspectorState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    if (!unlocked) return;
    try {
      const next = await fetchInspectorState(null, 0);

      setInspectorState(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load inspector state");
    }
  }, [fetchInspectorState, unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    void (async () => {
      try {
        const next = await fetchInspectorState(null, 0);

        if (!cancelled) {
          setInspectorState(next);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load inspector state");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchInspectorState, unlocked]);

  const connectThisGateway = useCallback(async () => {
    const target = `${window.location.origin}/mcp`;

    await mutate("/inspector/connect", {
      headers: {},
      label: "This gateway",
      lifecycle: "2026-07-28",
      target,
      transport: "http",
    });
    await loadConnections();
  }, [loadConnections, mutate]);

  const columns = useMemo<DataGridColumn<InspectorConnection>[]>(
    () => [
      {
        accessorKey: "label",
        cell: (row) => <span className="font-mono text-xs font-medium">{row.label}</span>,
        header: "Connection",
        id: "label",
        isRowHeader: true,
        minWidth: 160,
      },
      {
        accessorKey: "transport",
        cell: (row) => <span className="font-mono text-xs">{row.transport}</span>,
        header: "Transport",
        id: "transport",
        minWidth: 100,
      },
      {
        accessorKey: "target",
        cell: (row) => (
          <span className="block max-w-[300px] truncate font-mono text-xs">{row.target}</span>
        ),
        header: "Target",
        id: "target",
        minWidth: 220,
      },
      {
        accessorKey: "status",
        cell: (row) => <span className="font-mono text-xs">{row.status}</span>,
        header: "Status",
        id: "status",
        minWidth: 120,
      },
    ],
    [],
  );

  const disabledReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : undefined;

  const displayedConnections = unlocked ? (inspectorState?.connections ?? []) : [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-sm text-pretty">
          Inspect live MCP 2026-07-28 and initialize connections persisted in SQLite.
        </p>
        <div className="flex items-center gap-2">
          <span title={disabledReason}>
            <Button
              isDisabled={Boolean(disabledReason)}
              size="sm"
              variant="secondary"
              onPress={() => void loadConnections()}
            >
              Reload State
            </Button>
          </span>
          <span title={disabledReason}>
            <Button
              isDisabled={Boolean(disabledReason)}
              size="sm"
              onPress={() => void connectThisGateway()}
            >
              Connect
            </Button>
          </span>
        </div>
      </div>

      {unlocked && loadError ? (
        <div className="border-danger/40 bg-danger/10 text-danger rounded-xl border p-3 text-xs">
          {loadError}
        </div>
      ) : null}

      <Card className="rounded-2xl">
        <Card.Header>
          <Card.Title className="text-base text-balance">Persisted Inspector Connections</Card.Title>
        </Card.Header>
        <Card.Content>
          <DataGrid
            aria-label="Connections"
            columns={columns}
            data={displayedConnections}
            getRowId={(row) => row.connection_id}
            renderEmptyState={() => (
              <span className="text-muted py-6 text-xs">
                {unlocked
                  ? "No inspector connections recorded yet."
                  : "Unlock with the admin token to inspect MCP connections."}
              </span>
            )}
          />
        </Card.Content>
      </Card>
    </div>
  );
}
