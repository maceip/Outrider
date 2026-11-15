"use client";

import {Ban, Copy, EllipsisVertical} from "@gravity-ui/icons";
import {Button, Dropdown, Label, Tooltip, toast} from "@heroui/react";

import {useCoreStore} from "../lib/core-store";

export interface OrdersRowActionsProps {
  receiptId: string;
  isRevoked: boolean;
}

export function OrdersRowActions({isRevoked, receiptId}: OrdersRowActionsProps) {
  const {busy, mutate} = useCoreStore();

  return (
    <div className="flex items-center justify-end" data-receipt-id={receiptId}>
      <Dropdown>
        <Tooltip delay={0}>
          <Button isIconOnly aria-label="Receipt actions" size="sm" variant="ghost">
            <EllipsisVertical className="size-4" />
          </Button>
          <Tooltip.Content>Receipt actions</Tooltip.Content>
        </Tooltip>
        <Dropdown.Popover className="min-w-44" placement="bottom end">
          <Dropdown.Menu
            disabledKeys={isRevoked || busy ? ["revoke"] : []}
            onAction={(key) => {
              if (key === "copy") {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(receiptId);
                    toast.success("Copied receipt ID");
                  } catch {
                    toast.danger("Failed to copy receipt ID");
                  }
                })();
              } else if (key === "revoke" && !isRevoked) {
                void (async () => {
                  try {
                    await mutate("/receipts/revoke", {receipt_id: receiptId});
                    toast.success("Receipt revoked");
                  } catch {
                    // Error toast is handled by mutate().
                  }
                })();
              }
            }}
          >
            <Dropdown.Item id="copy" textValue="Copy ID">
              <Copy className="text-muted size-4" />
              <Label>Copy ID</Label>
            </Dropdown.Item>
            <Dropdown.Item id="revoke" textValue="Revoke" variant="danger">
              <Ban className="text-danger size-4" />
              <Label>Revoke</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
