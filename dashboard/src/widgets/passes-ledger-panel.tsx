"use client";

import type {Bundle, CapabilityReceiptRow} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {Calendar, Funnel, Plus} from "@gravity-ui/icons";
import {
  Avatar,
  Button,
  Card,
  Chip,
  Drawer,
  Dropdown,
  Form,
  Input,
  Label,
  ScrollShadow,
  SearchField,
  TextField,
  toast,
} from "@heroui/react";
import {DataGrid, EmptyState, Segment} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {useCoreStore} from "../lib/core-store";

import {OrdersRowActions} from "./orders-row-actions";

type OrdersSegment = "passes" | "bundles";
export type PassStatus = "Active" | "Revoked" | "Exhausted";
type StatusFilter = "all" | "active" | "revoked" | "exhausted";
type DateFilter = "all" | "7d" | "30d" | "90d";

const STATUS_COLORS: Record<PassStatus, "success" | "danger" | "default"> = {
  Active: "success",
  Exhausted: "default",
  Revoked: "danger",
};

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  active: "Active",
  all: "All",
  exhausted: "Exhausted",
  revoked: "Revoked",
};

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  "30d": "Last 30 days",
  "7d": "Last 7 days",
  "90d": "Last 90 days",
  all: "All time",
};

const DATE_FILTER_SECONDS: Record<Exclude<DateFilter, "all">, number> = {
  "30d": 30 * 86_400,
  "7d": 7 * 86_400,
  "90d": 90 * 86_400,
};

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

export function getPassStatus(row: CapabilityReceiptRow): PassStatus {
  if (row.revoked !== 0) return "Revoked";
  if (row.remaining_calls <= 0) return "Exhausted";

  return "Active";
}

function getSubjectInitials(subject: string): string {
  const parts = subject
    .trim()
    .split(/[\s:._/-]+/)
    .filter(Boolean);

  if (parts.length === 0) return "CD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function formatIssuedDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", DATE_FORMAT_OPTIONS);
}

export interface PassesLedgerPanelProps {
  activeBuyerAgent?: string | null;
}

