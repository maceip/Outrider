"use client";

import type {CapabilityReceiptRow} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {Calendar, Funnel, Plus} from "@gravity-ui/icons";
import {
  Avatar,
  Button,
  Chip,
  Drawer,
  Dropdown,
  Input,
  Label,
  SearchField,
  TextField,
  toast,
} from "@heroui/react";
import {DataGrid, EmptyState} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {useCoreStore} from "../lib/core-store";
import {OrdersRowActions} from "../widgets/orders-row-actions";

type ReceiptStatus = "Active" | "Revoked" | "Exhausted";
type StatusFilter = "all" | "active" | "revoked" | "exhausted";
type DateFilter = "all" | "7d" | "30d" | "90d";

const STATUS_COLORS: Record<ReceiptStatus, "success" | "danger" | "default"> = {
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

function getReceiptStatus(row: CapabilityReceiptRow): ReceiptStatus {
  if (row.revoked !== 0) return "Revoked";
  if (row.remaining_calls <= 0) return "Exhausted";

  return "Active";
}

function getSubjectInitials(subject: string): string {
  const parts = subject
    .trim()
    .split(/[\s:._/-]+/)
    .filter(Boolean);

  if (parts.length === 0) return "OR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function formatIssuedDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", DATE_FORMAT_OPTIONS);
}

export function OrdersPage() {
  const {busy, mutate, snapshot} = useCoreStore();
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

  const receipts = useMemo(() => snapshot?.capability_receipts ?? [], [snapshot]);
  const defaultBundleId = snapshot?.bundles[0]?.bundle_id ?? "outrider_session_evidence";
  const effectiveBundleId = issueBundleOverride ?? defaultBundleId;

  const handleIssueReceipt = async () => {
    const trimmedSubject = issueSubject.trim();
    const trimmedBundleId = effectiveBundleId.trim();
    const parsedMaxCalls = Number.parseInt(issueMaxCalls.trim(), 10);
    const parsedTtlHours = Number.parseInt(issueTtlHours.trim(), 10);

    if (!trimmedSubject) {
      toast.danger("Enter a receipt subject");

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
      const existingBundles = snapshot?.bundles ?? [];
      const bundleExists = existingBundles.some((bundle) => bundle.bundle_id === trimmedBundleId);

      if (!bundleExists) {
        const catalogItems = snapshot?.catalog_items ?? [];
        const matchedCatalogItem =
          catalogItems.find((item) => item.item_id === trimmedBundleId)?.item_id ??
          catalogItems[0]?.item_id ??
          "outrider_session_evidence";

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
      toast.success("Receipt issued");
    } catch {
      // Error toast is handled by mutate().
    }
  };

  const filteredReceipts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const {cutoffSeconds} = dateRange;

    return receipts.filter((row) => {
      if (statusFilter !== "all") {
        const status = getReceiptStatus(row).toLowerCase();

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
  }, [dateRange, receipts, search, statusFilter]);

  const columns = useMemo<DataGridColumn<CapabilityReceiptRow>[]>(
    () => [
      {
        accessorKey: "receipt_id",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="block max-w-[220px] truncate font-mono text-xs font-medium tabular-nums"
            title={item.receipt_id}
          >
            {item.receipt_id}
          </span>
        ),
        header: "Receipt ID",
        id: "receipt_id",
        isRowHeader: true,
        minWidth: 160,
      },
      {
        accessorKey: "subject",
        allowsSorting: true,
        cell: (item) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="border-border bg-surface-secondary text-foreground size-8 shrink-0 rounded-lg border">
              <Avatar.Fallback className="bg-surface-secondary text-foreground font-mono text-xs font-semibold">
                {getSubjectInitials(item.subject)}
              </Avatar.Fallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-foreground truncate font-mono text-xs font-medium">
                {item.subject}
              </span>
              <span className="text-muted truncate font-mono text-xs">{item.bundle_id}</span>
            </div>
          </div>
        ),
        header: "Subject & Bundle",
        id: "subject",
        minWidth: 220,
      },
      {
        allowsSorting: true,
        cell: (item) => {
          const receiptStatus = getReceiptStatus(item);

          return (
            <Chip color={STATUS_COLORS[receiptStatus]} size="sm" variant="soft">
              {receiptStatus}
            </Chip>
          );
        },
        header: "Status",
        id: "status",
        minWidth: 120,
        sortFn: (a, b) => getReceiptStatus(a).localeCompare(getReceiptStatus(b)),
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
        minWidth: 120,
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
        minWidth: 140,
        sortFn: (a, b) => a.created_at - b.created_at,
      },
      {
        align: "end",
        cell: (item) => (
          <OrdersRowActions isRevoked={item.revoked !== 0} receiptId={item.receipt_id} />
        ),
        header: "Actions",
        id: "actions",
        minWidth: 100,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8">
      <p className="text-muted text-sm">Manage issued receipts and bundle access.</p>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-foreground text-base font-semibold">Issued Receipts</h2>
              <Chip className="tabular-nums" size="sm" variant="soft">
                {filteredReceipts.length}
              </Chip>
            </div>

            <Drawer isOpen={isIssueOpen} onOpenChange={setIsIssueOpen}>
              <Button size="sm" variant="primary">
                <Plus className="size-4" />
                Issue Receipt
              </Button>
              <Drawer.Backdrop>
                <Drawer.Content placement="right">
                  <Drawer.Dialog aria-label="Issue Receipt">
                    <Drawer.CloseTrigger />
                    <Drawer.Header className="flex-col items-start gap-1">
                      <Drawer.Heading className="text-foreground text-base font-semibold">
                        Issue Receipt
                      </Drawer.Heading>
                      <p className="text-muted text-xs leading-relaxed">
                        Grant scoped bundle quota to a client or session.
                      </p>
                    </Drawer.Header>
                    <Drawer.Body>
                      <form
                        className="flex flex-col gap-4"
                        id="issue-receipt-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleIssueReceipt();
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
                          <Label className="text-xs">Subject</Label>
                          <Input
                            fullWidth
                            className="font-mono text-xs tabular-nums"
                            placeholder="agent:session-1"
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
                            placeholder="outrider_session_evidence"
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
                      </form>
                    </Drawer.Body>
                    <Drawer.Footer className="justify-end gap-2">
                      <Button isDisabled={busy} slot="close" type="button" variant="ghost">
                        Cancel
                      </Button>
                      <Button
                        form="issue-receipt-form"
                        isDisabled={busy}
                        isPending={busy}
                        type="submit"
                        variant="primary"
                      >
                        Mint Receipt
                      </Button>
                    </Drawer.Footer>
                  </Drawer.Dialog>
                </Drawer.Content>
              </Drawer.Backdrop>
            </Drawer>
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
                  <Calendar className="size-4" />
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

            <SearchField
              aria-label="Search receipts"
              className="w-full sm:w-64"
              name="orders-search"
              value={search}
              onChange={setSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search receipts..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </div>
        </div>

        <DataGrid
          aria-label="Receipts"
          columns={columns}
          contentClassName="min-w-[820px]"
          data={filteredReceipts}
          defaultSortDescriptor={{column: "created_at", direction: "descending"}}
          getRowId={(item) => item.receipt_id}
          renderEmptyState={() => (
            <div className="py-6">
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>No receipts found</EmptyState.Title>
                  <EmptyState.Description>
                    {receipts.length === 0
                      ? "Issued receipts will appear here."
                      : "No receipts match the active search or filters."}
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            </div>
          )}
        />
      </div>
    </div>
  );
}
