"use client";

import type {CapabilityReceiptRow} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";

import {Button, Chip, SearchField} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {useOutrider} from "../lib/outrider-store";
import {OrdersRowActions} from "../widgets/orders-row-actions";

export function OrdersPage() {
  const {openDialog, snapshot, unlocked} = useOutrider();
  const [search, setSearch] = useState("");

  const receipts = useMemo(() => {
    const all = snapshot?.capability_receipts ?? [];

    if (!search.trim()) return all;
    const q = search.toLowerCase();

    return all.filter(
      (r) =>
        r.receipt_id.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.bundle_id.toLowerCase().includes(q),
    );
  }, [search, snapshot?.capability_receipts]);

  const columns = useMemo<DataGridColumn<CapabilityReceiptRow>[]>(
    () => [
      {
        accessorKey: "receipt_id",
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            {row.receipt_id.slice(0, 14)}
          </span>
        ),
        header: "Receipt ID",
        id: "receipt_id",
        isRowHeader: true,
        minWidth: 150,
      },
      {
        accessorKey: "subject",
        cell: (row) => (
          <span className="block max-w-[220px] truncate font-mono text-xs">{row.subject}</span>
        ),
        header: "Subject",
        id: "subject",
        minWidth: 200,
      },
      {
        accessorKey: "bundle_id",
        cell: (row) => <span className="font-mono text-xs">{row.bundle_id}</span>,
        header: "Bundle",
        id: "bundle_id",
        minWidth: 140,
      },
      {
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">
            {row.remaining_calls} / {row.max_calls}
          </span>
        ),
        header: "Remaining Calls",
        id: "quota",
        minWidth: 130,
      },
      {
        cell: (row) => (
          <Chip
            color={row.revoked ? "danger" : row.signature_verified ? "success" : "warning"}
            size="sm"
            variant="soft"
          >
            {row.revoked
              ? "Revoked"
              : row.signature_verified
                ? "Ed25519 verified"
                : "Invalid signature"}
          </Chip>
        ),
        header: "Status",
        id: "status",
        minWidth: 150,
      },
      {
        align: "end",
        cell: (row) => <OrdersRowActions receipt={row} />,
        header: "Actions",
        id: "actions",
        minWidth: 110,
      },
    ],
    [],
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-sm text-pretty">
          Persisted bundles, session offers, MRTR quotes, and Ed25519 capability receipts.
        </p>
        <div className="flex items-center gap-2">
          <Button
            isDisabled={!unlocked}
            size="sm"
            variant="secondary"
            onPress={() => openDialog("put-bundle")}
          >
            Put Bundle
          </Button>
        </div>
      </div>

      <SearchField
        aria-label="Filter capability receipts"
        className="w-full sm:w-[280px]"
        name="receipts-search"
        value={search}
        variant="secondary"
        onChange={setSearch}
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Filter receipts..." />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <DataGrid
        aria-label="Capability receipts"
        columns={columns}
        contentClassName="min-w-[820px]"
        data={receipts}
        getRowId={(item) => item.receipt_id}
        renderEmptyState={() => (
          <span className="text-muted py-6 text-xs">
            {unlocked
              ? "No capability receipts issued in this runtime."
              : "Unlock with the admin token to inspect capability receipts."}
          </span>
        )}
      />
    </div>
  );
}
