"use client";

import type {ProbePolicy} from "../lib/types";
import type {ReactNode} from "react";

import {
  Button,
  Card,
  Form,
  Input,
  Label,
  ListBox,
  Select,
  Separator,
  TextField,
  toast,
} from "@heroui/react";
import {ItemCard, ItemCardGroup} from "@heroui-pro/react";
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
    <Form
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 pb-10 pt-8"
      onReset={(event) => {
        event.preventDefault();
        handleReset();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <Card className="gap-8 p-6">
        <SettingsRow label="Gateway Endpoints">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <TextField
              fullWidth
              isReadOnly
              name="proxy-address"
              value={listenAddr}
              variant="secondary"
            >
              <Label className="text-xs">Proxy address</Label>
              <Input fullWidth className="font-mono tabular-nums" />
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
            <TextField
              fullWidth
              isReadOnly
              name="mcp-endpoint"
              value={mcpEndpoint}
              variant="secondary"
            >
              <Label className="text-xs">MCP endpoint</Label>
              <Input fullWidth className="font-mono tabular-nums" />
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

        <SettingsRow label="Capability Probe">
          <Select
            className="w-full sm:w-64"
            isDisabled={busy}
            name="probe-policy"
            value={selectedPolicy}
            variant="secondary"
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

        <SettingsRow label="Skills Directory">
          <TextField
            fullWidth
            isDisabled={busy}
            name="skills-directory"
            value={skillsPath}
            variant="secondary"
            onChange={setSkillsPath}
          >
            <Label className="sr-only">Skills Directory</Label>
            <Input fullWidth className="font-mono" placeholder="/path/to/skills" />
          </TextField>
        </SettingsRow>

        <SettingsRow label="Upstream Server">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]">
            <TextField
              fullWidth
              isDisabled={busy}
              name="upstream-name"
              value={upstreamName}
              variant="secondary"
              onChange={setUpstreamName}
            >
              <Label className="sr-only">Server name</Label>
              <Input fullWidth className="font-mono" placeholder="Server name" />
            </TextField>
            <TextField
              fullWidth
              isDisabled={busy}
              name="upstream-endpoint"
              value={upstreamEndpoint}
              variant="secondary"
              onChange={setUpstreamEndpoint}
            >
              <Label className="sr-only">Endpoint URL</Label>
              <Input
                fullWidth
                className="font-mono"
                placeholder="https://example.com/mcp"
                type="url"
              />
            </TextField>
          </div>

          {upstreamServers.length > 0 ? (
            <ItemCardGroup variant="secondary">
              {upstreamServers.map((server) => (
                <ItemCard key={server.name} variant="secondary">
                  <ItemCard.Content>
                    <ItemCard.Title className="font-mono text-xs">{server.name}</ItemCard.Title>
                    <ItemCard.Description className="truncate font-mono text-xs tabular-nums">
                      {server.endpoint}
                    </ItemCard.Description>
                  </ItemCard.Content>
                </ItemCard>
              ))}
            </ItemCardGroup>
          ) : null}
        </SettingsRow>

        <Separator />

        <Card.Footer className="justify-end gap-2">
          <Button isDisabled={busy} type="reset" variant="ghost">
            Reset
          </Button>
          <Button isDisabled={busy} isPending={busy} type="submit">
            Save changes
          </Button>
        </Card.Footer>
      </Card>
    </Form>
  );
}

interface SettingsRowProps {
  label: string;
  children: ReactNode;
}

function SettingsRow({children, label}: SettingsRowProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10">
      <h2 className="text-foreground pt-1 text-sm font-semibold">{label}</h2>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}
