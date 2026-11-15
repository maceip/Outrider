"use client";

import {Copy} from "@gravity-ui/icons";

import {IconButton} from "../components/icon-button";
import {useCoreStore} from "../lib/core-store";

export interface RowActionsProps {
  employeeId: string;
}

export function RowActions({employeeId}: RowActionsProps) {
  const {copyTrafficCurl} = useCoreStore();
  const numericId = Number(employeeId);

  return (
    <div className="flex items-center justify-end gap-0.5" data-employee-id={employeeId}>
      <IconButton
        isDisabled={!Number.isFinite(numericId) || numericId <= 0}
        label="Copy cURL"
        size="sm"
        variant="tertiary"
        onPress={() => {
          if (Number.isFinite(numericId) && numericId > 0) {
            void copyTrafficCurl(numericId);
          }
        }}
      >
        <Copy className="size-4" />
      </IconButton>
    </div>
  );
}
