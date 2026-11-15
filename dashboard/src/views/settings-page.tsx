"use client";

import type {ProbePolicy} from "../lib/types";
import type {ReactNode} from "react";

import {
  Button,
  Input,
  Label,
  ListBox,
  Select,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import {useState} from "react";

import {useCoreStore} from "../lib/core-store";

const PROBE_POLICIES: ReadonlyArray<{id: ProbePolicy; label: string}> = [
  {id: "off", label: "Off"},
  {id: "on-request", label: "On request"},
  {id: "auto", label: "Automatic"},
];

async function copyEndpointValue(value: string | null | undefined, label: string): Promise<void> {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`Copied ${label}`);
  } catch {
    toast.danger(`Failed to copy ${label}`);
  }
}

export function SettingsPage() {
  const {busy, mutate, refresh, snapshot, status} = useCoreStore();
  const serverPolicy: ProbePolicy = status?.probe_policy ?? snapshot?.probe_policy ?? "auto";

  const [policyOverride, setPolicyOverride] = useState<ProbePolicy | null>(null);
  const [skillsPath, setSkillsPath] = useState("");
  const [savedSkillsPath, setSavedSkillsPath] = useState("");
  const [upstreamName, setUpstreamName] = useState("");
  const [upstreamEndpoint, setUpstreamEndpoint] = useState("");

  const selectedPolicy: ProbePolicy = policyOverride ?? serverPolicy;
  const listenAddr = status?.listen_addr ?? "—";
  const mcpEndpoint = status?.mcp_endpoint ?? "—";
  const upstreamServers = snapshot?.upstream_servers ?? [];

  const handleReset = () => {
    setPolicyOverride(null);
    setSkillsPath("");
    setSavedSkillsPath("");
    setUpstreamName("");
    setUpstreamEndpoint("");
  };

  const handleSave = async () => {
    const trimmedSkills = skillsPath.trim();
    const trimmedName = upstreamName.trim();
    const trimmedEndpoint = upstreamEndpoint.trim();

    if ((trimmedName && !trimmedEndpoint) || (!trimmedName && trimmedEndpoint)) {
      toast.danger("Provide both upstream server name and endpoint URL");

      return;
    }

    try {
      if (selectedPolicy !== serverPolicy) {
        await mutate("/probe-policy", {probe_policy: selectedPolicy});
      }

      if (trimmedSkills.length > 0 && trimmedSkills !== savedSkillsPath) {
        await mutate("/skills/load", {path: trimmedSkills});
        setSavedSkillsPath(trimmedSkills);
      }

      if (trimmedName.length > 0 && trimmedEndpoint.length > 0) {
        await mutate("/upstreams/connect", {
          endpoint: trimmedEndpoint,
          name: trimmedName,
        });
        setUpstreamName("");
        setUpstreamEndpoint("");
      }

      await refresh();
      setPolicyOverride(null);
      toast.success("Settings saved");
    } catch {
      // Error toast is handled by mutate().
    }
  };

  return (
    <form
      className="mx-auto flex max-w-5xl flex-col gap-4 px-5 pb-10 pt-4"
      onReset={(event) => {
        event.preventDefault();
        handleReset();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <p className="text-muted text-sm">
        Configure local gateway endpoints, capability probing, skills, and upstream servers.
      </p>

      <Separator />

      <SettingsRow
        description="Local HTTP proxy listener and MCP server URLs."
        label="Gateway Endpoints"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <TextField fullWidth isReadOnly name="proxy-address" value={listenAddr}>
            <Label className="text-xs">Proxy address</Label>
            <Input fullWidth className="tabular-nums" />
          </TextField>
          <Button
            isDisabled={!status?.listen_addr}
            type="button"
            variant="secondary"
            onPress={() => {
              void copyEndpointValue(status?.listen_addr, "proxy address");
            }}
          >
            Copy
          </Button>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <TextField fullWidth isReadOnly name="mcp-endpoint" value={mcpEndpoint}>
            <Label className="text-xs">MCP endpoint</Label>
            <Input fullWidth className="tabular-nums" />
          </TextField>
          <Button
            isDisabled={!status?.mcp_endpoint}
            type="button"
            variant="secondary"
            onPress={() => {
              void copyEndpointValue(status?.mcp_endpoint, "MCP endpoint");
            }}
          >
            Copy
          </Button>
        </div>
      </SettingsRow>

      <Separator />

      <SettingsRow
        description="Controls when connected MCP clients are probed for session capabilities."
        label="Capability Probe"
      >
        <Select
          isDisabled={busy}
          name="probe-policy"
          value={selectedPolicy}
          onChange={(key) => {
            if (key === "off" || key === "on-request" || key === "auto") {
              setPolicyOverride(key);
            }
          }}
        >
          <Label className="sr-only">Capability Probe</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PROBE_POLICIES.map((policy) => (
                <ListBox.Item key={policy.id} id={policy.id} textValue={policy.label}>
                  {policy.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </SettingsRow>

      <Separator />

      <SettingsRow
        description="Load skill definitions from a local folder into the gateway catalog."
        label="Skills Directory"
      >
        <TextField
          fullWidth
          isDisabled={busy}
          name="skills-directory"
          value={skillsPath}
          onChange={setSkillsPath}
        >
          <Label className="sr-only">Skills Directory</Label>
          <Input fullWidth placeholder="/path/to/skills" />
        </TextField>
      </SettingsRow>

      <Separator />

      <SettingsRow
        description="Connect an external MCP server to expose its tools through the gateway."
        label="Upstream MCP Server"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
          <TextField
            fullWidth
            isDisabled={busy}
            name="upstream-name"
            value={upstreamName}
            onChange={setUpstreamName}
          >
            <Label className="sr-only">Server name</Label>
            <Input fullWidth placeholder="Server name" />
          </TextField>
          <TextField
            fullWidth
            isDisabled={busy}
            name="upstream-endpoint"
            value={upstreamEndpoint}
            onChange={setUpstreamEndpoint}
          >
            <Label className="sr-only">Endpoint URL</Label>
            <Input fullWidth placeholder="https://example.com/mcp" type="url" />
          </TextField>
        </div>

        {upstreamServers.length > 0 ? (
          <div className="flex flex-col gap-2">
            {upstreamServers.map((server) => (
              <div
                key={server.name}
                className="bg-surface-secondary flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs"
              >
                <span className="text-foreground font-medium">{server.name}</span>
                <span className="text-muted truncate tabular-nums">{server.endpoint}</span>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsRow>

      <Separator />

      <footer className="flex items-center justify-end gap-2 pt-2">
        <Button isDisabled={busy} type="reset" variant="ghost">
          Reset
        </Button>
        <Button isDisabled={busy} isPending={busy} type="submit">
          Save changes
        </Button>
      </footer>
    </form>
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
