"use client";

import type {TrafficHead} from "../lib/types";
import type {DataGridColumn, DataGridSortDescriptor} from "@heroui-pro/react";

import {Chip} from "@heroui/react";
import {DataGrid, EmptyState} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {useCoreStore} from "../lib/core-store";

import {filterAnalyticsTraffics} from "./analytics-kpi-row";
import {renderStatusChip} from "./employees-table";
import {getTrafficProtocol, useEffectiveNowMs} from "./kpi-row";

function formatBytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function TopPagesCard() {
  const {timeRange, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const [sortDescriptor, setSortDescriptor] = useState<DataGridSortDescriptor>({
    column: "",
    direction: "descending",
  });

  const rangeTraffics = useMemo(
    () => filterAnalyticsTraffics(traffics, timeRange, nowMs),
    [traffics, timeRange, nowMs],
  );

  const sortedRows = useMemo<TrafficHead[]>(() => {
    if (!sortDescriptor.column) {
      return rangeTraffics;
    }
    const col = String(sortDescriptor.column);
    const dir = sortDescriptor.direction === "descending" ? -1 : 1;

    return [...rangeTraffics].sort((a, b) => {
      if (col === "method") return a.method.localeCompare(b.method) * dir;
      if (col === "uri") return a.uri.localeCompare(b.uri) * dir;
      if (col === "status") return ((a.status ?? -1) - (b.status ?? -1)) * dir;
      if (col === "type") return getTrafficProtocol(a).localeCompare(getTrafficProtocol(b)) * dir;
      if (col === "time") return ((a.time ?? -1) - (b.time ?? -1)) * dir;
      if (col === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;

      return 0;
    });
  }, [rangeTraffics, sortDescriptor]);

  const columns = useMemo<DataGridColumn<TrafficHead>[]>(
    () => [
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (item) => <span className="font-mono text-xs font-semibold">{item.method}</span>,
        header: "Method",
        id: "method",
        minWidth: 100,
      },
      {
        accessorKey: "uri",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="block max-w-[420px] truncate font-mono text-xs font-medium"
            title={item.uri}
          >
            {item.uri}
          </span>
        ),
        header: "URL",
        id: "uri",
        isRowHeader: true,
        minWidth: 260,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (item) => renderStatusChip(item.status),
        header: "Status",
        id: "status",
        minWidth: 100,
      },
      {
        allowsSorting: true,
        cell: (item) => <span className="text-muted font-mono text-xs">{getTrafficProtocol(item)}</span>,
        header: "Type",
        id: "type",
        minWidth: 110,
      },
      {
        accessorKey: "time",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {item.time !== null ? `${item.time} ms` : "—"}
          </span>
        ),
        header: "Latency",
        id: "time",
        minWidth: 110,
      },
      {
        accessorKey: "size",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatBytes(item.size)}
          </span>
        ),
        header: "Size",
        id: "size",
        minWidth: 110,
      },
    ],
    [],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-foreground text-base font-semibold">Live events</h2>
          <Chip className="tabular-nums" size="sm" variant="soft">
            {sortedRows.length}
          </Chip>
        </div>
        <p className="text-muted text-xs">Captured requests over the selected time range.</p>
      </div>
      <DataGrid
        aria-label="Live events"
        columns={columns}
        contentClassName="min-w-[680px]"
        data={sortedRows}
        getRowId={(item) => item.id}
        renderEmptyState={() => (
          <div className="py-6">
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>No live events</EmptyState.Title>
                <EmptyState.Description>
                  Captured gateway requests in the selected range will appear here.
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          </div>
        )}
        sortDescriptor={sortDescriptor}
        onSortChange={setSortDescriptor}
      />
    </section>
  );
}