export function PassesLedgerPanel({activeBuyerAgent}: PassesLedgerPanelProps) {
  const {busy, mutate, snapshot} = useCoreStore();
  const [activeSegment, setActiveSegment] = useState<OrdersSegment>("passes");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateRange, setDateRange] = useState<{cutoffSeconds: number | null; id: DateFilter}>({
    cutoffSeconds: null,
    id: "all",
  });
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [issueSubject, setIssueSubject] = useState("");
  const [issueBundleOverride, setIssueBundleOverride] = useState<string | null>(null);
  const [issueMaxCalls, setIssueMaxCalls] = useState("10");
  const [issueTtlHours, setIssueTtlHours] = useState("24");

  const passes = useMemo(() => snapshot?.capability_receipts ?? [], [snapshot]);
  const bundles = useMemo(() => snapshot?.bundles ?? [], [snapshot]);
  const defaultBundleId = bundles[0]?.bundle_id ?? "conduit_session_evidence";
  const effectiveBundleId = issueBundleOverride ?? defaultBundleId;

  const activePassCountByBundle = useMemo(() => {
    const counts = new Map<string, number>();

    for (const row of passes) {
      if (getPassStatus(row) === "Active") {
        counts.set(row.bundle_id, (counts.get(row.bundle_id) ?? 0) + 1);
      }
    }

    return counts;
  }, [passes]);

  const handleOpenIssueDrawer = (bundleOverride?: string) => {
    if (bundleOverride) {
      setIssueBundleOverride(bundleOverride);
    }
    if (!issueSubject.trim() && activeBuyerAgent) {
      setIssueSubject(activeBuyerAgent);
    }
    setIsIssueOpen(true);
  };

  const handleIssuePass = async () => {
    const trimmedSubject = issueSubject.trim();
    const trimmedBundleId = effectiveBundleId.trim();
    const parsedMaxCalls = Number.parseInt(issueMaxCalls.trim(), 10);
    const parsedTtlHours = Number.parseInt(issueTtlHours.trim(), 10);

    if (!trimmedSubject) {
      toast.danger("Enter a buyer subject");

      return;
    }
    if (!trimmedBundleId) {
      toast.danger("Enter a bundle identifier");

      return;
    }
    if (!Number.isFinite(parsedMaxCalls) || parsedMaxCalls < 1) {
      toast.danger("Max calls must be at least 1");

      return;
    }
    if (!Number.isFinite(parsedTtlHours) || parsedTtlHours < 1) {
      toast.danger("Validity hours must be at least 1");

      return;
    }

    try {
      const bundleExists = bundles.some((bundle) => bundle.bundle_id === trimmedBundleId);

      if (!bundleExists) {
        const catalogItems = snapshot?.catalog_items ?? [];
        const matchedCatalogItem =
          catalogItems.find((item) => item.item_id === trimmedBundleId)?.item_id ??
          catalogItems[0]?.item_id ??
          "conduit_session_evidence";

        await mutate("/bundles/put", {
          bundle_id: trimmedBundleId,
          items: [matchedCatalogItem],
          rules: {},
          title: trimmedBundleId,
        });
      }

      const expiresAtUnix = Math.floor(Date.now() / 1000) + parsedTtlHours * 3600;

      await mutate("/receipts/issue", {
        bundle_id: trimmedBundleId,
        expires_at_unix: expiresAtUnix,
        max_calls: parsedMaxCalls,
        subject: trimmedSubject,
      });

      setIssueSubject("");
      setIsIssueOpen(false);
      toast.success("Session pass issued");
    } catch {
      // Error toast is handled by mutate().
    }
  };

  const filteredPasses = useMemo(() => {
    const query = search.trim().toLowerCase();
    const {cutoffSeconds} = dateRange;

    return passes.filter((row) => {
      if (statusFilter !== "all") {
        const status = getPassStatus(row).toLowerCase();

        if (status !== statusFilter) return false;
      }

      if (cutoffSeconds !== null && row.created_at < cutoffSeconds) {
        return false;
      }

      if (query) {
        const matchesQuery =
          row.receipt_id.toLowerCase().includes(query) ||
          row.bundle_id.toLowerCase().includes(query) ||
          row.subject.toLowerCase().includes(query);

        if (!matchesQuery) return false;
      }

      return true;
    });
  }, [dateRange, passes, search, statusFilter]);

  const filteredBundles = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return bundles;

    return bundles.filter(
      (bundle) =>
        bundle.bundle_id.toLowerCase().includes(query) ||
        bundle.title.toLowerCase().includes(query) ||
        bundle.items.some((cap) => cap.toLowerCase().includes(query)),
    );
  }, [bundles, search]);

  const passColumns = useMemo<DataGridColumn<CapabilityReceiptRow>[]>(
    () => [
      {
        accessorKey: "receipt_id",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="block max-w-[180px] truncate font-mono text-xs font-medium tabular-nums"
            title={item.receipt_id}
          >
            {item.receipt_id}
          </span>
        ),
        header: "Pass ID",
        id: "receipt_id",
        isRowHeader: true,
        minWidth: 140,
      },
      {
        accessorKey: "subject",
        allowsSorting: true,
        cell: (item) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="border-border bg-surface-secondary text-foreground size-7 shrink-0 rounded-lg border">
              <Avatar.Fallback className="bg-surface-secondary text-foreground font-mono text-[11px] font-semibold">
                {getSubjectInitials(item.subject)}
              </Avatar.Fallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-foreground truncate font-mono text-xs font-medium">
                {item.subject}
              </span>
              <span className="text-muted truncate font-mono text-[11px]">{item.bundle_id}</span>
            </div>
          </div>
        ),
        header: "Buyer & Bundle",
        id: "subject",
        minWidth: 190,
      },
      {
        allowsSorting: true,
        cell: (item) => {
          const passStatus = getPassStatus(item);

          return (
            <Chip color={STATUS_COLORS[passStatus]} size="sm" variant="soft">
              {passStatus}
            </Chip>
          );
        },
        header: "Status",
        id: "status",
        minWidth: 100,
        sortFn: (a, b) => getPassStatus(a).localeCompare(getPassStatus(b)),
      },
      {
        allowsSorting: true,
        cell: (item) => (
          <span className="font-mono text-xs tabular-nums">
            {item.remaining_calls} / {item.max_calls}
          </span>
        ),
        header: "Calls",
        id: "calls",
        minWidth: 96,
        sortFn: (a, b) => a.remaining_calls - b.remaining_calls,
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatIssuedDate(item.created_at)}
          </span>
        ),
        header: "Issued",
        id: "created_at",
        minWidth: 112,
        sortFn: (a, b) => a.created_at - b.created_at,
      },
      {
        align: "end",
        cell: (item) => (
          <OrdersRowActions isRevoked={item.revoked !== 0} receiptId={item.receipt_id} />
        ),
        header: "Actions",
        id: "actions",
        minWidth: 84,
      },
    ],
    [],
  );

  const bundleColumns = useMemo<DataGridColumn<Bundle>[]>(
    () => [
      {
        accessorKey: "bundle_id",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="block max-w-[200px] truncate font-mono text-xs font-medium"
            title={item.bundle_id}
          >
            {item.bundle_id}
          </span>
        ),
        header: "Bundle ID",
        id: "bundle_id",
        isRowHeader: true,
        minWidth: 160,
      },
      {
        accessorKey: "title",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-foreground truncate text-xs font-medium">{item.title}</span>
        ),
        header: "Title",
        id: "title",
        minWidth: 150,
      },
      {
        cell: (item) => (
          <span
            className="text-muted block max-w-[260px] truncate font-mono text-xs"
            title={item.items.join(", ")}
          >
            {item.items.length > 0 ? item.items.join(", ") : "—"}
          </span>
        ),
        header: "Capabilities",
        id: "items",
        minWidth: 180,
      },
      {
        allowsSorting: true,
        cell: (item) => (
          <span className="font-mono text-xs tabular-nums">
            {activePassCountByBundle.get(item.bundle_id) ?? 0}
          </span>
        ),
        header: "Active Passes",
        id: "active_passes",
        minWidth: 108,
        sortFn: (a, b) =>
          (activePassCountByBundle.get(a.bundle_id) ?? 0) -
          (activePassCountByBundle.get(b.bundle_id) ?? 0),
      },
      {
        align: "end",
        cell: (item) => (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onPress={() => handleOpenIssueDrawer(item.bundle_id)}
            >
              Issue Pass
            </Button>
          </div>
        ),
        header: "Actions",
        id: "actions",
        minWidth: 108,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePassCountByBundle, activeBuyerAgent, issueSubject],
  );

  const visibleCount = activeSegment === "passes" ? filteredPasses.length : filteredBundles.length;

  return (
    <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segment
            aria-label="Orders workspace"
            selectedKey={activeSegment}
            size="sm"
            onSelectionChange={(key) => setActiveSegment(String(key) as OrdersSegment)}
          >
            <Segment.Item id="passes">Session Passes</Segment.Item>
            <Segment.Item id="bundles">Bundles</Segment.Item>
          </Segment>
          <Chip className="font-mono tabular-nums" size="sm" variant="soft">
            {visibleCount}
          </Chip>
        </div>

        <Drawer isOpen={isIssueOpen} onOpenChange={setIsIssueOpen}>
          <Button
            size="sm"
            variant="primary"
            onPress={() => {
              if (!issueSubject.trim() && activeBuyerAgent) {
                setIssueSubject(activeBuyerAgent);
              }
            }}
          >
            <Plus className="size-3.5" />
            Issue Pass
          </Button>
          <Drawer.Backdrop>
            <Drawer.Content placement="right">
              <Drawer.Dialog aria-label="Issue Pass">
                <Drawer.CloseTrigger />
                <Drawer.Header className="flex-col items-start gap-1">
                  <Drawer.Heading className="text-foreground text-base font-semibold">
                    Issue Pass
                  </Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body>
                  <Form
                    className="flex flex-col gap-4"
                    id="issue-pass-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleIssuePass();
                    }}
                  >
                    <TextField
                      fullWidth
                      isDisabled={busy}
                      name="receipt-subject"
                      value={issueSubject}
                      variant="secondary"
                      onChange={setIssueSubject}
                    >
                      <Label className="text-xs">Buyer Subject</Label>
                      <Input
                        fullWidth
                        className="font-mono text-xs tabular-nums"
                        placeholder={activeBuyerAgent || "agent:session-1"}
                      />
                    </TextField>

                    <TextField
                      fullWidth
                      isDisabled={busy}
                      name="receipt-bundle"
                      value={effectiveBundleId}
                      variant="secondary"
                      onChange={setIssueBundleOverride}
                    >
                      <Label className="text-xs">Bundle ID</Label>
                      <Input
                        fullWidth
                        className="font-mono text-xs tabular-nums"
                        placeholder="conduit_session_evidence"
                      />
                    </TextField>

                    <div className="grid grid-cols-2 gap-3">
                      <TextField
                        fullWidth
                        isDisabled={busy}
                        name="receipt-max-calls"
                        value={issueMaxCalls}
                        variant="secondary"
                        onChange={setIssueMaxCalls}
                      >
                        <Label className="text-xs">Max Calls</Label>
                        <Input
                          fullWidth
                          className="font-mono text-xs tabular-nums"
                          inputMode="numeric"
                          placeholder="10"
                        />
                      </TextField>

                      <TextField
                        fullWidth
                        isDisabled={busy}
                        name="receipt-ttl-hours"
                        value={issueTtlHours}
                        variant="secondary"
                        onChange={setIssueTtlHours}
                      >
                        <Label className="text-xs">Validity (hours)</Label>
                        <Input
                          fullWidth
                          className="font-mono text-xs tabular-nums"
                          inputMode="numeric"
                          placeholder="24"
                        />
                      </TextField>
                    </div>
                  </Form>
                </Drawer.Body>
                <Drawer.Footer className="justify-end gap-2">
                  <Button isDisabled={busy} slot="close" type="button" variant="ghost">
                    Cancel
                  </Button>
                  <Button
                    form="issue-pass-form"
                    isDisabled={busy}
                    isPending={busy}
                    type="submit"
                    variant="primary"
                  >
                    Mint Pass
                  </Button>
                </Drawer.Footer>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {activeSegment === "passes" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown>
              <Button size="sm" variant="tertiary">
                <Funnel className="size-3.5" />
                {statusFilter === "all" ? "Status" : STATUS_FILTER_LABELS[statusFilter]}
              </Button>
              <Dropdown.Popover placement="bottom start">
                <Dropdown.Menu
                  selectedKeys={new Set([statusFilter])}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];

                    setStatusFilter(typeof next === "string" ? (next as StatusFilter) : "all");
                  }}
                >
                  <Dropdown.Item id="all" textValue="All">
                    <Label>All</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="active" textValue="Active">
                    <Label>Active</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="revoked" textValue="Revoked">
                    <Label>Revoked</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="exhausted" textValue="Exhausted">
                    <Label>Exhausted</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>

            <Dropdown>
              <Button size="sm" variant="tertiary">
                <Calendar className="size-3.5" />
                {dateRange.id === "all" ? "Date range" : DATE_FILTER_LABELS[dateRange.id]}
              </Button>
              <Dropdown.Popover placement="bottom start">
                <Dropdown.Menu
                  selectedKeys={new Set([dateRange.id])}
                  selectionMode="single"
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    const nextId: DateFilter =
                      next === "7d" || next === "30d" || next === "90d" ? next : "all";
                    const nowSeconds = Math.floor(Date.now() / 1000);

                    setDateRange({
                      cutoffSeconds:
                        nextId === "all" ? null : nowSeconds - DATE_FILTER_SECONDS[nextId],
                      id: nextId,
                    });
                  }}
                >
                  <Dropdown.Item id="all" textValue="All time">
                    <Label>All time</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="7d" textValue="Last 7 days">
                    <Label>Last 7 days</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="30d" textValue="Last 30 days">
                    <Label>Last 30 days</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                  <Dropdown.Item id="90d" textValue="Last 90 days">
                    <Label>Last 90 days</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        ) : (
          <div />
        )}

        <SearchField
          aria-label={activeSegment === "passes" ? "Search passes" : "Search bundles"}
          className="w-full sm:w-56"
          name="orders-search"
          value={search}
          variant="secondary"
          onChange={setSearch}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              className="font-mono text-xs"
              placeholder={activeSegment === "passes" ? "Search passes..." : "Search bundles..."}
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      <Card className="overflow-hidden p-0">
        {activeSegment === "passes" ? (
          <DataGrid
            aria-label="Session passes"
            columns={passColumns}
            contentClassName="min-w-[660px]"
            data={filteredPasses}
            defaultSortDescriptor={{column: "created_at", direction: "descending"}}
            getRowId={(item) => item.receipt_id}
            renderEmptyState={() => (
              <div className="py-8">
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>No session passes found</EmptyState.Title>
                    <EmptyState.Description>
                      {passes.length === 0
                        ? "Authorized buyer session passes appear here once issued."
                        : "No session passes match the active search or filters."}
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              </div>
            )}
            variant="secondary"
          />
        ) : (
          <DataGrid
            aria-label="Bundles"
            columns={bundleColumns}
            contentClassName="min-w-[640px]"
            data={filteredBundles}
            defaultSortDescriptor={{column: "bundle_id", direction: "ascending"}}
            getRowId={(item) => item.bundle_id}
            renderEmptyState={() => (
              <div className="py-8">
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>No bundles configured</EmptyState.Title>
                    <EmptyState.Description>
                      {bundles.length === 0
                        ? "Configured merchant capability bundles appear here."
                        : "No bundles match the active search."}
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              </div>
            )}
            variant="secondary"
          />
        )}
      </Card>
    </ScrollShadow>
  );
}
