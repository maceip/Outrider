"use client";

import type {TrafficHead} from "../lib/types";
import type {Selection} from "@heroui/react";
import type {DataGridColumn, DataGridSortDescriptor} from "@heroui-pro/react";

import {Funnel} from "@gravity-ui/icons";
import {Button, Card, Chip, Dropdown, Label, SearchField} from "@heroui/react";
import {DataGrid, EmptyState, Segment} from "@heroui-pro/react";
import {Resizable} from "@heroui-pro/react/resizable";
import {useCallback, useMemo, useState} from "react";

import {useCoreStore} from "../lib/core-store";
import {
  TrafficDetailPane,
  formatTrafficBytes,
  renderTrafficStatusChip,
} from "../widgets/traffic-detail-pane";

type ProtocolBadge = "HTTP" | "HTTPS" | "MCP" | "WS";
type ProtocolFilter = "all" | ProtocolBadge;
type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx" | "pending";

const STATUS_FILTER_OPTIONS: ReadonlyArray<{id: StatusFilter; label: string}> = [
  {id: "all", label: "All"},
  {id: "2xx", label: "2xx"},
  {id: "3xx", label: "3xx"},
  {id: "4xx", label: "4xx"},
  {id: "5xx", label: "5xx"},
  {id: "pending", label: "Pending"},
];

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  "2xx": "2xx",
  "3xx": "3xx",
  "4xx": "4xx",
  "5xx": "5xx",
  all: "All",
  pending: "Pending",
};

function getUriPathname(uri: string): string {
  if (uri.startsWith("/")) {
    const clean = uri.split("?")[0]?.split("#")[0] ?? "";

    return clean;
  }
  try {
    return new URL(uri).pathname;
  } catch {
    return "";
  }
}

function getPacketProtocol(item: TrafficHead): ProtocolBadge {
  const pathname = getUriPathname(item.uri);

  if (pathname === "/mcp" || pathname === "/mcp/") {
    return "MCP";
  }
  if (item.websocket_id != null) {
    return "WS";
  }
  if (item.uri.startsWith("https:")) {
    return "HTTPS";
  }

  return "HTTP";
}

function matchesStatusFilter(status: number | null, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return status === null;
  if (status === null) return false;
  if (filter === "2xx") return status >= 200 && status < 300;
  if (filter === "3xx") return status >= 300 && status < 400;
  if (filter === "4xx") return status >= 400 && status < 500;
  if (filter === "5xx") return status >= 500 && status < 600;

  return true;
}

