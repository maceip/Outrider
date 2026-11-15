"use client";

import type {TrafficHead} from "../lib/types";
import type {Key} from "react";

import {ArrowRightFromSquare, Copy, EllipsisVertical, Terminal} from "@gravity-ui/icons";
import {Button, Dropdown, Label, toast} from "@heroui/react";

import {PROXYFOR_BASE, useCoreStore} from "../lib/core-store";

export interface RowActionsProps {
  item: TrafficHead;
}

export function RowActions({item}: RowActionsProps) {
  const {copyTrafficCurl} = useCoreStore();

  const handleAction = (key: Key) => {
    const action = String(key);

    if (action === "copy-url") {
      void navigator.clipboard
        .writeText(item.uri)
        .then(() => {
          toast.success("Copied URL");
        })
        .catch(() => {
          toast.danger("Failed to copy URL");
        });

      return;
    }

    if (action === "copy-curl") {
      void copyTrafficCurl(item.id);

      return;
    }

    if (action === "open-json") {
      window.open(`${PROXYFOR_BASE}/traffic/${item.id}`, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex items-center justify-end">
      <Dropdown>
        <Button
          isIconOnly
          aria-label={`Actions for request #${item.id}`}
          size="sm"
          variant="ghost"
        >
          <EllipsisVertical className="size-4" />
        </Button>
        <Dropdown.Popover className="min-w-44" placement="bottom end">
          <Dropdown.Menu
            aria-label={`Actions for request #${item.id}`}
            onAction={handleAction}
          >
            <Dropdown.Item id="copy-url" textValue="Copy URL">
              <Copy className="text-muted size-4" />
              <Label>Copy URL</Label>
            </Dropdown.Item>
            <Dropdown.Item id="copy-curl" textValue="Copy cURL">
              <Terminal className="text-muted size-4" />
              <Label>Copy cURL</Label>
            </Dropdown.Item>
            <Dropdown.Item id="open-json" textValue="Open JSON">
              <ArrowRightFromSquare className="text-muted size-4" />
              <Label>Open JSON</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}
