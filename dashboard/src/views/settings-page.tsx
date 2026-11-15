"use client";

import type {ProbePolicy} from "../lib/types";
import type {ReactNode} from "react";

import {Label, ListBox, Select, Separator} from "@heroui/react";

import {useCoreStore} from "../lib/core-store";
import {formatClefState} from "../lib/types";

const PROBE_POLICIES: ReadonlyArray<{id: ProbePolicy; label: string}> = [
  {id: "auto", label: "Auto"},
  {id: "on-request", label: "On request"},
  {id: "off", label: "Off"},
];

export function SettingsPage() {
  const {busy, mutate, snapshot, status} = useCoreStore();
  const activePolicy: ProbePolicy = snapshot?.probe_policy ?? status?.probe_policy ?? "auto";
  const clefLabel = formatClefState(snapshot?.clef ?? status?.clef);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">Configure local gateway policies and runtime settings.</p>

      <Separator />

      <SettingsRow description="Active probing policy for MCP sessions." label="Probe Policy">
        <Select
          isDisabled={busy}
          name="probe-policy"
          value={activePolicy}
          onChange={(key) => {
            if (key && key !== activePolicy) {
              void mutate("/probe-policy", {probe_policy: String(key)});
            }
          }}
        >
          <Label className="sr-only">Probe Policy</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PROBE_POLICIES.map((p) => (
                <ListBox.Item key={p.id} id={p.id} textValue={p.label}>
                  {p.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </SettingsRow>

      <Separator />

      <SettingsRow description="Current local gateway runtime state." label="Gateway Runtime">
        <div className="text-muted flex flex-col gap-1 text-sm tabular-nums">
          <span>{status?.listen_addr ?? "Local Gateway"}</span>
          <span>{clefLabel}</span>
        </div>
      </SettingsRow>
    </div>
  );
}

interface SettingsRowProps {
  description: string;
  label: string;
  children: ReactNode;
}

function SettingsRow({children, description, label}: SettingsRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10">
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-sm font-medium">{label}</span>
        <p className="text-muted text-xs leading-snug">{description}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
