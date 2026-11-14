"use client";

import type {AdminAuditEntry} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {DataGrid} from "@heroui-pro/react";
import {useMemo} from "react";

import {useOutrider} from "../lib/outrider-store";

export function TopPagesCard() {
  const {snapshot, unlocked} = useOutrider();

  const entries = useMemo(() => snapshot?.admin_audit_log ?? [], [snapshot?.admin_audit_log]);

  const columns = useMemo<DataGridColumn<AdminAuditEntry>[]>(
    () => [
      {
        accessorKey: "action",
        cell: (item) => <span className="font-mono text-xs font-medium">{item.action}</span>,
        header: "Action",
        id: "action",
        isRowHeader: true,
        minWidth: 160,
      },
      {
        accessorKey: "actor",
        cell: (item) => <span className="font-mono text-xs">{item.actor}</span>,
        header: "Actor",
        id: "actor",
        minWidth: 130,
      },
      {
        accessorKey: "target",
        cell: (item) => (
          <span className="text-muted block max-w-[260px] truncate font-mono text-xs">
            {item.target ?? "—"}
          </span>
        ),
        header: "Target",
        id: "target",
        minWidth: 200,
      },
      {
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {new Date(item.created_at * 1000).toLocaleTimeString()}
          </span>
        ),
        header: "Recorded",
        id: "created_at",
        minWidth: 120,
      },
    ],
    [],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-base font-semibold text-balance">Admin Audit Log</h2>
        <p className="text-muted text-xs">Persisted operator mutations recorded in SQLite.</p>
      </div>
      <DataGrid
        aria-label="Admin audit log"
        columns={columns}
        contentClassName="min-w-[640px]"
        data={entries}
        getRowId={(item) => item.audit_id}
        renderEmptyState={() => (
          <span className="text-muted py-6 text-xs">
            {unlocked ? "0 audit entries recorded." : "Unlock to inspect admin audit entries."}
          </span>
        )}
      />
    </section>
  );
}
