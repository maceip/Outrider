"use client";

import type {InspectorConnection, InspectorState} from "../lib/types";
import type {InspectorRequestResponse, McpToolDescriptor} from "../widgets/inspector-explorer";

import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  TextField,
  toast,
} from "@heroui/react";
import {Resizable} from "@heroui-pro/react/resizable";
import {useCallback, useEffect, useMemo, useState} from "react";

import {useCoreStore} from "../lib/core-store";
import {InspectorExplorer} from "../widgets/inspector-explorer";
import {InspectorWireLog} from "../widgets/inspector-wire-log";

type InspectorTransport = "http" | "stdio";

interface InspectorConnectResponse {
  connection_id: string;
  status: string;
  server_info: InspectorConnection["server_info"];
  handshake_ms: number;
}

const TRANSPORTS: ReadonlyArray<{id: InspectorTransport; label: string}> = [
  {id: "http", label: "HTTP"},
  {id: "stdio", label: "Stdio"},
];

const NEW_CONNECTION_KEY = "__new__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickDefaultConnectionId(connections: InspectorConnection[]): string | null {
  if (connections.length === 0) return null;
  const liveConn = connections.find((conn) => conn.live);

  return liveConn ? liveConn.connection_id : connections[0].connection_id;
}

export function InspectorPage() {
  const {busy, eventsVersion, fetchInspectorState, mutate, status} = useCoreStore();

  const [transport, setTransport] = useState<InspectorTransport>("http");
  const [httpTargetOverride, setHttpTargetOverride] = useState<string | null>(null);
  const [stdioTarget, setStdioTarget] = useState<string>("");

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [inspectorState, setInspectorState] = useState<InspectorState>({
    connections: [],
    messages: [],
    server_requests: [],
  });
  const [toolsByConnection, setToolsByConnection] = useState<Record<string, McpToolDescriptor[]>>(
    {},
  );

  const defaultHttpTarget = status?.mcp_endpoint ?? "http://localhost:8080/mcp";
  const targetValue = transport === "http" ? (httpTargetOverride ?? defaultHttpTarget) : stdioTarget;

  const activeConnectionId = useMemo(() => {
    if (selectedConnectionId === NEW_CONNECTION_KEY) {
      return null;
    }
    if (
      selectedConnectionId &&
      inspectorState.connections.some((conn) => conn.connection_id === selectedConnectionId)
    ) {
      return selectedConnectionId;
    }

    return pickDefaultConnectionId(inspectorState.connections);
  }, [inspectorState.connections, selectedConnectionId]);

  const activeConn = useMemo(
    () =>
      activeConnectionId
        ? (inspectorState.connections.find((conn) => conn.connection_id === activeConnectionId) ??
          null)
        : null,
    [activeConnectionId, inspectorState.connections],
  );

  const handleToolsLoaded = useCallback((connectionId: string, tools: McpToolDescriptor[]) => {
    setToolsByConnection((prev) => ({...prev, [connectionId]: tools}));
  }, []);

  const refreshActiveState = useCallback(async () => {
    try {
      const next = await fetchInspectorState(activeConnectionId, 0);

      setInspectorState(next);
    } catch {
      // Error toast is surfaced by fetchInspectorState().
    }
  }, [activeConnectionId, fetchInspectorState]);

  // Sync inspector state on mount, when selectedConnectionId/activeConnectionId changes, and on live SSE events
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const requestedId =
          selectedConnectionId === NEW_CONNECTION_KEY ? null : activeConnectionId;
        let state = await fetchInspectorState(requestedId, 0);

        if (cancelled) return;

        if (!requestedId && selectedConnectionId !== NEW_CONNECTION_KEY) {
          const fallbackId = pickDefaultConnectionId(state.connections);

          if (fallbackId) {
            state = await fetchInspectorState(fallbackId, 0);
            if (cancelled) return;
            setSelectedConnectionId(fallbackId);
          }
        }

        setInspectorState(state);
      } catch {
        // Error toast is surfaced by fetchInspectorState().
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, eventsVersion, fetchInspectorState, selectedConnectionId]);

  const handleConnect = async () => {
    const trimmedTarget = targetValue.trim();

    if (!trimmedTarget) {
      toast.danger(
        transport === "http" ? "Enter an MCP HTTP endpoint URL" : "Enter a stdio server command",
      );

      return;
    }

    try {
      const res = await mutate<InspectorConnectResponse>("/inspector/connect", {
        lifecycle: "auto",
        target: trimmedTarget,
        transport,
      });

      const nextId = res.connection_id;

      setSelectedConnectionId(nextId);
      toast.success("Connected");

      try {
        const toolsRes = await mutate<InspectorRequestResponse>("/inspector/request", {
          connection_id: nextId,
          method: "tools/list",
          params: {},
        });

        if (
          toolsRes.kind === "response" &&
          isRecord(toolsRes.result) &&
          Array.isArray(toolsRes.result.tools)
        ) {
          handleToolsLoaded(nextId, toolsRes.result.tools as McpToolDescriptor[]);
        }
      } catch {
        // Servers that do not advertise tools still remain connected.
      }

      const nextState = await fetchInspectorState(nextId, 0);

      setInspectorState(nextState);
    } catch {
      // Error toast is surfaced by mutate().
    }
  };

  const handleDisconnect = async () => {
    if (!activeConn) return;
    try {
      await mutate("/inspector/disconnect", {
        connection_id: activeConn.connection_id,
      });
      const nextState = await fetchInspectorState(activeConn.connection_id, 0);

      setInspectorState(nextState);
    } catch {
      // Error toast is surfaced by mutate().
    }
  };

  const isLive = Boolean(activeConn?.live);
  const connectionSelectValue =
    selectedConnectionId === NEW_CONNECTION_KEY ? NEW_CONNECTION_KEY : activeConnectionId;

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-7xl flex-col gap-3 px-5 pb-5 pt-4">
      <Card className="shrink-0 rounded-2xl p-3">
        <form
          className="flex flex-wrap items-center gap-2 lg:flex-nowrap"
          onSubmit={(event) => {
            event.preventDefault();
            if (isLive) {
              void handleDisconnect();
            } else {
              void handleConnect();
            }
          }}
        >
          <Select
            className="w-[130px] shrink-0"
            isDisabled={busy}
            name="inspector-transport"
            value={transport}
            variant="secondary"
            onChange={(key) => {
              if (key === "http" || key === "stdio") {
                setTransport(key);
              }
            }}
          >
            <Label className="sr-only">Transport</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {TRANSPORTS.map((item) => (
                  <ListBox.Item key={item.id} id={item.id} textValue={item.label}>
                    <Label className="text-xs">{item.label}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <TextField
            fullWidth
            className="min-w-[200px] flex-1"
            isDisabled={busy}
            name="inspector-target"
            value={targetValue}
            onChange={(val) => {
              if (transport === "http") {
                setHttpTargetOverride(val);
              } else {
                setStdioTarget(val);
              }
            }}
          >
            <Label className="sr-only">Target</Label>
            <Input
              fullWidth
              className="font-mono text-xs"
              placeholder={
                transport === "http"
                  ? "http://localhost:8080/mcp"
                  : "npx -y @modelcontextprotocol/server-everything"
              }
              variant="secondary"
            />
          </TextField>

          {inspectorState.connections.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2">
              <Select
                className="w-[210px]"
                isDisabled={busy}
                name="inspector-connection"
                placeholder="Connections"
                value={connectionSelectValue}
                variant="secondary"
                onChange={(key) => {
                  if (typeof key === "string") {
                    setSelectedConnectionId(key);
                  }
                }}
              >
                <Label className="sr-only">Active Connection</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id={NEW_CONNECTION_KEY} textValue="New connection">
                      <Label className="text-xs">New connection</Label>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {inspectorState.connections.map((conn) => (
                      <ListBox.Item
                        key={conn.connection_id}
                        id={conn.connection_id}
                        textValue={conn.label || conn.target}
                      >
                        <Label className="truncate font-mono text-xs">
                          {conn.label || conn.target}
                        </Label>
                        <Description className="text-xs">
                          {conn.live ? "Connected" : conn.status}
                        </Description>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <Chip color={isLive ? "success" : "default"} size="sm" variant="soft">
                {isLive ? "Connected" : "Disconnected"}
              </Chip>
            </div>
          ) : null}

          {isLive ? (
            <Button
              isDisabled={busy}
              isPending={busy}
              size="sm"
              type="button"
              variant="danger-soft"
              onPress={() => {
                void handleDisconnect();
              }}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              isDisabled={busy}
              isPending={busy}
              size="sm"
              type="submit"
            >
              Connect
            </Button>
          )}
        </form>
      </Card>

      <div className="bg-surface border-separator min-h-0 flex-1 overflow-hidden rounded-2xl border">
        <Resizable orientation="horizontal">
          <Resizable.Panel defaultSize={52} minSize={30}>
            <InspectorExplorer
              busy={busy}
              cachedTools={activeConnectionId ? toolsByConnection[activeConnectionId] : undefined}
              connectionId={activeConnectionId}
              isLive={isLive}
              messages={inspectorState.messages}
              mutate={mutate}
              serverRequests={inspectorState.server_requests}
              onRefreshState={refreshActiveState}
              onToolsLoaded={handleToolsLoaded}
            />
          </Resizable.Panel>

          <Resizable.Handle type="drag" variant="secondary" />

          <Resizable.Panel defaultSize={48} minSize={30}>
            <InspectorWireLog messages={inspectorState.messages} />
          </Resizable.Panel>
        </Resizable>
      </div>
    </div>
  );
}
