"use client";

import type {ProbePolicy, UpstreamServer} from "../lib/types";
import type {FormEvent, ReactNode} from "react";

import {ArrowsRotateLeft, CircleCheck, Copy} from "@gravity-ui/icons";
import {
  Button,
  Chip,
  Input,
  Label,
  ListBox,
  Select,
  Separator,
  TextField,
} from "@heroui/react";
import {useMemo, useState} from "react";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";
import {formatClefState} from "../lib/types";

const PROBE_POLICY_OPTIONS: ReadonlyArray<{
  description: string;
  id: ProbePolicy;
}> = [
  {
    description: "Disable active capability probes across all sessions.",
    id: "off",
  },
  {
    description: "Run capability probes only when triggered by an operator or tool call.",
    id: "on-request",
  },
  {
    description: "Automatically probe sampling-capable MCP sessions on handshake.",
    id: "auto",
  },
];

function formatUpdatedAt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
  });
}

function upstreamChipColor(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "Connected") return "success";
  if (status === "Connecting") return "warning";
  if (status === "Failed") return "danger";

  return "default";
}

export function SettingsPage() {
  const {
    busy,
    clefStatus,
    mutate,
    openDialog,
    publicStatus,
    snapshot,
    unlocked,
  } = useOutrider();

  const [draftPolicy, setDraftPolicy] = useState<ProbePolicy | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [skillsPath, setSkillsPath] = useState("");
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [reconnectingName, setReconnectingName] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState(false);

  const observedPolicy: ProbePolicy | null =
    snapshot?.probe_policy ?? publicStatus?.probe_policy ?? null;
  const effectivePolicy: ProbePolicy | null = draftPolicy ?? observedPolicy;

  const skillCatalogCount = useMemo(
    () => (snapshot?.catalog_items ?? []).filter((item) => item.kind === "skill").length,
    [snapshot?.catalog_items],
  );

  const upstreamServers = useMemo<UpstreamServer[]>(
    () => snapshot?.upstream_servers ?? [],
    [snapshot?.upstream_servers],
  );

  const disabledReason = !unlocked
    ? "Admin token required — unlock above to modify gateway settings."
    : busy
      ? "Backend action in progress."
      : undefined;

  const handlePolicySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!effectivePolicy) return;
    setPolicyError(null);
    try {
      await mutate("/probe-policy", {probe_policy: effectivePolicy});
      setDraftPolicy(null);
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : "Failed to update probe policy.");
    }
  };

  const handleLoadSkills = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = skillsPath.trim();

    if (!trimmed) {
      setSkillsError("Enter a local directory path containing MCP skill descriptors.");

      return;
    }
    setSkillsError(null);
    try {
      await mutate("/skills/load", {path: trimmed});
      setSkillsPath("");
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Failed to load skill catalog.");
    }
  };

  const handleReconnectUpstream = async (server: UpstreamServer) => {
    setUpstreamError(null);
    setReconnectingName(server.name);
    try {
      await mutate("/upstreams/connect", {
        endpoint: server.endpoint,
        name: server.name,
      });
    } catch (error) {
      setUpstreamError(
        error instanceof Error ? error.message : `Failed to reconnect ${server.name}.`,
      );
    } finally {
      setReconnectingName(null);
    }
  };

  const handleCopyPublicKey = async () => {
    if (!snapshot?.public_key) return;
    try {
      await navigator.clipboard.writeText(snapshot.public_key);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 1800);
    } catch {
      setCopiedKey(false);
    }
  };

  const clefModelDetail = !clefStatus
    ? "—"
    : clefStatus.status === "Ready"
      ? clefStatus.model_path
      : clefStatus.status === "ModelError"
        ? `${clefStatus.model_path} — ${clefStatus.error}`
        : "None (no .litertlm model configured)";

  const adminAllowRemote = publicStatus?.admin_allow_remote;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 pb-10 pt-4">
      <div className="flex flex-col gap-1">
        <p className="text-muted text-sm text-pretty">
          Configure active MCP probe policy, load local skill catalogs, manage federated upstream
          MCP servers, and inspect Ed25519 receipt authority state.
        </p>
        {disabledReason ? (
          <p className="text-muted text-xs" id="settings-disabled-reason">
            {disabledReason}
          </p>
        ) : null}
      </div>

      <Separator />

      <SettingsRow
        description="Controls whether sampling-capable MCP sessions are probed automatically, on operator request, or disabled."
        label="Active Probe Policy"
      >
        <form className="flex flex-col gap-3" onSubmit={(e) => void handlePolicySubmit(e)}>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              className="w-full sm:max-w-xs"
              isDisabled={Boolean(disabledReason) || effectivePolicy === null}
              name="probe-policy"
              placeholder="Reading gateway policy..."
              value={effectivePolicy}
              onChange={(key) => {
                if (key) {
                  setDraftPolicy(String(key) as ProbePolicy);
                  setPolicyError(null);
                }
              }}
            >
              <Label>Probe policy</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {PROBE_POLICY_OPTIONS.map((option) => (
                    <ListBox.Item key={option.id} id={option.id} textValue={option.id}>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs font-medium">{option.id}</span>
                        <span className="text-muted text-xs">{option.description}</span>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <span title={disabledReason ?? "Persist active probe policy"}>
              <Button
                aria-describedby={disabledReason ? "settings-disabled-reason" : undefined}
                isDisabled={Boolean(disabledReason) || effectivePolicy === null}
                size="sm"
                type="submit"
              >
                Save Policy
              </Button>
            </span>
          </div>

          <p className="text-muted font-mono text-xs">
            Persisted gateway policy:{" "}
            <strong className="text-foreground">{observedPolicy ?? "—"}</strong>
          </p>

          {policyError ? (
            <div
              aria-live="assertive"
              className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 text-xs"
              role="alert"
            >
              {policyError}
            </div>
          ) : null}
        </form>
      </SettingsRow>

      <Separator />

      <SettingsRow
        description="Load MCP skill descriptors from a local filesystem directory into SQLite catalog_items."
        label="Skill Catalog Directory"
      >
        <form className="flex flex-col gap-3" onSubmit={(e) => void handleLoadSkills(e)}>
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              aria-describedby={skillsError ? "skills-load-error" : undefined}
              aria-invalid={Boolean(skillsError) || undefined}
              className="min-w-[260px] flex-1"
              isDisabled={Boolean(disabledReason)}
              name="skills-path"
              value={skillsPath}
              onChange={(val) => {
                setSkillsPath(val);
                if (skillsError) setSkillsError(null);
              }}
            >
              <Label>Skills directory path</Label>
              <Input fullWidth placeholder="/path/to/skills" />
            </TextField>

            <span
              title={
                disabledReason ??
                (!skillsPath.trim() ? "Enter a skills directory path" : "Load skills into catalog")
              }
            >
              <Button
                aria-describedby={disabledReason ? "settings-disabled-reason" : undefined}
                isDisabled={Boolean(disabledReason) || !skillsPath.trim()}
                size="sm"
                type="submit"
                variant="secondary"
              >
                Load Skills
              </Button>
            </span>
          </div>

          <p className="text-muted text-xs tabular-nums">
            {unlocked
              ? `${skillCatalogCount} skill descriptor(s) currently persisted in catalog_items.`
              : "Unlock session to inspect persisted skill descriptor count."}
          </p>

          {skillsError ? (
            <div
              aria-live="assertive"
              className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 text-xs"
              id="skills-load-error"
              role="alert"
            >
              {skillsError}
            </div>
          ) : null}
        </form>
      </SettingsRow>

      <Separator />

      <SettingsRow
        description="Persisted federated MCP upstream servers registered in upstream_servers. Reconnect stdio or HTTP endpoints after gateway restarts."
        label="Upstream MCP Servers"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted text-xs tabular-nums">
            {unlocked
              ? `${upstreamServers.length} upstream server(s) persisted`
              : "Unlock session to inspect persisted upstreams"}
          </span>
          <span title={disabledReason ?? "Connect a new MCP upstream server"}>
            <Button
              aria-describedby={disabledReason ? "settings-disabled-reason" : undefined}
              isDisabled={Boolean(disabledReason)}
              size="sm"
              variant="secondary"
              onPress={() => openDialog("connect-upstream")}
            >
              Connect Upstream
            </Button>
          </span>
        </div>

        {upstreamError ? (
          <div
            aria-live="assertive"
            className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 text-xs"
            role="alert"
          >
            {upstreamError}
          </div>
        ) : null}

        {upstreamServers.length === 0 ? (
          <div className="border-border rounded-xl border border-dashed p-4 text-xs">
            <p className="text-muted text-pretty">
              {unlocked
                ? "0 upstream MCP servers persisted. Use Connect Upstream to federate an HTTP or stdio MCP server."
                : "Unlock with the admin bearer token to view and reconnect federated MCP servers."}
            </p>
          </div>
        ) : (
          <ul aria-label="Persisted upstream MCP servers" className="flex flex-col gap-2.5">
            {upstreamServers.map((server) => {
              const isReconnecting = reconnectingName === server.name;

              return (
                <li
                  key={server.name}
                  className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-mono text-sm font-semibold">
                        {server.name}
                      </span>
                      <Chip color={upstreamChipColor(server.status)} size="sm" variant="soft">
                        {server.status}
                      </Chip>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-muted font-mono text-xs tabular-nums">
                        {formatUpdatedAt(server.updated_at)}
                      </span>
                      <span title={disabledReason ?? `Reconnect ${server.name}`}>
                        <Button
                          aria-label={`Reconnect upstream ${server.name}`}
                          isDisabled={Boolean(disabledReason)}
                          size="sm"
                          variant="tertiary"
                          onPress={() => void handleReconnectUpstream(server)}
                        >
                          <ArrowsRotateLeft aria-hidden="true" className="size-3.5" />
                          {isReconnecting ? "Reconnecting..." : "Reconnect"}
                        </Button>
                      </span>
                    </div>
                  </div>

                  <code className="text-muted block break-all font-mono text-xs">
                    {server.endpoint}
                  </code>

                  {server.error ? (
                    <div className="border-danger/40 bg-danger/10 text-danger rounded-lg border p-2 font-mono text-xs">
                      {server.error}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsRow>

      <Separator />

      <SettingsRow
        description="Live process run identifier, CLEF LiteRT-LM engine status, admin network boundary, and Ed25519 receipt verifying key."
        label="Runtime & Ed25519 Authority"
      >
        <dl className="border-border bg-surface grid grid-cols-1 gap-x-4 gap-y-2.5 rounded-xl border p-4 text-xs sm:grid-cols-[160px_minmax(0,1fr)]">
          <dt className="text-muted">Run ID</dt>
          <dd className="break-all font-mono tabular-nums">
            {snapshot?.run_id ?? "Unlock session to read run_id"}
          </dd>

          <dt className="text-muted">CLEF Engine</dt>
          <dd className="font-mono">{clefStatus ? formatClefState(clefStatus) : "—"}</dd>

          <dt className="text-muted">CLEF Model Path</dt>
          <dd className="break-all font-mono">{clefModelDetail}</dd>

          <dt className="text-muted">Remote Admin</dt>
          <dd className="font-mono">
            {adminAllowRemote === undefined
              ? "Reading /__proxyfor__/commerce/status..."
              : adminAllowRemote
                ? "true (remote bearer-authenticated peers allowed)"
                : "false (loopback-only: 127.0.0.1 / ::1)"}
          </dd>

          <dt className="text-muted">Ed25519 Public Key</dt>
          <dd className="flex items-start justify-between gap-2">
            <span className="break-all font-mono">
              {snapshot?.public_key ?? "Unlock session to read Ed25519 verifying key"}
            </span>
            <IconButton
              isDisabled={!snapshot?.public_key}
              label={copiedKey ? "Copied Ed25519 public key" : "Copy Ed25519 public key"}
              size="sm"
              tooltip={
                !snapshot?.public_key
                  ? "Unlock session to copy public key"
                  : copiedKey
                    ? "Copied to clipboard"
                    : "Copy Ed25519 public key"
              }
              variant="tertiary"
              onPress={() => void handleCopyPublicKey()}
            >
              {copiedKey ? (
                <CircleCheck aria-hidden="true" className="text-success size-4" />
              ) : (
                <Copy aria-hidden="true" className="size-4" />
              )}
            </IconButton>
          </dd>
        </dl>
      </SettingsRow>
    </div>
  );
}

interface SettingsRowProps {
  children: ReactNode;
  description: string;
  label: string;
}

function SettingsRow({children, description, label}: SettingsRowProps) {
  return (
    <section className="grid grid-cols-1 gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-sm font-medium text-balance">{label}</h2>
        <p className="text-muted text-xs leading-snug text-pretty">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
