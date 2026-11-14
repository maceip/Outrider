"use client";

import type {AdminAuditEntry} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {Funnel} from "@gravity-ui/icons";
import {Button, Dropdown, Label, SearchField} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useRouter} from "next/navigation";
import {useMemo, useState} from "react";

import {useOutrider} from "../lib/outrider-store";

function formatAuditTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
  });
}

function focusAdminTokenInput() {
  const input = document.querySelector<HTMLInputElement>('[aria-label="Admin token"]');

  input?.focus();
}

export function TopPagesCard() {
  const {snapshot, unlocked} = useOutrider();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [inspectedAuditId, setInspectedAuditId] = useState<string | null>(null);

  const allEntries = useMemo(
    () => snapshot?.admin_audit_log ?? [],
    [snapshot?.admin_audit_log],
  );

  const distinctActions = useMemo(() => {
    const actions = new Set<string>();

    for (const entry of allEntries) {
      if (entry.action) actions.add(entry.action);
    }

    return [...actions].sort((a, b) => a.localeCompare(b));
  }, [allEntries]);

  const effectiveActionFilter =
    actionFilter !== "all" && !distinctActions.includes(actionFilter) ? "all" : actionFilter;

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return allEntries.filter((entry) => {
      if (effectiveActionFilter !== "all" && entry.action !== effectiveActionFilter) {
        return false;
      }
      if (!q) return true;

      const detailsText = JSON.stringify(entry.details ?? {}).toLowerCase();

      return (
        entry.action.toLowerCase().includes(q) ||
        entry.actor.toLowerCase().includes(q) ||
        (entry.target ?? "").toLowerCase().includes(q) ||
        detailsText.includes(q)
      );
    });
  }, [allEntries, effectiveActionFilter, searchQuery]);

  const inspectedEntry = useMemo<AdminAuditEntry | null>(() => {
    if (!inspectedAuditId) return null;

    return allEntries.find((entry) => entry.audit_id === inspectedAuditId) ?? null;
  }, [allEntries, inspectedAuditId]);

  const columns = useMemo<DataGridColumn<AdminAuditEntry>[]>(
    () => [
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatAuditTime(item.created_at)}
          </span>
        ),
        header: "Recorded",
        id: "created_at",
        minWidth: 165,
        sortFn: (a, b) => a.created_at - b.created_at,
      },
      {
        accessorKey: "actor",
        allowsSorting: true,
        cell: (item) => <span className="font-mono text-xs">{item.actor}</span>,
        header: "Actor",
        id: "actor",
        minWidth: 120,
      },
      {
        accessorKey: "action",
        allowsSorting: true,
        cell: (item) => <span className="font-mono text-xs font-medium">{item.action}</span>,
        header: "Action",
        id: "action",
        isRowHeader: true,
        minWidth: 160,
      },
      {
        accessorKey: "target",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted block max-w-[220px] truncate font-mono text-xs">
            {item.target ?? "—"}
          </span>
        ),
        header: "Target",
        id: "target",
        minWidth: 180,
        sortFn: (a, b) => (a.target ?? "").localeCompare(b.target ?? ""),
      },
      {
        allowsSorting: true,
        cell: (item) => {
          const preview = JSON.stringify(item.details ?? {});
          const isInspected = inspectedAuditId === item.audit_id;

          return (
            <div className="flex items-center justify-between gap-2">
              <code className="text-muted block max-w-[320px] truncate font-mono text-xs">
                {preview}
              </code>
              <button
                aria-label={`Inspect audit details for ${item.action}`}
                aria-pressed={isInspected}
                className="text-accent shrink-0 font-mono text-xs hover:underline"
                type="button"
                onClick={() =>
                  setInspectedAuditId((prev) => (prev === item.audit_id ? null : item.audit_id))
                }
              >
                {isInspected ? "Hide" : "JSON"}
              </button>
            </div>
          );
        },
        header: "Details",
        id: "details",
        minWidth: 280,
        sortFn: (a, b) =>
          JSON.stringify(a.details ?? {}).localeCompare(JSON.stringify(b.details ?? {})),
      },
    ],
    [inspectedAuditId],
  );

  const hasFilters = Boolean(searchQuery.trim()) || effectiveActionFilter !== "all";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-base font-semibold text-balance">Admin Audit Log</h2>
          <p className="text-muted text-xs tabular-nums">
            {unlocked
              ? `${filteredEntries.length} of ${allEntries.length} persisted operator mutations in SQLite.`
              : "Persisted operator mutations recorded in SQLite."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            aria-label="Search admin audit log"
            className="w-full sm:w-[260px]"
            isDisabled={!unlocked}
            name="audit-log-search"
            value={searchQuery}
            variant="secondary"
            onChange={setSearchQuery}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search action, actor, target..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <Dropdown>
            <Button isDisabled={!unlocked || distinctActions.length === 0} size="sm" variant="secondary">
              <Funnel aria-hidden="true" className="size-3.5" />
              {effectiveActionFilter === "all" ? "All actions" : effectiveActionFilter}
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu
                aria-label="Filter audit log by action"
                onAction={(key) => setActionFilter(String(key))}
              >
                <Dropdown.Item id="all" textValue="All actions">
                  <Label>All actions</Label>
                </Dropdown.Item>
                {distinctActions.map((action) => (
                  <Dropdown.Item key={action} id={action} textValue={action}>
                    <Label className="font-mono text-xs">{action}</Label>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>

      <DataGrid
        aria-label="Admin audit log"
        columns={columns}
        contentClassName="min-w-[820px]"
        data={filteredEntries}
        defaultSortDescriptor={{column: "created_at", direction: "descending"}}
        getRowId={(item) => item.audit_id}
        renderEmptyState={() => (
          <div className="flex flex-col items-center gap-2.5 py-6 text-center">
            {!unlocked ? (
              <>
                <span className="text-muted text-xs">
                  Unlock with the admin token to inspect admin audit entries.
                </span>
                <Button size="sm" variant="secondary" onPress={focusAdminTokenInput}>
                  Focus Admin Token
                </Button>
              </>
            ) : hasFilters ? (
              <>
                <span className="text-muted text-xs">
                  No audit entries match the current search or action filter.
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setSearchQuery("");
                    setActionFilter("all");
                  }}
                >
                  Clear Filters
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted text-xs">0 admin audit entries recorded in SQLite.</span>
                <Button size="sm" variant="secondary" onPress={() => router.push("/settings")}>
                  Open Gateway Settings
                </Button>
              </>
            )}
          </div>
        )}
      />

      {inspectedEntry ? (
        <div className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground font-mono text-xs font-medium tabular-nums">
              {inspectedEntry.action} · {inspectedEntry.audit_id.slice(0, 12)}
            </span>
            <Button size="sm" variant="tertiary" onPress={() => setInspectedAuditId(null)}>
              Close
            </Button>
          </div>
          <pre className="text-muted max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(inspectedEntry.details ?? {}, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
