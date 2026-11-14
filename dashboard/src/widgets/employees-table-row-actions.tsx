"use client";

import {Code} from "@gravity-ui/icons";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";

export interface RowActionsProps {
  label: string;
  record: unknown;
}

export function RowActions({label, record}: RowActionsProps) {
  const {setSelectedEvidence} = useOutrider();

  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton
        label={`Inspect ${label}`}
        size="sm"
        tooltip={`Inspect raw JSON for ${label}`}
        variant="tertiary"
        onPress={() => setSelectedEvidence({label, record})}
      >
        <Code aria-hidden="true" className="size-4" />
      </IconButton>
    </div>
  );
}
