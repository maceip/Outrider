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
} from "./traffic-detail-pane";

export type WireProtocolBadge = "HTTP" | "HTTPS" | "MCP" | "WS";
type ProtocolFilter = "all" | WireProtocolBadge;
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
    return uri.split("?")[0]?.split("#")[0] ?? "";
  }
  try {
    return new URL(uri).pathname;
  } catch {
    return "";
  }
}

export function getPacketProtocol(item: TrafficHead): WireProtocolBadge {
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

export interface WireEvidencePanelProps {
  selectedPacketId: number | null;
  onSelectPacketId: (id: number | null) => void;
}

export function WireEvidencePanel({
  onSelectPacketId,
  selectedPacketId,
}: WireEvidencePanelProps) {
  const {traffics} = useCoreStore();

  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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

  const effectiveSelectedHead = useMemo<TrafficHead | null>(() => {
    if (selectedPacketId !== null) {
      const explicit = traffics.find((item) => item.id === selectedPacketId);

      if (explicit) return explicit;
    }

    return sortedTraffics[0] ?? null;
  }, [selectedPacketId, sortedTraffics, traffics]);

  const selectedKeys = useMemo<Selection>(
    () =>
      effectiveSelectedHead !== null ? new Set([String(effectiveSelectedHead.id)]) : new Set(),
    [effectiveSelectedHead],
  );

  const handleRowSelectionChange = useCallback(
    (keys: Selection) => {
      if (keys === "all") return;
      const first = Array.from(keys)[0];

      if (first === undefined) {
        onSelectPacketId(null);

        return;
      }

      const parsed = typeof first === "number" ? first : Number(first);

      if (Number.isFinite(parsed)) {
        onSelectPacketId(parsed);
      }
    },
    [onSelectPacketId],
  );

  const handleRowAction = useCallback(
    (key: string | number) => {
      const parsed = typeof key === "number" ? key : Number(key);

      if (Number.isFinite(parsed)) {
        onSelectPacketId(parsed);
      }
    },
    [onSelectPacketId],
  );

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
        cell: (item) => (
          <span className="text-muted font-mono text-xs font-medium tabular-nums">#{item.id}</span>
        ),
        header: "#",
        id: "id",
        isRowHeader: true,
        minWidth: 64,
        width: 72,
      },
      {
        allowsSorting: true,
        cell: (item) => {
          const protocol = getPacketProtocol(item);

          return (
            <Chip
              className="font-mono tabular-nums"
              color={protocol === "MCP" ? "accent" : "default"}
              size="sm"
              variant="soft"
            >
              {protocol}
            </Chip>
          );
        },
        header: "Protocol",
        id: "protocol",
        minWidth: 90,
        width: 98,
      },
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-foreground font-mono text-xs font-semibold tabular-nums">
            {item.method}
          </span>
        ),
        header: "Method",
        id: "method",
        minWidth: 80,
        width: 88,
      },
      {
        accessorKey: "uri",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="text-foreground block max-w-[360px] truncate font-mono text-xs tabular-nums"
            title={item.uri}
          >
            {item.uri}
          </span>
        ),
        header: "Endpoint",
        id: "uri",
        minWidth: 200,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (item) => renderTrafficStatusChip(item.status),
        header: "Status",
        id: "status",
        minWidth: 84,
        width: 92,
      },
      {
        accessorKey: "time",
        align: "end",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {item.time !== null ? `${item.time} ms` : "—"}
          </span>
        ),
        header: "Latency",
        id: "time",
        minWidth: 84,
        width: 92,
      },
      {
        accessorKey: "size",
        align: "end",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatTrafficBytes(item.size)}
          </span>
        ),
        header: "Size",
        id: "size",
        minWidth: 84,
        width: 92,
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-[540px] flex-1 flex-col gap-2.5 overflow-hidden p-3 lg:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <SearchField
            aria-label="Filter wire frames"
            className="w-full sm:w-56"
            name="wire-evidence-search"
            value={search}
            variant="secondary"
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                className="font-mono text-xs"
                placeholder="Filter endpoint, method, status..."
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <div className="max-w-full overflow-x-auto">
            <Segment
              aria-label="Filter by protocol"
              className="shrink-0"
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
          </div>

          <Dropdown>
            <Button className="shrink-0" size="sm" variant="tertiary">
              <Funnel aria-hidden="true" className="size-3.5 shrink-0" />
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
                    <Label className="font-mono text-xs tabular-nums">{option.label}</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>

        <Chip className="font-mono tabular-nums" size="sm" variant="soft">
          {`${sortedTraffics.length} frames`}
        </Chip>
      </div>

      <div className="h-[460px] min-h-0 flex-1 overflow-hidden lg:h-auto">
        <Resizable orientation="vertical">
          <Resizable.Panel className="min-h-0 overflow-hidden pb-1.5" defaultSize={46} minSize={26}>
            <Card className="h-full overflow-hidden p-0">
              <DataGrid
                stickyHeader
                aria-label="Live packet stream"
                className="h-full [&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)]"
                columns={columns}
                contentClassName="min-w-[640px]"
                data={sortedTraffics}
                getRowId={(item) => String(item.id)}
                renderEmptyState={() => (
                  <div className="py-8">
                    <EmptyState size="sm">
                      <EmptyState.Header>
                        <EmptyState.Title>No Wire Frames Recorded</EmptyState.Title>
                        <EmptyState.Description>
                          {traffics.length === 0
                            ? "Proxied HTTP, HTTPS, MCP, and WebSocket exchanges appear here as buyer agents transact."
                            : "No wire frames match the active protocol or status filters."}
                        </EmptyState.Description>
                      </EmptyState.Header>
                    </EmptyState>
                  </div>
                )}
                selectedKeys={selectedKeys}
                selectionBehavior="replace"
                selectionMode="single"
                sortDescriptor={sortDescriptor}
                variant="secondary"
                onRowAction={handleRowAction}
                onSelectionChange={handleRowSelectionChange}
                onSortChange={setSortDescriptor}
              />
            </Card>
          </Resizable.Panel>

          <Resizable.Handle aria-label="Resize wire frame inspector" variant="secondary" />

          <Resizable.Panel className="min-h-0 overflow-hidden pt-1.5" defaultSize={54} minSize={30}>
            <Card className="h-full overflow-hidden p-0">
              <TrafficDetailPane
                selectedHead={effectiveSelectedHead}
                selectedId={effectiveSelectedHead?.id ?? null}
              />
            </Card>
          </Resizable.Panel>
        </Resizable>
      </div>
    </div>
  );
}
