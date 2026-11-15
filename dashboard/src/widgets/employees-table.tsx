"use client";

import type {TrafficHead} from "../lib/types";
import type {Selection} from "@heroui/react";
import type {DataGridColumn, DataGridSortDescriptor} from "@heroui-pro/react";

import {Copy, Funnel} from "@gravity-ui/icons";
import {Button, Chip, Dropdown, Label, SearchField} from "@heroui/react";
import {DataGrid, EmptyState} from "@heroui-pro/react";
import {useCallback, useMemo, useState} from "react";

import {IconButton} from "../components/icon-button";
import {useCoreStore} from "../lib/core-store";

import {RowActions} from "./employees-table-row-actions";
import {filterDashboardTraffics, useEffectiveNowMs} from "./kpi-row";

type StatusFilter = "all" | "2xx" | "error" | "pending";

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  "2xx": "2xx",
  all: "All",
  error: "4xx / 5xx",
  pending: "Pending",
};

export function renderStatusChip(status: number | null) {
  if (status === null) {
    return (
      <Chip color="default" size="sm" variant="soft">
        Pending
      </Chip>
    );
  }
  if (status >= 400) {
    return (
      <Chip color="danger" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }
  if (status >= 300) {
    return (
      <Chip color="warning" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }

  return (
    <Chip color="success" size="sm" variant="soft">
      {status}
    </Chip>
  );
}

export function EmployeesTable() {
  const {copyTrafficCurl, dashboardPeriod, dashboardTab, traffics} = useCoreStore();
  const nowMs = useEffectiveNowMs(traffics);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortDescriptor, setSortDescriptor] = useState<DataGridSortDescriptor>({
    column: "id",
    direction: "descending",
  });

  const periodFiltered = useMemo(
    () => filterDashboardTraffics(traffics, dashboardPeriod, dashboardTab, nowMs),
    [traffics, dashboardPeriod, dashboardTab, nowMs],
  );

  const filteredRows = useMemo<TrafficHead[]>(() => {
    const query = search.trim().toLowerCase();

    return periodFiltered.filter((item) => {
      if (statusFilter === "2xx" && (item.status === null || item.status < 200 || item.status >= 300)) {
        return false;
      }
      if (statusFilter === "error" && (item.status === null || item.status < 400)) {
        return false;
      }
      if (statusFilter === "pending" && item.status !== null) {
        return false;
      }
      if (!query) return true;
      const statusText = item.status === null ? "pending" : String(item.status);

      return (
        String(item.id).includes(query) ||
        item.method.toLowerCase().includes(query) ||
        item.uri.toLowerCase().includes(query) ||
        statusText.includes(query) ||
        item.mime.toLowerCase().includes(query)
      );
    });
  }, [periodFiltered, search, statusFilter]);

  const sortedRows = useMemo<TrafficHead[]>(() => {
    if (!sortDescriptor.column) return filteredRows;
    const col = String(sortDescriptor.column);
    const dir = sortDescriptor.direction === "descending" ? -1 : 1;

    return [...filteredRows].sort((a, b) => {
      if (col === "id") return (a.id - b.id) * dir;
      if (col === "method") return a.method.localeCompare(b.method) * dir;
      if (col === "uri") return a.uri.localeCompare(b.uri) * dir;
      if (col === "status") return ((a.status ?? -1) - (b.status ?? -1)) * dir;
      if (col === "time") return ((a.time ?? -1) - (b.time ?? -1)) * dir;

      return 0;
    });
  }, [filteredRows, sortDescriptor]);

  const selectedStatusKeys = useMemo<Selection>(() => new Set([statusFilter]), [statusFilter]);

  const handleStatusSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];

    if (next) {
      setStatusFilter(String(next) as StatusFilter);
    }
  }, []);

  const columns = useMemo<DataGridColumn<TrafficHead>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (item) => (
          <div className="flex items-center gap-2">
            <span className="font-medium tabular-nums">#{item.id}</span>
            <IconButton
              label="Copy cURL"
              size="sm"
              variant="ghost"
              onPress={() => void copyTrafficCurl(item.id)}
            >
              <Copy className="text-muted size-3.5" />
            </IconButton>
          </div>
        ),
        header: "ID",
        id: "id",
        isRowHeader: true,
        minWidth: 120,
      },
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (item) => <span className="text-xs font-medium">{item.method}</span>,
        header: "Method",
        id: "method",
        minWidth: 100,
      },
      {
        accessorKey: "uri",
        allowsSorting: true,
        cell: (item) => (
          <span className="block max-w-[420px] truncate text-xs" title={item.uri}>
            {item.uri}
          </span>
        ),
        header: "URL",
        id: "uri",
        minWidth: 280,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (item) => renderStatusChip(item.status),
        header: "Status",
        id: "status",
        minWidth: 110,
      },
      {
        accessorKey: "time",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted tabular-nums">
            {item.time !== null ? `${item.time} ms` : "—"}
          </span>
        ),
        header: "Latency",
        id: "time",
        minWidth: 110,
      },
      {
        align: "end",
        cell: (item) => <RowActions item={item} />,
        header: "Actions",
        id: "actions",
        minWidth: 90,
      },
    ],
    [copyTrafficCurl],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground text-base font-semibold">Recent Traffic</span>
          <Chip size="sm" variant="soft">
            {sortedRows.length}
          </Chip>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="tertiary">
                <Funnel className="size-4" />
                {statusFilter === "all" ? "Status" : STATUS_FILTER_LABELS[statusFilter]}
              </Button>
              <Dropdown.Popover placement="bottom start">
                <Dropdown.Menu
                  disallowEmptySelection
                  aria-label="Filter by status"
                  selectedKeys={selectedStatusKeys}
                  selectionMode="single"
                  onSelectionChange={handleStatusSelectionChange}
                >
                  <Dropdown.Item id="all" textValue="All">
                    <Label>All</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="2xx" textValue="2xx">
                    <Label>2xx</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="error" textValue="4xx / 5xx">
                    <Label>4xx / 5xx</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="pending" textValue="Pending">
                    <Label>Pending</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
          <SearchField
            aria-label="Search traffic"
            className="w-full sm:w-[220px]"
            name="traffic-search"
            value={search}
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
      </div>

      <DataGrid
        aria-label="Recent traffic"
        columns={columns}
        contentClassName="min-w-[760px]"
        data={sortedRows}
        getRowId={(item) => item.id}
        renderEmptyState={() => (
          <div className="py-6">
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Title>No traffic recorded</EmptyState.Title>
                <EmptyState.Description>
                  Requests routed through the gateway will appear here.
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          </div>
        )}
        sortDescriptor={sortDescriptor}
        onSortChange={setSortDescriptor}
      />
    </div>
  );
}
