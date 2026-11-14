"use client";

import type {InspectorConnection} from "../lib/types";
import type {FormEvent, RefObject} from "react";

import {Button, Input, Label, TextField} from "@heroui/react";
import {NativeSelect} from "@heroui-pro/react";
import {useState} from "react";

interface KeyValueDraft {
  id: string;
  name: string;
  value: string;
}

export interface ConnectFormPayload {
  transport: "http" | "stdio";
  target: string;
  lifecycle: string;
  label: string;
  headers?: Record<string, string>;
  bearer_token?: string;
  env?: Record<string, string>;
}

export interface InspectorConnectionsPaneProps {
  paneRef: RefObject<HTMLElement | null>;
  width: number;
  unlocked: boolean;
  connecting: boolean;
  connectError: string | null;
  connections: InspectorConnection[];
  selectedConnectionId: string | null;
  onConnect: (payload: ConnectFormPayload) => Promise<void>;
  onSelectConnection: (connectionId: string) => void;
}

function makeRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readKvMap(rows: KeyValueDraft[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const row of rows) {
    const trimmed = row.name.trim();

    if (trimmed) {
      out[trimmed] = row.value;
    }
  }

  return out;
}

export function InspectorConnectionsPane({
  connectError,
  connecting,
  connections,
  onConnect,
  onSelectConnection,
  paneRef,
  selectedConnectionId,
  unlocked,
  width,
}: InspectorConnectionsPaneProps) {
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [target, setTarget] = useState("");
  const [lifecycle, setLifecycle] = useState("auto");
  const [label, setLabel] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [headers, setHeaders] = useState<KeyValueDraft[]>([]);
  const [envVars, setEnvVars] = useState<KeyValueDraft[]>([]);

  const applyThisGatewayPreset = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    setTransport("http");
    setTarget(`${origin}/mcp`);
    setLifecycle("2026-07-28");
    setLabel("This gateway");
    setBearerToken("");
    setHeaders([
      {
        id: makeRandomId(),
        name: "Outrider-Session-Id",
        value: makeRandomId(),
      },
    ]);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!unlocked || connecting) return;

    const payload: ConnectFormPayload = {
      label,
      lifecycle,
      target,
      transport,
      ...(transport === "http"
        ? {
            bearer_token: bearerToken,
            headers: readKvMap(headers),
          }
        : {
            env: readKvMap(envVars),
          }),
    };

    await onConnect(payload);
  };

  const connectDisabledReason = !unlocked
    ? "Admin token required"
    : connecting
      ? "Connecting to MCP server"
      : undefined;

  return (
    <aside
      ref={paneRef}
      aria-label="Connections"
      className="border-border bg-surface flex shrink-0 flex-col overflow-y-auto border-b md:border-b-0"
      style={{width: `${width}px`}}
    >
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-foreground text-xs font-semibold text-balance">New Connection</h2>
        <span title={!unlocked ? "Admin token required" : "Fill this gateway's /mcp preset"}>
          <Button
            isDisabled={!unlocked}
            size="sm"
            variant="secondary"
            onPress={applyThisGatewayPreset}
          >
            This gateway
          </Button>
        </span>
      </div>

      <form
        autoComplete="off"
        className="border-border flex flex-col gap-2.5 border-b p-3"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="c-transport">
            Transport
          </Label>
          <NativeSelect fullWidth variant="secondary">
            <NativeSelect.Trigger
              aria-label="Transport"
              className="font-mono text-xs"
              id="c-transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value === "stdio" ? "stdio" : "http")}
            >
              <NativeSelect.Option value="http">Streamable HTTP</NativeSelect.Option>
              <NativeSelect.Option value="stdio">STDIO command</NativeSelect.Option>
            </NativeSelect.Trigger>
          </NativeSelect>
        </div>

        <TextField
          fullWidth
          isRequired
          value={target}
          variant="secondary"
          onChange={setTarget}
        >
          <Label className="text-xs">Target</Label>
          <Input
            aria-label="Target"
            className="font-mono text-xs"
            placeholder={
              transport === "http"
                ? "https://example.com/mcp"
                : "npx -y @modelcontextprotocol/server-everything"
            }
          />
        </TextField>

        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="c-lifecycle">
            Lifecycle
          </Label>
          <NativeSelect fullWidth variant="secondary">
            <NativeSelect.Trigger
              aria-label="Lifecycle"
              className="font-mono text-xs"
              id="c-lifecycle"
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value)}
            >
              <NativeSelect.Option value="auto">
                Auto: server/discover → initialize
              </NativeSelect.Option>
              <NativeSelect.Option value="2026-07-28">
                2026-07-28 only (server/discover)
              </NativeSelect.Option>
              <NativeSelect.Option value="initialize">
                Legacy initialize handshake
              </NativeSelect.Option>
            </NativeSelect.Trigger>
          </NativeSelect>
        </div>

        <TextField
          fullWidth
          value={label}
          variant="secondary"
          onChange={setLabel}
        >
          <Label className="text-xs">Label</Label>
          <Input aria-label="Label" className="font-mono text-xs" placeholder="optional" />
        </TextField>

        {transport === "http" ? (
          <div className="flex flex-col gap-2.5">
            <TextField
              fullWidth
              value={bearerToken}
              variant="secondary"
              onChange={setBearerToken}
            >
              <Label className="text-xs">Bearer token</Label>
              <Input
                aria-label="Bearer token"
                className="font-mono text-xs"
                placeholder="optional Authorization: Bearer"
                type="password"
              />
            </TextField>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted text-xs font-medium">Headers</span>
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() =>
                    setHeaders((prev) => [
                      ...prev,
                      {id: makeRandomId(), name: "", value: ""},
                    ])
                  }
                >
                  + Header
                </Button>
              </div>
              {headers.map((row) => (
                <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
                  <Input
                    aria-label="Header name"
                    className="font-mono text-xs"
                    placeholder="Name"
                    value={row.name}
                    variant="secondary"
                    onChange={(e) =>
                      setHeaders((prev) =>
                        prev.map((r) => (r.id === row.id ? {...r, name: e.target.value} : r)),
                      )
                    }
                  />
                  <Input
                    aria-label="Header value"
                    className="font-mono text-xs"
                    placeholder="Value"
                    type="password"
                    value={row.value}
                    variant="secondary"
                    onChange={(e) =>
                      setHeaders((prev) =>
                        prev.map((r) => (r.id === row.id ? {...r, value: e.target.value} : r)),
                      )
                    }
                  />
                  <Button
                    isIconOnly
                    aria-label="Remove header"
                    size="sm"
                    variant="tertiary"
                    onPress={() => setHeaders((prev) => prev.filter((r) => r.id !== row.id))}
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted text-xs font-medium">Environment</span>
              <Button
                size="sm"
                variant="tertiary"
                onPress={() =>
                  setEnvVars((prev) => [
                    ...prev,
                    {id: makeRandomId(), name: "", value: ""},
                  ])
                }
              >
                + Variable
              </Button>
            </div>
            {envVars.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
                <Input
                  aria-label="Variable name"
                  className="font-mono text-xs"
                  placeholder="Name"
                  value={row.name}
                  variant="secondary"
                  onChange={(e) =>
                    setEnvVars((prev) =>
                      prev.map((r) => (r.id === row.id ? {...r, name: e.target.value} : r)),
                    )
                  }
                />
                <Input
                  aria-label="Variable value"
                  className="font-mono text-xs"
                  placeholder="Value"
                  type="password"
                  value={row.value}
                  variant="secondary"
                  onChange={(e) =>
                    setEnvVars((prev) =>
                      prev.map((r) => (r.id === row.id ? {...r, value: e.target.value} : r)),
                    )
                  }
                />
                <Button
                  isIconOnly
                  aria-label="Remove variable"
                  size="sm"
                  variant="tertiary"
                  onPress={() => setEnvVars((prev) => prev.filter((r) => r.id !== row.id))}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="text-muted text-xs text-pretty">
          Only header and variable names are stored in SQLite; secret values stay in memory.
        </p>

        <div className="flex items-center gap-2">
          <span title={connectDisabledReason}>
            <Button
              isDisabled={Boolean(connectDisabledReason)}
              size="sm"
              type="submit"
            >
              Connect
            </Button>
          </span>
        </div>

        {connectError ? (
          <div
            className="banner bad border-danger/40 bg-danger/10 text-danger rounded-lg border p-2 text-xs text-pretty"
            role="alert"
          >
            {connectError}
          </div>
        ) : null}
      </form>

      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-foreground text-xs font-semibold text-balance">Connections</h2>
        <span className="text-muted font-mono text-xs tabular-nums">{connections.length}</span>
      </div>

      <div className="flex flex-1 flex-col" id="connections">
        {!unlocked ? (
          <div className="text-muted p-3 text-xs text-pretty">
            Enter the admin token above to read persisted connections.
          </div>
        ) : connections.length === 0 ? (
          <div className="text-muted p-3 text-xs text-pretty">
            No connections recorded yet. Choose This gateway or enter a target above.
          </div>
        ) : (
          connections.map((conn) => {
            const isSelected = conn.connection_id === selectedConnectionId;

            return (
              <button
                key={conn.connection_id}
                className={
                  isSelected
                    ? "item selected border-accent bg-accent-soft/20 flex w-full flex-col gap-0.5 border p-2.5 text-left"
                    : "item border-border hover:bg-default/20 flex w-full flex-col gap-0.5 border-b p-2.5 text-left"
                }
                style={{boxShadow: "none"}}
                type="button"
                onClick={() => onSelectConnection(conn.connection_id)}
              >
                <span className="text-foreground truncate font-mono text-xs font-medium">
                  {conn.label}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted truncate font-mono text-xs tabular-nums">
                    {conn.transport} · {new Date(conn.created_at * 1000).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      conn.live
                        ? "text-success shrink-0 font-mono text-xs font-medium"
                        : conn.status === "Failed"
                          ? "text-danger shrink-0 font-mono text-xs font-medium"
                          : "text-muted shrink-0 font-mono text-xs"
                    }
                  >
                    {conn.live ? "Live" : conn.status}
                  </span>
                </div>
                {conn.error ? (
                  <span className="text-danger truncate font-mono text-xs">{conn.error}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