export function TrafficPage() {
  const {exportHar, traffics} = useCoreStore();

  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sortDescriptor, setSortDescriptor] = useState<DataGridSortDescriptor>({
    column: "id",
    direction: "descending",
  });

  const filteredTraffics = useMemo<TrafficHead[]>(() => {
    const query = search.trim().toLowerCase();

    return traffics.filter((item) => {
      const protocol = getPacketProtocol(item);

      if (protocolFilter !== "all" && protocol !== protocolFilter) {
        return false;
      }

      if (!matchesStatusFilter(item.status, statusFilter)) {
        return false;
      }

      if (!query) {
        return true;
      }

      const statusText = item.status === null ? "pending" : String(item.status);

      return (
        item.uri.toLowerCase().includes(query) ||
        item.method.toLowerCase().includes(query) ||
        statusText.includes(query) ||
        protocol.toLowerCase().includes(query) ||
        item.mime.toLowerCase().includes(query) ||
        String(item.id).includes(query) ||
        `#${item.id}`.includes(query)
      );
    });
  }, [protocolFilter, search, statusFilter, traffics]);

  const sortedTraffics = useMemo<TrafficHead[]>(() => {
    if (!sortDescriptor.column) return filteredTraffics;
    const col = String(sortDescriptor.column);
    const dir = sortDescriptor.direction === "descending" ? -1 : 1;

    return [...filteredTraffics].sort((a, b) => {
      if (col === "id") return (a.id - b.id) * dir;
      if (col === "protocol") return getPacketProtocol(a).localeCompare(getPacketProtocol(b)) * dir;
      if (col === "method") return a.method.localeCompare(b.method) * dir;
      if (col === "uri") return a.uri.localeCompare(b.uri) * dir;
      if (col === "status") return ((a.status ?? -1) - (b.status ?? -1)) * dir;
      if (col === "time") return ((a.time ?? -1) - (b.time ?? -1)) * dir;
      if (col === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;

      return 0;
    });
  }, [filteredTraffics, sortDescriptor]);

  const selectedHead = useMemo<TrafficHead | null>(
    () => (selectedId !== null ? (traffics.find((item) => item.id === selectedId) ?? null) : null),
    [selectedId, traffics],
  );

  const selectedKeys = useMemo<Selection>(
    () => (selectedId !== null && selectedHead !== null ? new Set([String(selectedId)]) : new Set()),
    [selectedHead, selectedId],
  );

  const handleRowSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const first = Array.from(keys)[0];

    if (first === undefined) {
      setSelectedId(null);

      return;
    }

    const parsed = typeof first === "number" ? first : Number(first);

    if (Number.isFinite(parsed)) {
      setSelectedId(parsed);
    }
  }, []);

  const handleRowAction = useCallback((key: string | number) => {
    const parsed = typeof key === "number" ? key : Number(key);

    if (Number.isFinite(parsed)) {
      setSelectedId(parsed);
    }
  }, []);

  const selectedStatusKeys = useMemo<Selection>(() => new Set([statusFilter]), [statusFilter]);

  const handleStatusChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];

    if (typeof next === "string") {
      setStatusFilter(next as StatusFilter);
    }
  }, []);

  const columns = useMemo<DataGridColumn<TrafficHead>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (item) => <span className="text-xs font-medium tabular-nums">#{item.id}</span>,
        header: "#",
        id: "id",
        isRowHeader: true,
        minWidth: 76,
        width: 84,
      },
      {
        allowsSorting: true,
        cell: (item) => {
          const protocol = getPacketProtocol(item);

          return (
            <Chip color={protocol === "MCP" ? "accent" : "default"} size="sm" variant="soft">
              {protocol}
            </Chip>
          );
        },
        header: "Protocol",
        id: "protocol",
        minWidth: 96,
        width: 108,
      },
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (item) => <span className="text-xs font-medium">{item.method}</span>,
        header: "Method",
        id: "method",
        minWidth: 88,
        width: 96,
      },
      {
        accessorKey: "uri",
        allowsSorting: true,
        cell: (item) => (
          <span className="block max-w-[480px] truncate text-xs" title={item.uri}>
            {item.uri}
          </span>
        ),
        header: "URL",
        id: "uri",
        minWidth: 260,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (item) => renderTrafficStatusChip(item.status),
        header: "Status",
        id: "status",
        minWidth: 96,
        width: 108,
      },
      {
        accessorKey: "time",
        align: "end",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted text-xs tabular-nums">
            {item.time !== null ? `${item.time} ms` : "—"}
          </span>
        ),
        header: "Time",
        id: "time",
        minWidth: 92,
        width: 104,
      },
      {
        accessorKey: "size",
        align: "end",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted text-xs tabular-nums">{formatTrafficBytes(item.size)}</span>
        ),
        header: "Size",
        id: "size",
        minWidth: 92,
        width: 104,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-7xl flex-col gap-3 px-5 pb-5 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            aria-label="Filter traffic"
            className="w-full sm:w-[280px]"
            name="traffic-monitor-search"
            value={search}
            variant="secondary"
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Filter by host, path, method, or status..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <Segment
            aria-label="Filter by protocol"
            selectedKey={protocolFilter}
            size="sm"
            onSelectionChange={(key) => setProtocolFilter(String(key) as ProtocolFilter)}
          >
            <Segment.Item id="all">All</Segment.Item>
            <Segment.Item id="HTTP">HTTP</Segment.Item>
            <Segment.Item id="HTTPS">HTTPS</Segment.Item>
            <Segment.Item id="MCP">MCP</Segment.Item>
            <Segment.Item id="WS">WebSocket</Segment.Item>
          </Segment>

          <Dropdown>
            <Button size="sm" variant="secondary">
              <Funnel className="size-4" />
              {statusFilter === "all" ? "Status" : STATUS_FILTER_LABELS[statusFilter]}
            </Button>
            <Dropdown.Popover placement="bottom start">
              <Dropdown.Menu
                disallowEmptySelection
                aria-label="Filter by status code"
                selectedKeys={selectedStatusKeys}
                selectionMode="single"
                onSelectionChange={handleStatusChange}
              >
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
                    <Label>{option.label}</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>

        <Button size="sm" variant="secondary" onPress={exportHar}>
          Export HAR
        </Button>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden rounded-2xl p-0">
        <Resizable orientation="vertical">
          <Resizable.Panel className="flex flex-col" defaultSize={55} minSize={25}>
            <DataGrid
              stickyHeader
              aria-label="Live packet stream"
              className="h-full min-h-0 flex-1 [&_.data-grid__empty-state]:py-6 [&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)] [&_.table__row[data-selected=true]_.table__cell]:bg-accent-soft/50"
              columns={columns}
              contentClassName="min-w-[780px]"
              data={sortedTraffics}
              getRowId={(item) => String(item.id)}
              renderEmptyState={() => (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>
                      {traffics.length === 0 ? "No Packets Captured" : "No Matching Packets"}
                    </EmptyState.Title>
                    <EmptyState.Description>
                      {traffics.length === 0
                        ? "Live proxy and MCP requests will stream here automatically."
                        : "Adjust your search query, protocol, or status filter."}
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              )}
              scrollContainerClassName="h-full overflow-auto"
              selectedKeys={selectedKeys}
              selectionBehavior="replace"
              selectionMode="single"
              sortDescriptor={sortDescriptor}
              variant="secondary"
              onRowAction={handleRowAction}
              onSelectionChange={handleRowSelectionChange}
              onSortChange={setSortDescriptor}
            />
          </Resizable.Panel>

          <Resizable.Handle aria-label="Resize packet panels" type="drag" />

          <Resizable.Panel className="flex flex-col" defaultSize={45} minSize={25}>
            <TrafficDetailPane selectedHead={selectedHead} selectedId={selectedId} />
          </Resizable.Panel>
        </Resizable>
      </Card>
    </div>
  );
}
