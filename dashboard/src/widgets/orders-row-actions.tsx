"use client";

import type {CapabilityReceiptRow} from "../lib/types";

import {Code, TrashBin} from "@gravity-ui/icons";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";

export interface OrdersRowActionsProps {
  receipt: CapabilityReceiptRow;
}

export function OrdersRowActions({receipt}: OrdersRowActionsProps) {
  const {busy, mutate, setSelectedEvidence, unlocked} = useOutrider();

  const revokeReason = !unlocked
    ? "Admin token required"
    : busy
      ? "Backend action in progress"
      : receipt.revoked
        ? "Receipt already revoked"
        : undefined;

  return (
    <div className="flex items-center justify-end gap-1" data-receipt-id={receipt.receipt_id}>
      <IconButton
        label={`Inspect receipt ${receipt.receipt_id.slice(0, 8)}`}
        size="sm"
        tooltip="Inspect receipt payload JSON"
        variant="tertiary"
        onPress={() =>
          setSelectedEvidence({
            label: `R-${receipt.receipt_id.slice(0, 8)}`,
            record: receipt,
          })
        }
      >
        <Code aria-hidden="true" className="size-4" />
      </IconButton>

      <span title={revokeReason}>
        <IconButton
          isDisabled={Boolean(revokeReason)}
          label={`Revoke receipt ${receipt.receipt_id.slice(0, 8)}`}
          size="sm"
          tooltip={revokeReason ?? "Revoke capability receipt"}
          variant="danger-soft"
          onPress={() => void mutate("/receipts/revoke", {receipt_id: receipt.receipt_id})}
        >
          <TrashBin aria-hidden="true" className="size-4" />
        </IconButton>
      </span>
    </div>
  );
}
