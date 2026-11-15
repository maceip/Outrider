"use client";

import {Eye} from "@gravity-ui/icons";

import {IconButton} from "../components/icon-button";

export interface OrdersRowActionsProps {
  orderId: string;
}

export function OrdersRowActions({orderId}: OrdersRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-0.5" data-order-id={orderId}>
      <IconButton isDisabled label="View receipt" size="sm" variant="tertiary">
        <Eye className="size-4" />
      </IconButton>
    </div>
  );
}
