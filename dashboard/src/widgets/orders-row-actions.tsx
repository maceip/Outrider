"use client";

import type {CapabilityReceiptRow} from "../lib/types";

import {CircleCheck, Code, Copy, TrashBin} from "@gravity-ui/icons";
import {useEffect, useRef, useState} from "react";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";

/**
 * Encodes a persisted CapabilityReceiptRow into the exact URL-safe base64 (no-pad)
 * SignedReceipt token produced by `SignedReceipt::encode()` in `proxyfor/src/commerce/receipt.rs`.
 */
export function encodeSignedReceiptToken(row: CapabilityReceiptRow): string {
  const signed = {
    receipt: {
      receipt_id: row.payload.receipt_id,
      subject: row.payload.subject,
      bundle_id: row.payload.bundle_id,
      item_digests: row.payload.item_digests,
      max_calls: row.payload.max_calls,
      expires_at_unix: row.payload.expires_at_unix,
    },
    signature: row.signature,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(signed));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface InspectedCommercePayload {
  id: string;
  label: string;
  record: unknown;
  receipt?: CapabilityReceiptRow;
}

export interface OrdersRowActionsProps {
  id?: string;
  label?: string;
  record?: unknown;
  receipt?: CapabilityReceiptRow;
  isSelected?: boolean;
  onInspect?: (payload: InspectedCommercePayload) => void;
  onActionError?: (message: string | null) => void;
}

export function OrdersRowActions({
  id,
  isSelected = false,
  label,
  onActionError,
  onInspect,
  receipt,
  record,
}: OrdersRowActionsProps) {
  const {busy, mutate, setSelectedEvidence, setSelectedReceiptId, unlocked} = useOutrider();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const resolvedId = id ?? receipt?.receipt_id ?? "";
  const shortId = resolvedId.slice(0, 10);
  const resolvedLabel = label ?? (receipt ? `R-${receipt.receipt_id.slice(0, 8)}` : shortId);
  const resolvedRecord = record ?? receipt;

  const revokeReason = !receipt
    ? undefined
    : !unlocked
      ? "Admin token required"
      : busy
        ? "Backend action in progress"
        : receipt.revoked
          ? "Receipt already revoked"
          : undefined;

  const handleInspect = () => {
    if (receipt) {
      setSelectedReceiptId(receipt.receipt_id);
    }
    setSelectedEvidence({
      label: resolvedLabel,
      record: resolvedRecord,
    });
    onInspect?.({
      id: resolvedId,
      label: resolvedLabel,
      receipt,
      record: resolvedRecord,
    });
  };

  const handleCopy = async () => {
    const valueToCopy = receipt ? encodeSignedReceiptToken(receipt) : resolvedId;

    if (!valueToCopy || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(valueToCopy);
      setCopied(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      onActionError?.("Clipboard write blocked by browser permissions.");
    }
  };

  const handleRevoke = async () => {
    if (!receipt || revokeReason) return;
    onActionError?.(null);
    try {
      await mutate("/receipts/revoke", {receipt_id: receipt.receipt_id});
    } catch (error) {
      onActionError?.(error instanceof Error ? error.message : "Failed to revoke receipt.");
    }
  };

  return (
    <div
      className="flex items-center justify-end gap-1"
      data-receipt-id={receipt?.receipt_id}
      data-record-id={resolvedId}
    >
      <IconButton
        aria-pressed={isSelected}
        label={`Inspect payload ${shortId}`}
        size="sm"
        tooltip="Inspect Payload"
        variant={isSelected ? "secondary" : "tertiary"}
        onPress={handleInspect}
      >
        <Code aria-hidden="true" className="size-4" />
      </IconButton>

      <IconButton
        label={
          receipt ? `Copy signed receipt ${shortId}` : `Copy identifier ${shortId}`
        }
        size="sm"
        tooltip={
          copied
            ? "Copied to clipboard"
            : receipt
              ? "Copy signed receipt token"
              : "Copy record ID"
        }
        variant="tertiary"
        onPress={() => void handleCopy()}
      >
        {copied ? (
          <CircleCheck aria-hidden="true" className="text-success size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </IconButton>

      {receipt ? (
        <span className="inline-flex" title={revokeReason ?? "Revoke capability receipt"}>
          <IconButton
            isDisabled={Boolean(revokeReason)}
            label={`Revoke receipt ${shortId}`}
            size="sm"
            tooltip={revokeReason ?? "Revoke capability receipt"}
            variant="danger-soft"
            onPress={() => void handleRevoke()}
          >
            <TrashBin aria-hidden="true" className="size-4" />
          </IconButton>
        </span>
      ) : null}
    </div>
  );
}
