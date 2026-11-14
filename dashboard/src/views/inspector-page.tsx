"use client";

import type {InspectorConnection, InspectorState} from "../lib/types";
import type {ConnectFormPayload} from "../widgets/inspector-connections-pane";
import type {RpcEnvelopeResult} from "../widgets/inspector-result-view";
import type {JsonSchema, RootEntry} from "../widgets/inspector-schema-form";
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from "react";

import {Button, Chip, Input, Label, TextArea, TextField} from "@heroui/react";
import {NativeSelect} from "@heroui-pro/react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {COMMERCE_API_BASE, useOutrider} from "../lib/outrider-store";
import {InspectorActivityPane} from "../widgets/inspector-activity-pane";
import {InspectorConnectionsPane} from "../widgets/inspector-connections-pane";
import {InspectorResultView} from "../widgets/inspector-result-view";
import {
  InspectorArgsEditor,
  buildInitialSchemaStrings,
  readSchemaValues,
} from "../widgets/inspector-schema-form";

const DEFAULT_LEFT_WIDTH = 240;
const MIN_LEFT_WIDTH = 180;
const MAX_LEFT_WIDTH = 440;

const DEFAULT_RIGHT_WIDTH = 290;
const MIN_RIGHT_WIDTH = 220;
const MAX_RIGHT_WIDTH = 460;

const DEFAULT_CATALOG_WIDTH = 190;
const MIN_CATALOG_WIDTH = 140;
const MAX_CATALOG_WIDTH = 360;

const STANDARD_METHODS = [
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "resources/subscribe",
  "resources/unsubscribe",
  "prompts/list",
  "prompts/get",
  "completion/complete",
  "logging/setLevel",
  "skills/list",
  "skills/get",
  "resources/directory/read",
  "tasks/get",
  "tasks/update",
  "tasks/cancel",
];

const LOG_LEVELS = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

type InspectorMode = "catalog" | "subscriptions" | "roots" | "raw";

interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    [key: string]: unknown;
  };
}

interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

interface McpPromptDescriptor {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

interface McpResourceDescriptor {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface McpTemplateDescriptor {
  name: string;
  uriTemplate: string;
  description?: string;
  mimeType?: string;
}

interface McpSkillDescriptor {
  uri: string;
  name?: string;
  description?: string;
}

interface ConnectionCatalog {
  tools: McpToolDescriptor[];
  prompts: McpPromptDescriptor[];
  resources: McpResourceDescriptor[];
  templates: McpTemplateDescriptor[];
  skills: McpSkillDescriptor[];
  loaded: boolean;
}

type SelectedCatalogEntry =
  | {kind: "tool"; key: string}
  | {kind: "prompt"; key: string}
  | {kind: "resource"; key: string}
  | {kind: "template"; key: string}
  | {kind: "skill"; key: string};

const EMPTY_CATALOG: ConnectionCatalog = {
  loaded: false,
  prompts: [],
  resources: [],
  skills: [],
  templates: [],
  tools: [],
};

function extractTemplateVariables(uriTemplate: string): string[] {
  const matches = [...uriTemplate.matchAll(/\{[+#./;?&]?([^}]+)\}/g)];
  const vars = matches.flatMap((m) =>
    (m[1] ?? "").split(",").map((part) => part.replace(/[*:].*$/, "").trim()),
  );

  return Array.from(new Set(vars.filter(Boolean)));
}

function expandUriTemplate(uriTemplate: string, values: Record<string, string>): string {
  return uriTemplate.replace(/\{([+#./;?&]?)([^}]+)\}/g, (_, op: string, names: string) =>
    names
      .split(",")
      .map((rawName) => {
        const clean = rawName.replace(/[*:].*$/, "").trim();
        const val = values[clean] ?? "";

        return op === "+" || op === "#" ? encodeURI(val) : encodeURIComponent(val);
      })
      .join(","),
  );
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {error?: string};

    return `${response.status}: ${json.error || response.statusText || "Request failed"}`;
  } catch {
    return `${response.status}: ${response.statusText || "Request failed"}`;
  }
}

export function InspectorPage() {
  const {
    fetchInspectorState,
    lastUpdatedAt,
    refresh,
    setStatusMessage,
    token,
    unlocked,
  } = useOutrider();

  const [inspectorState, setInspectorState] = useState<InspectorState | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [inFlightCount, setInFlightCount] = useState(0);

  const [mode, setMode] = useState<InspectorMode>("catalog");

  // Split pane widths
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [catalogWidth, setCatalogWidth] = useState(DEFAULT_CATALOG_WIDTH);

  const leftPaneRef = useRef<HTMLElement | null>(null);
  const rightPaneRef = useRef<HTMLElement | null>(null);
  const catalogPaneRef = useRef<HTMLDivElement | null>(null);

  // Per-connection catalogs, selected items, argument drafts, roots, and results
  const [catalogs, setCatalogs] = useState<Record<string, ConnectionCatalog>>({});
  const [selectedEntryByConn, setSelectedEntryByConn] = useState<
    Record<string, SelectedCatalogEntry | null>
  >({});
  const [resultsByConn, setResultsByConn] = useState<
    Record<string, Record<string, RpcEnvelopeResult>>
  >({});
  const [rootsByConn, setRootsByConn] = useState<Record<string, RootEntry[]>>({});

  // Tool runner form state (keyed logically when selection changes)
  const [toolArgsMode, setToolArgsMode] = useState<"form" | "json">("form");
  const [toolFormValues, setToolFormValues] = useState<Record<string, string>>({});
  const [toolRawArgs, setToolRawArgs] = useState("{}");

  // Prompt & Template runner form state
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({});
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [completionOptions, setCompletionOptions] = useState<Record<string, string[]>>({});

  // Subscriptions state
  const [subTools, setSubTools] = useState(true);
  const [subPrompts, setSubPrompts] = useState(true);
  const [subResources, setSubResources] = useState(true);
  const [subResourceUris, setSubResourceUris] = useState("");

  // Roots editor text
  const [rootsDraftText, setRootsDraftText] = useState("[]");

  // Raw JSON-RPC state
  const [logLevel, setLogLevel] = useState("info");
  const [rawMethod, setRawMethod] = useState("tools/list");
  const [rawParams, setRawParams] = useState("");
  const [rawTimeoutMs, setRawTimeoutMs] = useState("60000");

  const inspectorPost = useCallback(
    async <T = unknown>(path: string, body: unknown): Promise<T> => {
      if (!unlocked || !token) {
        throw new Error("401: Admin bearer token required");
      }
      const response = await fetch(`${COMMERCE_API_BASE}${path}`, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }

      return (await response.json()) as T;
    },
    [token, unlocked],
  );

  const syncInspectorState = useCallback(
    async (explicitConnectionId?: string | null) => {
      if (!unlocked) return null;
      const cid =
        explicitConnectionId !== undefined ? explicitConnectionId : selectedConnectionId;

      try {
        const next = await fetchInspectorState(cid, 0);

        setInspectorState(next);

        return next;
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to load inspector state",
          true,
        );

        return null;
      }
    },
    [fetchInspectorState, selectedConnectionId, setStatusMessage, unlocked],
  );

  // Sync on unlock, selectedConnectionId change, or global snapshot SSE tick
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    void (async () => {
      try {
        const next = await fetchInspectorState(selectedConnectionId, 0);

        if (!cancelled) {
          setInspectorState(next);
        }
      } catch {
        // Handled by fetchInspectorState
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchInspectorState, lastUpdatedAt, selectedConnectionId, unlocked]);

  // Dedicated SSE listener on /__proxyfor__/commerce/events for instant inspector.* events
  useEffect(() => {
    if (!unlocked || !token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void syncInspectorState();
      }, 40);
    };

    void (async () => {
      try {
        const response = await fetch(`${COMMERCE_API_BASE}/events`, {
          cache: "no-store",
          headers: {Authorization: `Bearer ${token}`},
          signal: controller.signal,
        });

        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (!controller.signal.aborted) {
          const {done, value} = await reader.read();

          if (done) break;
          if (value && decoder.decode(value, {stream: true}).includes("inspector")) {
            scheduleSync();
          }
        }
      } catch {
        // Ignore abort / network teardown
      }
    })();

    return () => {
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [syncInspectorState, token, unlocked]);

  const hasPendingServerRequests = useMemo(
    () =>
      (inspectorState?.server_requests ?? []).some((req) => req.status === "Pending"),
    [inspectorState?.server_requests],
  );

  // Fast 350ms poll while an RPC request is in-flight or a server request is Pending
  useEffect(() => {
    if (!unlocked || (inFlightCount === 0 && !hasPendingServerRequests)) return;

    const interval = setInterval(() => {
      void syncInspectorState();
    }, 350);

    return () => clearInterval(interval);
  }, [hasPendingServerRequests, inFlightCount, syncInspectorState, unlocked]);

  const connections = useMemo(
    () => (unlocked ? (inspectorState?.connections ?? []) : []),
    [inspectorState?.connections, unlocked],
  );

  const selectedConnection = useMemo<InspectorConnection | null>(() => {
    if (!selectedConnectionId) return null;

    return connections.find((c) => c.connection_id === selectedConnectionId) ?? null;
  }, [connections, selectedConnectionId]);

  const protocolVersion = useMemo<string | null>(() => {
    const info = selectedConnection?.server_info;

    if (!info) return null;
    if (typeof info.protocolVersion === "string" && info.protocolVersion) {
      return info.protocolVersion;
    }
    const supported = info.supportedVersions;

    if (Array.isArray(supported) && typeof supported[0] === "string") {
      return supported[0];
    }

    return null;
  }, [selectedConnection?.server_info]);

  const hasCapability = useCallback(
    (capName: string): boolean => {
      const caps = selectedConnection?.server_info?.capabilities;

      return Boolean(caps && caps[capName]);
    },
    [selectedConnection?.server_info?.capabilities],
  );

  const sendRpc = useCallback(
    async (
      connectionId: string,
      method: string,
      params?: unknown,
      timeoutMs?: number,
    ): Promise<RpcEnvelopeResult> => {
      setInFlightCount((c) => c + 1);
      try {
        const res = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
          connection_id: connectionId,
          method,
          ...(params !== undefined ? {params} : {}),
          ...(timeoutMs !== undefined ? {timeout_ms: timeoutMs} : {}),
        });

        if (res.kind === "error") {
          const errMessage =
            typeof res.result?.message === "string"
              ? res.result.message
              : JSON.stringify(res.result);

          setStatusMessage(`${method} → error: ${errMessage}`, true);
        } else {
          const isInputReq =
            res.result?.resultType === "input_required" ||
            res.result?.status === "input_required";

          setStatusMessage(
            `${method} → ${isInputReq ? "input required" : "ok"} in ${res.latency_ms ?? 0} ms`,
            false,
          );
        }

        return res;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "RPC request failed";

        setStatusMessage(msg, true);

        return {
          kind: "error",
          result: {message: msg},
        };
      } finally {
        setInFlightCount((c) => Math.max(0, c - 1));
        void syncInspectorState(connectionId);
        void refresh();
      }
    },
    [inspectorPost, refresh, setStatusMessage, syncInspectorState],
  );

  const listAllPages = useCallback(
    async <T,>(connectionId: string, method: string, arrayKey: string): Promise<T[]> => {
      const collected: T[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const res = await sendRpc(
          connectionId,
          method,
          cursor ? {cursor} : undefined,
        );

        if (res.kind === "error" || !res.result) break;
        const pageItems = res.result[arrayKey];

        if (Array.isArray(pageItems)) {
          collected.push(...(pageItems as T[]));
        }
        cursor =
          typeof res.result.nextCursor === "string" && res.result.nextCursor
            ? res.result.nextCursor
            : undefined;
        pages += 1;
      } while (cursor && pages < 50);

      return collected;
    },
    [sendRpc],
  );

  const loadCatalogForConnection = useCallback(
    async (connectionId: string, serverInfo: InspectorConnection["server_info"]) => {
      const caps = serverInfo?.capabilities ?? {};

      setCatalogLoading(true);
      try {
        const tools = caps.tools
          ? await listAllPages<McpToolDescriptor>(connectionId, "tools/list", "tools")
          : [];
        const prompts = caps.prompts
          ? await listAllPages<McpPromptDescriptor>(connectionId, "prompts/list", "prompts")
          : [];
        const resources = caps.resources
          ? await listAllPages<McpResourceDescriptor>(
              connectionId,
              "resources/list",
              "resources",
            )
          : [];
        const templates = caps.resources
          ? await listAllPages<McpTemplateDescriptor>(
              connectionId,
              "resources/templates/list",
              "resourceTemplates",
            )
          : [];
        const skills = caps.skills
          ? await listAllPages<McpSkillDescriptor>(connectionId, "skills/list", "skills")
          : [];

        setCatalogs((prev) => ({
          ...prev,
          [connectionId]: {
            loaded: true,
            prompts,
            resources,
            skills,
            templates,
            tools,
          },
        }));
      } finally {
        setCatalogLoading(false);
        await syncInspectorState(connectionId);
      }
    },
    [listAllPages, syncInspectorState],
  );

  const handleConnect = useCallback(
    async (payload: ConnectFormPayload) => {
      setConnectError(null);
      setConnecting(true);
      setStatusMessage(`Connecting to ${payload.target} …`, false);
      try {
        const res = await inspectorPost<{
          connection_id: string;
          handshake_ms: number;
          server_info: InspectorConnection["server_info"];
        }>("/inspector/connect", payload);

        setSelectedConnectionId(res.connection_id);
        setMode("catalog");
        setStatusMessage(`Connected in ${res.handshake_ms} ms.`, false);
        await syncInspectorState(res.connection_id);
        void refresh();
        await loadCatalogForConnection(res.connection_id, res.server_info);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to connect";

        setConnectError(msg);
        setStatusMessage(msg, true);
        await syncInspectorState();
      } finally {
        setConnecting(false);
      }
    },
    [inspectorPost, loadCatalogForConnection, refresh, setStatusMessage, syncInspectorState],
  );

  const handleSelectConnection = useCallback(
    (connectionId: string) => {
      setSelectedConnectionId(connectionId);
      const nextRoots = rootsByConn[connectionId] ?? [];

      setRootsDraftText(JSON.stringify(nextRoots, null, 2));
      void syncInspectorState(connectionId);
    },
    [rootsByConn, syncInspectorState],
  );

  const handleDisconnect = useCallback(async () => {
    if (!selectedConnectionId) return;
    try {
      await inspectorPost("/inspector/disconnect", {connection_id: selectedConnectionId});
      setStatusMessage("Disconnected.", false);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to disconnect",
        true,
      );
    }
    await syncInspectorState(selectedConnectionId);
    void refresh();
  }, [inspectorPost, refresh, selectedConnectionId, setStatusMessage, syncInspectorState]);

  const handlePing = useCallback(async () => {
    if (!selectedConnectionId) return;
    const res = await sendRpc(selectedConnectionId, "ping");

    setStatusMessage(
      `ping → ${res.kind} in ${res.latency_ms ?? 0} ms`,
      res.kind === "error",
    );
  }, [selectedConnectionId, sendRpc, setStatusMessage]);

  const handleRefreshCatalog = useCallback(async () => {
    if (!selectedConnection) return;
    await loadCatalogForConnection(
      selectedConnection.connection_id,
      selectedConnection.server_info,
    );
  }, [loadCatalogForConnection, selectedConnection]);

  const saveConnectionResult = useCallback(
    (connectionId: string, resultKey: string, envelope: RpcEnvelopeResult) => {
      setResultsByConn((prev) => ({
        ...prev,
        [connectionId]: {
          ...(prev[connectionId] ?? {}),
          [resultKey]: envelope,
        },
      }));
    },
    [],
  );

  const currentCatalog = selectedConnectionId
    ? (catalogs[selectedConnectionId] ?? EMPTY_CATALOG)
    : EMPTY_CATALOG;

  const selectedEntry = selectedConnectionId
    ? (selectedEntryByConn[selectedConnectionId] ?? null)
    : null;

  const currentRoots = selectedConnectionId ? (rootsByConn[selectedConnectionId] ?? []) : [];

  const selectCatalogEntry = useCallback(
    (entry: SelectedCatalogEntry) => {
      if (!selectedConnectionId) return;
      setSelectedEntryByConn((prev) => ({...prev, [selectedConnectionId]: entry}));

      if (entry.kind === "tool") {
        const tool = currentCatalog.tools.find((t) => t.name === entry.key);

        setToolArgsMode("form");
        setToolFormValues(buildInitialSchemaStrings(tool?.inputSchema));
        setToolRawArgs("{}");
      } else if (entry.kind === "prompt") {
        setPromptArgs({});
      } else if (entry.kind === "template") {
        setTemplateVars({});
      }
    },
    [currentCatalog.tools, selectedConnectionId],
  );

  const fetchCompletions = useCallback(
    async (
      refPayload: Record<string, string>,
      argName: string,
      argValue: string,
      completionKey: string,
    ) => {
      if (!selectedConnectionId || !selectedConnection?.live || !hasCapability("completions")) {
        return;
      }
      try {
        const res = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
          connection_id: selectedConnectionId,
          method: "completion/complete",
          params: {
            argument: {name: argName, value: argValue},
            ref: refPayload,
          },
        });
        const values = (
          res.result as {completion?: {values?: unknown[]}} | null
        )?.completion?.values;

        if (Array.isArray(values)) {
          setCompletionOptions((prev) => ({
            ...prev,
            [completionKey]: values.map((v) => String(v)),
          }));
        }
        void syncInspectorState(selectedConnectionId);
      } catch {
        // Ignore transient completion errors
      }
    },
    [hasCapability, inspectorPost, selectedConnection?.live, selectedConnectionId, syncInspectorState],
  );

  const handleRunTool = useCallback(
    async (tool: McpToolDescriptor, extraParams: Record<string, unknown> = {}) => {
      if (!selectedConnectionId) return;
      let parsedArgs: Record<string, unknown>;

      try {
        parsedArgs =
          toolArgsMode === "json"
            ? (JSON.parse(toolRawArgs.trim() || "{}") as Record<string, unknown>)
            : readSchemaValues(tool.inputSchema, toolFormValues);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Invalid tool arguments";

        setStatusMessage(msg, true);

        return;
      }

      const envelope = await sendRpc(selectedConnectionId, "tools/call", {
        arguments: parsedArgs,
        name: tool.name,
        ...extraParams,
      });

      saveConnectionResult(selectedConnectionId, `tool:${tool.name}`, envelope);
    },
    [
      saveConnectionResult,
      selectedConnectionId,
      sendRpc,
      setStatusMessage,
      toolArgsMode,
      toolFormValues,
      toolRawArgs,
    ],
  );

  const handleGetPrompt = useCallback(
    async (prompt: McpPromptDescriptor, extraParams: Record<string, unknown> = {}) => {
      if (!selectedConnectionId) return;
      const argsOut: Record<string, string> = {};

      for (const arg of prompt.arguments ?? []) {
        const val = promptArgs[arg.name] ?? "";

        if (val) {
          argsOut[arg.name] = val;
        } else if (arg.required) {
          setStatusMessage(`${arg.name} is required`, true);

          return;
        }
      }

      const envelope = await sendRpc(selectedConnectionId, "prompts/get", {
        arguments: argsOut,
        name: prompt.name,
        ...extraParams,
      });

      saveConnectionResult(selectedConnectionId, `prompt:${prompt.name}`, envelope);
    },
    [promptArgs, saveConnectionResult, selectedConnectionId, sendRpc, setStatusMessage],
  );

  const handleReadResourceUri = useCallback(
    async (uri: string, extraParams: Record<string, unknown> = {}) => {
      if (!selectedConnectionId) return;
      const envelope = await sendRpc(selectedConnectionId, "resources/read", {
        uri,
        ...extraParams,
      });

      saveConnectionResult(selectedConnectionId, `resource:${uri}`, envelope);
      setSelectedEntryByConn((prev) => ({
        ...prev,
        [selectedConnectionId]: {key: uri, kind: "resource"},
      }));
    },
    [saveConnectionResult, selectedConnectionId, sendRpc],
  );

  const handleSubscribeResource = useCallback(
    async (uri: string) => {
      if (!selectedConnectionId) return;
      try {
        if (protocolVersion === "2026-07-28") {
          await inspectorPost("/inspector/listen", {
            connection_id: selectedConnectionId,
            resource_uris: [uri],
          });
          setStatusMessage(`Listening for updates to ${uri}`, false);
          await syncInspectorState(selectedConnectionId);
        } else {
          await sendRpc(selectedConnectionId, "resources/subscribe", {uri});
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to subscribe to resource",
          true,
        );
      }
    },
    [inspectorPost, protocolVersion, selectedConnectionId, sendRpc, setStatusMessage, syncInspectorState],
  );

  const handleGetSkill = useCallback(
    async (uri: string, extraParams: Record<string, unknown> = {}) => {
      if (!selectedConnectionId) return;
      const envelope = await sendRpc(selectedConnectionId, "skills/get", {
        uri,
        ...extraParams,
      });

      saveConnectionResult(selectedConnectionId, `skill:${uri}`, envelope);
    },
    [saveConnectionResult, selectedConnectionId, sendRpc],
  );

  const handleListenSubscriptions = useCallback(async () => {
    if (!selectedConnectionId) return;
    const uris = subResourceUris
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await inspectorPost<{acknowledged: unknown}>("/inspector/listen", {
        connection_id: selectedConnectionId,
        prompts: subPrompts,
        resources: subResources,
        tools: subTools,
        ...(uris.length > 0 ? {resource_uris: uris} : {}),
      });

      setStatusMessage(
        `Listening. Acknowledged: ${JSON.stringify(res.acknowledged)}`,
        false,
      );
      await syncInspectorState(selectedConnectionId);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to open subscription stream",
        true,
      );
    }
  }, [
    inspectorPost,
    selectedConnectionId,
    setStatusMessage,
    subPrompts,
    subResourceUris,
    subResources,
    subTools,
    syncInspectorState,
  ]);

  const handleApplyRoots = useCallback(async () => {
    if (!selectedConnectionId) return;
    try {
      const parsed = JSON.parse(rootsDraftText.trim() || "[]") as RootEntry[];

      if (!Array.isArray(parsed)) {
        throw new Error("Roots JSON must be an array of {uri, name?}");
      }
      await inspectorPost("/inspector/roots", {
        connection_id: selectedConnectionId,
        roots: parsed,
      });
      setRootsByConn((prev) => ({...prev, [selectedConnectionId]: parsed}));
      setStatusMessage(`Roots applied (${parsed.length}).`, false);
      await syncInspectorState(selectedConnectionId);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to apply roots",
        true,
      );
    }
  }, [inspectorPost, rootsDraftText, selectedConnectionId, setStatusMessage, syncInspectorState]);

  const handleSendRawRequest = useCallback(
    async (extraParams: Record<string, unknown> = {}) => {
      if (!selectedConnectionId) return;
      let parsedParams: Record<string, unknown> | undefined;

      try {
        parsedParams = rawParams.trim()
          ? (JSON.parse(rawParams) as Record<string, unknown>)
          : undefined;
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Params JSON must be valid JSON",
          true,
        );

        return;
      }

      const merged =
        parsedParams || Object.keys(extraParams).length > 0
          ? {...(parsedParams ?? {}), ...extraParams}
          : undefined;
      const timeoutNum = Number(rawTimeoutMs) || 60_000;
      const envelope = await sendRpc(
        selectedConnectionId,
        rawMethod.trim(),
        merged,
        timeoutNum,
      );

      saveConnectionResult(selectedConnectionId, "raw", envelope);
    },
    [rawMethod, rawParams, rawTimeoutMs, saveConnectionResult, selectedConnectionId, sendRpc, setStatusMessage],
  );

  const handleSendRawNotification = useCallback(async () => {
    if (!selectedConnectionId) return;
    try {
      const parsedParams: unknown = rawParams.trim() ? JSON.parse(rawParams) : undefined;

      await inspectorPost("/inspector/notify", {
        connection_id: selectedConnectionId,
        method: rawMethod.trim(),
        ...(parsedParams !== undefined ? {params: parsedParams} : {}),
      });
      setStatusMessage("Notification sent.", false);
      await syncInspectorState(selectedConnectionId);
      void refresh();
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to send notification",
        true,
      );
    }
  }, [inspectorPost, rawMethod, rawParams, refresh, selectedConnectionId, setStatusMessage, syncInspectorState]);

  const handleAnswerServerRequest = useCallback(
    async (requestId: string, result: unknown) => {
      await inspectorPost("/inspector/answer", {
        request_id: requestId,
        result,
      });
      setStatusMessage("Answer delivered to the server.", false);
      await syncInspectorState();
      void refresh();
    },
    [inspectorPost, refresh, setStatusMessage, syncInspectorState],
  );

  const handleRejectServerRequest = useCallback(
    async (requestId: string, reason: string) => {
      await inspectorPost("/inspector/answer", {
        reject: reason,
        request_id: requestId,
      });
      setStatusMessage("Rejected.", false);
      await syncInspectorState();
      void refresh();
    },
    [inspectorPost, refresh, setStatusMessage, syncInspectorState],
  );

  const handleReplayMessage = useCallback(
    async (method: string, params: unknown) => {
      if (!selectedConnectionId) return;
      const envelope = await sendRpc(selectedConnectionId, method, params);

      saveConnectionResult(selectedConnectionId, "raw", envelope);
      setRawMethod(method);
      setRawParams(params !== undefined ? JSON.stringify(params, null, 2) : "");
    },
    [saveConnectionResult, selectedConnectionId, sendRpc],
  );

  // Drag & keyboard handlers for the 3 horizontal split separators
  const startHorizontalDrag = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      getCurrentWidth: () => number,
      minW: number,
      maxW: number,
      invertDelta: boolean,
      setter: (w: number) => void,
    ) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = getCurrentWidth();

      const onMove = (moveEvent: MouseEvent) => {
        const rawDelta = moveEvent.clientX - startX;
        const delta = invertDelta ? -rawDelta : rawDelta;
        const clamped = Math.max(minW, Math.min(maxW, Math.round(startWidth + delta)));

        setter(clamped);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [],
  );

  const handleSeparatorKey = useCallback(
    (
      event: ReactKeyboardEvent<HTMLDivElement>,
      minW: number,
      maxW: number,
      defaultW: number,
      invertArrows: boolean,
      setter: (updater: (prev: number) => number) => void,
    ) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setter((w) =>
          Math.max(minW, Math.min(maxW, w + (invertArrows ? -16 : 16))),
        );
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setter((w) =>
          Math.max(minW, Math.min(maxW, w + (invertArrows ? 16 : -16))),
        );
      } else if (event.key === "Home") {
        event.preventDefault();
        setter(() => defaultW);
      }
    },
    [],
  );

  const liveDisabledReason = !unlocked
    ? "Admin token required"
    : !selectedConnection
      ? "No connection selected"
      : !selectedConnection.live
        ? "Connection is not live"
        : undefined;

  const listenDisabledReason =
    liveDisabledReason ??
    (protocolVersion && protocolVersion !== "2026-07-28"
      ? "Legacy servers push notifications without a subscriptions/listen request"
      : undefined);

  const connResults = selectedConnectionId ? (resultsByConn[selectedConnectionId] ?? {}) : {};

  const declaredCapabilities = useMemo(() => {
    const caps = selectedConnection?.server_info?.capabilities;

    if (!caps) return [];

    return [
      "tools",
      "resources",
      "prompts",
      "logging",
      "completions",
      "skills",
      "tasks",
      "subscriptions",
    ].filter((k) => Boolean(caps[k]));
  }, [selectedConnection?.server_info?.capabilities]);

  const storedNamesNotice = useMemo(() => {
    if (!selectedConnection) return null;
    const names = [
      ...(selectedConnection.header_names ?? []),
      ...(selectedConnection.env_names ?? []),
    ];

    return names.length > 0 ? `Sent ${names.join(", ")} (values not stored)` : null;
  }, [selectedConnection]);

  return (
    <div className="flex flex-col px-3 pb-4 pt-2">
      <section
        aria-label="MCP protocol inspector workbench"
        className="border-border bg-surface flex min-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-xl border md:flex-row"
        id="inspector-layout"
      >
        {/* Left Pane: Connections */}
        <InspectorConnectionsPane
          connectError={connectError}
          connecting={connecting}
          connections={connections}
          paneRef={leftPaneRef}
          selectedConnectionId={selectedConnectionId}
          unlocked={unlocked}
          width={leftWidth}
          onConnect={handleConnect}
          onSelectConnection={handleSelectConnection}
        />

        {/* Separator 1: Resize connections pane */}
        <div
          aria-label="Resize connections pane"
          aria-orientation="vertical"
          aria-valuemax={MAX_LEFT_WIDTH}
          aria-valuemin={MIN_LEFT_WIDTH}
          aria-valuenow={leftWidth}
          className="bg-border/60 hover:bg-accent/50 hidden min-h-[420px] w-1.5 shrink-0 select-none md:block"
          role="separator"
          style={{cursor: "ew-resize", touchAction: "none"}}
          tabIndex={0}
          onDoubleClick={() => setLeftWidth(DEFAULT_LEFT_WIDTH)}
          onKeyDown={(e) =>
            handleSeparatorKey(
              e,
              MIN_LEFT_WIDTH,
              MAX_LEFT_WIDTH,
              DEFAULT_LEFT_WIDTH,
              false,
              setLeftWidth,
            )
          }
          onMouseDown={(e) =>
            startHorizontalDrag(
              e,
              () => leftPaneRef.current?.getBoundingClientRect().width ?? leftWidth,
              MIN_LEFT_WIDTH,
              MAX_LEFT_WIDTH,
              false,
              setLeftWidth,
            )
          }
        />

        {/* Center Pane: Server Header + Modes + Runner */}
        <main
          aria-label="Server"
          className="bg-background flex min-w-0 flex-1 flex-col overflow-y-auto"
        >
          {/* #server-head */}
          <div className="border-border flex flex-col gap-2 border-b p-3" id="server-head">
            {!selectedConnection ? (
              <p className="text-muted text-xs">Select or create a connection.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Max 2:1 adjacent label density: 1 primary title + 1 protocol meta + 1 .badge */}
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <strong className="text-foreground truncate font-mono text-sm font-semibold">
                      {selectedConnection.server_info?.serverInfo?.name ||
                        selectedConnection.label}
                    </strong>
                    <span className="text-muted font-mono text-xs tabular-nums">
                      {selectedConnection.live
                        ? [
                            selectedConnection.server_info?.serverInfo?.version
                              ? `v${selectedConnection.server_info.serverInfo.version}`
                              : null,
                            protocolVersion ? `protocol ${protocolVersion}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || selectedConnection.transport
                        : `Not live${protocolVersion ? ` · protocol ${protocolVersion}` : ""}`}
                    </span>
                    <Chip
                      className="badge font-mono text-xs"
                      color={selectedConnection.live ? "success" : "default"}
                      size="sm"
                      variant="soft"
                    >
                      {selectedConnection.live ? "Live" : "Not live"}
                    </Chip>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span title={liveDisabledReason ?? "Send MCP ping"}>
                      <Button
                        isDisabled={!selectedConnection.live}
                        size="sm"
                        variant="secondary"
                        onPress={() => void handlePing()}
                      >
                        Ping
                      </Button>
                    </span>
                    <span title={liveDisabledReason ?? "Reload server catalog"}>
                      <Button
                        isDisabled={!selectedConnection.live || catalogLoading}
                        size="sm"
                        variant="secondary"
                        onPress={() => void handleRefreshCatalog()}
                      >
                        Refresh Catalog
                      </Button>
                    </span>
                    <span title={liveDisabledReason ?? "Close live MCP connection"}>
                      <Button
                        isDisabled={!selectedConnection.live}
                        size="sm"
                        variant="danger-soft"
                        onPress={() => void handleDisconnect()}
                      >
                        Disconnect
                      </Button>
                    </span>
                  </div>
                </div>

                <div className="text-muted truncate font-mono text-xs">
                  {selectedConnection.transport} · {selectedConnection.target}
                </div>

                {!selectedConnection.live ? (
                  <div className="banner border-warning/40 bg-warning/10 text-warning rounded-lg border p-2 text-xs text-pretty">
                    {selectedConnection.status === "Failed"
                      ? `Connection failed: ${selectedConnection.error ?? "Unknown error"}`
                      : "Not live. Recorded history is shown; reconnect to send requests."}
                  </div>
                ) : null}

                {selectedConnection.server_info ? (
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="text-muted font-mono text-xs">
                      Capabilities:{" "}
                      {declaredCapabilities.length > 0
                        ? declaredCapabilities.join(", ")
                        : "none declared"}
                    </span>
                    {storedNamesNotice ? (
                      <span className="text-muted font-mono text-xs">{storedNamesNotice}</span>
                    ) : null}
                    {selectedConnection.server_info.instructions ? (
                      <details className="text-xs">
                        <summary className="text-muted cursor-pointer font-mono text-xs">
                          Server instructions
                        </summary>
                        <pre className="border-border bg-surface mt-1 max-h-40 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
                          {selectedConnection.server_info.instructions}
                        </pre>
                      </details>
                    ) : null}
                    <details className="text-xs">
                      <summary className="text-muted cursor-pointer font-mono text-xs">
                        Handshake result
                      </summary>
                      <pre className="border-border bg-surface mt-1 max-h-48 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
                        {JSON.stringify(selectedConnection.server_info, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Mode Switcher */}
          <nav
            aria-label="Inspector modes"
            className="border-border bg-surface flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5"
          >
            <Button
              size="sm"
              variant={mode === "catalog" ? "primary" : "tertiary"}
              onPress={() => setMode("catalog")}
            >
              CATALOG
            </Button>
            <Button
              size="sm"
              variant={mode === "subscriptions" ? "primary" : "tertiary"}
              onPress={() => setMode("subscriptions")}
            >
              SUBSCRIPTIONS
            </Button>
            <Button
              size="sm"
              variant={mode === "roots" ? "primary" : "tertiary"}
              onPress={() => setMode("roots")}
            >
              ROOTS
            </Button>
            <Button
              size="sm"
              variant={mode === "raw" ? "primary" : "tertiary"}
              onPress={() => setMode("raw")}
            >
              RAW JSON-RPC
            </Button>
          </nav>

          {/* #pane */}
          <div className="flex flex-1 flex-col" id="pane">
            {!unlocked ? (
              <div className="text-muted p-4 text-xs text-pretty">
                Admin token required. Enter the token in the top bar to unlock the MCP inspector.
              </div>
            ) : !selectedConnection ? (
              <div className="text-muted p-4 text-xs text-pretty">
                Connect to an MCP server on the left (choose This gateway to inspect Outrider&apos;s
                own /mcp endpoint) or select a recorded connection.
              </div>
            ) : mode === "catalog" ? (
              <div className="split flex min-h-[400px] flex-1 flex-col md:flex-row">
                {/* First div child of .split: Catalog List */}
                <div
                  ref={catalogPaneRef}
                  className="border-border bg-surface flex shrink-0 flex-col overflow-y-auto border-b md:border-b-0"
                  style={{width: `${catalogWidth}px`}}
                >
                  {/* TOOLS (<n>) */}
                  <div className="border-border bg-background/60 border-b px-3 py-1.5 font-mono text-xs font-semibold tabular-nums">
                    TOOLS ({currentCatalog.tools.length})
                  </div>
                  {currentCatalog.tools.map((tool) => {
                    const isSelected =
                      selectedEntry?.kind === "tool" && selectedEntry.key === tool.name;

                    return (
                      <button
                        key={`tool-${tool.name}`}
                        className={
                          isSelected
                            ? "item selected border-accent bg-accent-soft/20 flex w-full flex-col gap-0.5 border px-3 py-2 text-left"
                            : "item border-border hover:bg-default/20 flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left"
                        }
                        style={{boxShadow: "none"}}
                        type="button"
                        onClick={() => selectCatalogEntry({key: tool.name, kind: "tool"})}
                      >
                        <span className="text-foreground truncate font-mono text-xs font-medium">
                          {tool.name}
                        </span>
                        {tool.description ? (
                          <span className="text-muted truncate text-xs">{tool.description}</span>
                        ) : null}
                      </button>
                    );
                  })}

                  {/* PROMPTS (<n>) */}
                  <div className="border-border bg-background/60 border-b px-3 py-1.5 font-mono text-xs font-semibold tabular-nums">
                    PROMPTS ({currentCatalog.prompts.length})
                  </div>
                  {currentCatalog.prompts.map((prompt) => {
                    const isSelected =
                      selectedEntry?.kind === "prompt" && selectedEntry.key === prompt.name;

                    return (
                      <button
                        key={`prompt-${prompt.name}`}
                        className={
                          isSelected
                            ? "item selected border-accent bg-accent-soft/20 flex w-full flex-col gap-0.5 border px-3 py-2 text-left"
                            : "item border-border hover:bg-default/20 flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left"
                        }
                        style={{boxShadow: "none"}}
                        type="button"
                        onClick={() => selectCatalogEntry({key: prompt.name, kind: "prompt"})}
                      >
                        <span className="text-foreground truncate font-mono text-xs font-medium">
                          {prompt.name}
                        </span>
                        {prompt.description ? (
                          <span className="text-muted truncate text-xs">{prompt.description}</span>
                        ) : null}
                      </button>
                    );
                  })}

                  {/* RESOURCES (<n>) */}
                  <div className="border-border bg-background/60 border-b px-3 py-1.5 font-mono text-xs font-semibold tabular-nums">
                    RESOURCES ({currentCatalog.resources.length})
                  </div>
                  {currentCatalog.resources.map((resource) => {
                    const isSelected =
                      selectedEntry?.kind === "resource" && selectedEntry.key === resource.uri;

                    return (
                      <button
                        key={`resource-${resource.uri}`}
                        className={
                          isSelected
                            ? "item selected border-accent bg-accent-soft/20 flex w-full flex-col gap-0.5 border px-3 py-2 text-left"
                            : "item border-border hover:bg-default/20 flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left"
                        }
                        style={{boxShadow: "none"}}
                        type="button"
                        onClick={() => selectCatalogEntry({key: resource.uri, kind: "resource"})}
                      >
                        <span className="text-foreground truncate font-mono text-xs font-medium">
                          {resource.name || resource.uri}
                        </span>
                        <span className="text-muted truncate font-mono text-xs">
                          {resource.uri}
                        </span>
                      </button>
                    );
                  })}

                  {/* TEMPLATES (<n>) */}
                  <div className="border-border bg-background/60 border-b px-3 py-1.5 font-mono text-xs font-semibold tabular-nums">
                    TEMPLATES ({currentCatalog.templates.length})
                  </div>
                  {currentCatalog.templates.map((tpl) => {
                    const isSelected =
                      selectedEntry?.kind === "template" && selectedEntry.key === tpl.uriTemplate;

                    return (
                      <button
                        key={`template-${tpl.uriTemplate}`}
                        className={
                          isSelected
                            ? "item selected border-accent bg-accent-soft/20 flex w-full flex-col gap-0.5 border px-3 py-2 text-left"
                            : "item border-border hover:bg-default/20 flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left"
                        }
                        style={{boxShadow: "none"}}
                        type="button"
                        onClick={() =>
                          selectCatalogEntry({key: tpl.uriTemplate, kind: "template"})
                        }
                      >
                        <span className="text-foreground truncate font-mono text-xs font-medium">
                          {tpl.name}
                        </span>
                        <span className="text-muted truncate font-mono text-xs">
                          {tpl.uriTemplate}
                        </span>
                      </button>
                    );
                  })}

                  {/* SKILLS (<n>) */}
                  <div className="border-border bg-background/60 border-b px-3 py-1.5 font-mono text-xs font-semibold tabular-nums">
                    SKILLS ({currentCatalog.skills.length})
                  </div>
                  {currentCatalog.skills.map((skill) => {
                    const isSelected =
                      selectedEntry?.kind === "skill" && selectedEntry.key === skill.uri;

                    return (
                      <button
                        key={`skill-${skill.uri}`}
                        className={
                          isSelected
                            ? "item selected border-accent bg-accent-soft/20 flex w-full flex-col gap-0.5 border px-3 py-2 text-left"
                            : "item border-border hover:bg-default/20 flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left"
                        }
                        style={{boxShadow: "none"}}
                        type="button"
                        onClick={() => selectCatalogEntry({key: skill.uri, kind: "skill"})}
                      >
                        <span className="text-foreground truncate font-mono text-xs font-medium">
                          {skill.name || skill.uri}
                        </span>
                        <span className="text-muted truncate text-xs">
                          {skill.description || skill.uri}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Separator 3: Resize catalog list */}
                <div
                  aria-label="Resize catalog list"
                  aria-orientation="vertical"
                  aria-valuemax={MAX_CATALOG_WIDTH}
                  aria-valuemin={MIN_CATALOG_WIDTH}
                  aria-valuenow={catalogWidth}
                  className="bg-border/60 hover:bg-accent/50 hidden min-h-[360px] w-1.5 shrink-0 select-none md:block"
                  role="separator"
                  style={{cursor: "ew-resize", touchAction: "none"}}
                  tabIndex={0}
                  onDoubleClick={() => setCatalogWidth(DEFAULT_CATALOG_WIDTH)}
                  onKeyDown={(e) =>
                    handleSeparatorKey(
                      e,
                      MIN_CATALOG_WIDTH,
                      MAX_CATALOG_WIDTH,
                      DEFAULT_CATALOG_WIDTH,
                      false,
                      setCatalogWidth,
                    )
                  }
                  onMouseDown={(e) =>
                    startHorizontalDrag(
                      e,
                      () =>
                        catalogPaneRef.current?.getBoundingClientRect().width ?? catalogWidth,
                      MIN_CATALOG_WIDTH,
                      MAX_CATALOG_WIDTH,
                      false,
                      setCatalogWidth,
                    )
                  }
                />

                {/* Right Detail Runner */}
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
                  {!selectedEntry ? (
                    <p className="text-muted text-xs text-pretty">
                      Select a tool, prompt, resource, template, or skill from the catalog list.
                    </p>
                  ) : selectedEntry.kind === "tool" ? (
                    (() => {
                      const tool = currentCatalog.tools.find((t) => t.name === selectedEntry.key);

                      if (!tool) {
                        return <p className="text-muted text-xs">Tool not found in catalog.</p>;
                      }
                      const ann = tool.annotations ?? {};
                      const hintParts = [
                        ann.readOnlyHint !== undefined ? `read-only: ${String(ann.readOnlyHint)}` : null,
                        ann.destructiveHint !== undefined
                          ? `destructive: ${String(ann.destructiveHint)}`
                          : null,
                        ann.idempotentHint !== undefined
                          ? `idempotent: ${String(ann.idempotentHint)}`
                          : null,
                        ann.openWorldHint !== undefined
                          ? `open-world: ${String(ann.openWorldHint)}`
                          : null,
                      ].filter(Boolean);
                      const toolResult = connResults[`tool:${tool.name}`] ?? null;

                      return (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <strong className="text-foreground font-mono text-sm font-semibold">
                              {tool.title || tool.annotations?.title || tool.name}
                            </strong>
                            {tool.title ? (
                              <span className="text-muted font-mono text-xs">{tool.name}</span>
                            ) : null}
                            {tool.description ? (
                              <p className="text-muted text-xs text-pretty">{tool.description}</p>
                            ) : null}
                            {hintParts.length > 0 ? (
                              <span className="text-muted font-mono text-xs">
                                {hintParts.join(" · ")}
                              </span>
                            ) : null}
                          </div>

                          <InspectorArgsEditor
                            formValues={toolFormValues}
                            mode={toolArgsMode}
                            rawJson={toolRawArgs}
                            schema={tool.inputSchema}
                            onFormValuesChange={setToolFormValues}
                            onRawJsonChange={setToolRawArgs}
                            onToggleMode={() => {
                              try {
                                if (toolArgsMode === "form") {
                                  const obj = readSchemaValues(tool.inputSchema, toolFormValues);

                                  setToolRawArgs(JSON.stringify(obj, null, 2));
                                  setToolArgsMode("json");
                                } else {
                                  const parsed = JSON.parse(toolRawArgs.trim() || "{}") as Record<
                                    string,
                                    unknown
                                  >;

                                  setToolFormValues(
                                    buildInitialSchemaStrings(tool.inputSchema, parsed),
                                  );
                                  setToolArgsMode("form");
                                }
                              } catch (error) {
                                setStatusMessage(
                                  error instanceof Error ? error.message : "Invalid JSON",
                                  true,
                                );
                              }
                            }}
                          />

                          <div>
                            <span title={liveDisabledReason}>
                              <Button
                                isDisabled={Boolean(liveDisabledReason)}
                                size="sm"
                                onPress={() => void handleRunTool(tool)}
                              >
                                Run tool
                              </Button>
                            </span>
                          </div>

                          <details className="border-border bg-surface rounded-lg border p-2 text-xs">
                            <summary className="text-muted cursor-pointer font-mono text-xs">
                              Input schema{tool.outputSchema ? " / output schema" : ""}
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap break-words">
                              {JSON.stringify(tool.inputSchema ?? {}, null, 2)}
                            </pre>
                            {tool.outputSchema ? (
                              <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs whitespace-pre-wrap break-words">
                                {JSON.stringify(tool.outputSchema, null, 2)}
                              </pre>
                            ) : null}
                          </details>

                          <InspectorResultView
                            envelope={toolResult}
                            roots={currentRoots}
                            onReadResource={(uri) => void handleReadResourceUri(uri)}
                            onResume={(extra) => handleRunTool(tool, extra)}
                            onValidationError={(msg) => setStatusMessage(msg, true)}
                          />
                        </div>
                      );
                    })()
                  ) : selectedEntry.kind === "prompt" ? (
                    (() => {
                      const prompt = currentCatalog.prompts.find(
                        (p) => p.name === selectedEntry.key,
                      );

                      if (!prompt) {
                        return <p className="text-muted text-xs">Prompt not found in catalog.</p>;
                      }
                      const promptResult = connResults[`prompt:${prompt.name}`] ?? null;

                      return (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <strong className="text-foreground font-mono text-sm font-semibold">
                              {prompt.title || prompt.name}
                            </strong>
                            {prompt.description ? (
                              <p className="text-muted text-xs text-pretty">{prompt.description}</p>
                            ) : null}
                          </div>

                          {(prompt.arguments ?? []).length === 0 ? (
                            <p className="text-muted text-xs">No arguments.</p>
                          ) : (
                            (prompt.arguments ?? []).map((arg) => {
                              const dlId = `prompt-dl-${prompt.name}-${arg.name}`;
                              const opts = completionOptions[dlId] ?? [];

                              return (
                                <div key={arg.name} className="flex flex-col gap-1">
                                  <Label
                                    className="font-mono text-xs"
                                    htmlFor={`prompt-arg-${arg.name}`}
                                  >
                                    {arg.name}
                                    {arg.required ? " *" : ""}
                                  </Label>
                                  <Input
                                    fullWidth
                                    aria-label={arg.name}
                                    className="font-mono text-xs"
                                    id={`prompt-arg-${arg.name}`}
                                    list={dlId}
                                    value={promptArgs[arg.name] ?? ""}
                                    variant="secondary"
                                    onChange={(e) => {
                                      const val = e.target.value;

                                      setPromptArgs((prev) => ({...prev, [arg.name]: val}));
                                      void fetchCompletions(
                                        {name: prompt.name, type: "ref/prompt"},
                                        arg.name,
                                        val,
                                        dlId,
                                      );
                                    }}
                                  />
                                  <datalist id={dlId}>
                                    {opts.map((opt) => (
                                      <option key={opt} value={opt} />
                                    ))}
                                  </datalist>
                                  {arg.description ? (
                                    <span className="text-muted text-xs">{arg.description}</span>
                                  ) : null}
                                </div>
                              );
                            })
                          )}

                          <div>
                            <span title={liveDisabledReason}>
                              <Button
                                isDisabled={Boolean(liveDisabledReason)}
                                size="sm"
                                onPress={() => void handleGetPrompt(prompt)}
                              >
                                Get prompt
                              </Button>
                            </span>
                          </div>

                          <InspectorResultView
                            envelope={promptResult}
                            roots={currentRoots}
                            onReadResource={(uri) => void handleReadResourceUri(uri)}
                            onResume={(extra) => handleGetPrompt(prompt, extra)}
                            onValidationError={(msg) => setStatusMessage(msg, true)}
                          />
                        </div>
                      );
                    })()
                  ) : selectedEntry.kind === "resource" ? (
                    (() => {
                      const uri = selectedEntry.key;
                      const resource = currentCatalog.resources.find((r) => r.uri === uri);
                      const resourceResult = connResults[`resource:${uri}`] ?? null;

                      return (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <strong className="text-foreground font-mono text-sm font-semibold">
                              {resource?.name || uri}
                            </strong>
                            <span className="text-muted font-mono text-xs break-all">
                              {uri}
                              {resource?.mimeType ? ` · ${resource.mimeType}` : ""}
                            </span>
                            {resource?.description ? (
                              <p className="text-muted text-xs text-pretty">
                                {resource.description}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span title={liveDisabledReason}>
                              <Button
                                isDisabled={Boolean(liveDisabledReason)}
                                size="sm"
                                onPress={() => void handleReadResourceUri(uri)}
                              >
                                Read resource
                              </Button>
                            </span>
                            <span title={liveDisabledReason}>
                              <Button
                                isDisabled={Boolean(liveDisabledReason)}
                                size="sm"
                                variant="secondary"
                                onPress={() => void handleSubscribeResource(uri)}
                              >
                                Subscribe to updates
                              </Button>
                            </span>
                          </div>

                          <InspectorResultView
                            envelope={resourceResult}
                            roots={currentRoots}
                            onReadResource={(nextUri) => void handleReadResourceUri(nextUri)}
                            onResume={(extra) => handleReadResourceUri(uri, extra)}
                            onValidationError={(msg) => setStatusMessage(msg, true)}
                          />
                        </div>
                      );
                    })()
                  ) : selectedEntry.kind === "template" ? (
                    (() => {
                      const tpl = currentCatalog.templates.find(
                        (t) => t.uriTemplate === selectedEntry.key,
                      );

                      if (!tpl) {
                        return <p className="text-muted text-xs">Template not found.</p>;
                      }
                      const vars = extractTemplateVariables(tpl.uriTemplate);
                      const resolvedUri = expandUriTemplate(tpl.uriTemplate, templateVars);
                      const tplResult = connResults[`resource:${resolvedUri}`] ?? null;

                      return (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <strong className="text-foreground font-mono text-sm font-semibold">
                              {tpl.name}
                            </strong>
                            <span className="text-muted font-mono text-xs break-all">
                              {tpl.uriTemplate}
                            </span>
                            {tpl.description ? (
                              <p className="text-muted text-xs text-pretty">{tpl.description}</p>
                            ) : null}
                          </div>

                          {vars.map((varName) => {
                            const dlId = `tpl-dl-${tpl.name}-${varName}`;
                            const opts = completionOptions[dlId] ?? [];

                            return (
                              <div key={varName} className="flex flex-col gap-1">
                                <Label
                                  className="font-mono text-xs"
                                  htmlFor={`tpl-var-${varName}`}
                                >
                                  {varName}
                                </Label>
                                <Input
                                  fullWidth
                                  aria-label={varName}
                                  className="font-mono text-xs"
                                  id={`tpl-var-${varName}`}
                                  list={dlId}
                                  value={templateVars[varName] ?? ""}
                                  variant="secondary"
                                  onChange={(e) => {
                                    const val = e.target.value;

                                    setTemplateVars((prev) => ({...prev, [varName]: val}));
                                    void fetchCompletions(
                                      {type: "ref/resource", uri: tpl.uriTemplate},
                                      varName,
                                      val,
                                      dlId,
                                    );
                                  }}
                                />
                                <datalist id={dlId}>
                                  {opts.map((opt) => (
                                    <option key={opt} value={opt} />
                                  ))}
                                </datalist>
                              </div>
                            );
                          })}

                          <div>
                            <span title={liveDisabledReason}>
                              <Button
                                isDisabled={Boolean(liveDisabledReason)}
                                size="sm"
                                onPress={() => void handleReadResourceUri(resolvedUri)}
                              >
                                Read resource
                              </Button>
                            </span>
                          </div>

                          <InspectorResultView
                            envelope={tplResult}
                            roots={currentRoots}
                            onReadResource={(nextUri) => void handleReadResourceUri(nextUri)}
                            onResume={(extra) => handleReadResourceUri(resolvedUri, extra)}
                            onValidationError={(msg) => setStatusMessage(msg, true)}
                          />
                        </div>
                      );
                    })()
                  ) : (
                    (() => {
                      const uri = selectedEntry.key;
                      const skill = currentCatalog.skills.find((s) => s.uri === uri);
                      const skillResult = connResults[`skill:${uri}`] ?? null;

                      return (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1">
                            <strong className="text-foreground font-mono text-sm font-semibold">
                              {skill?.name || uri}
                            </strong>
                            <span className="text-muted font-mono text-xs break-all">{uri}</span>
                            {skill?.description ? (
                              <p className="text-muted text-xs text-pretty">{skill.description}</p>
                            ) : null}
                          </div>

                          <div>
                            <span title={liveDisabledReason}>
                              <Button
                                isDisabled={Boolean(liveDisabledReason)}
                                size="sm"
                                onPress={() => void handleGetSkill(uri)}
                              >
                                Get skill
                              </Button>
                            </span>
                          </div>

                          <InspectorResultView
                            envelope={skillResult}
                            roots={currentRoots}
                            onReadResource={(nextUri) => void handleReadResourceUri(nextUri)}
                            onResume={(extra) => handleGetSkill(uri, extra)}
                            onValidationError={(msg) => setStatusMessage(msg, true)}
                          />
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            ) : mode === "subscriptions" ? (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-foreground text-sm font-semibold text-balance">
                    Subscriptions / Listen (MCP 2026-07-28)
                  </h2>
                  <p className="text-muted text-xs text-pretty">
                    Opens a 2026-07-28 subscriptions/listen stream on this connection; every
                    delivered notification is persisted in SQLite history.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      aria-label="tools list changed"
                      checked={subTools}
                      type="checkbox"
                      onChange={(e) => setSubTools(e.target.checked)}
                    />
                    <span className="font-mono">tools list changed</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      aria-label="prompts list changed"
                      checked={subPrompts}
                      type="checkbox"
                      onChange={(e) => setSubPrompts(e.target.checked)}
                    />
                    <span className="font-mono">prompts list changed</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      aria-label="resources list changed"
                      checked={subResources}
                      type="checkbox"
                      onChange={(e) => setSubResources(e.target.checked)}
                    />
                    <span className="font-mono">resources list changed</span>
                  </label>
                </div>

                <TextField
                  fullWidth
                  value={subResourceUris}
                  variant="secondary"
                  onChange={setSubResourceUris}
                >
                  <Label className="text-xs">Resource URIs</Label>
                  <TextArea
                    aria-label="Resource URIs"
                    className="min-h-20 font-mono text-xs"
                    placeholder="Optional comma- or newline-separated resource URIs"
                  />
                </TextField>

                <div className="flex flex-wrap items-center gap-2">
                  <span title={listenDisabledReason}>
                    <Button
                      isDisabled={Boolean(listenDisabledReason)}
                      size="sm"
                      onPress={() => void handleListenSubscriptions()}
                    >
                      Listen
                    </Button>
                  </span>
                  {listenDisabledReason ? (
                    <span className="text-muted text-xs">{listenDisabledReason}</span>
                  ) : null}
                </div>
              </div>
            ) : mode === "roots" ? (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-foreground text-sm font-semibold text-balance">
                    Client Roots
                  </h2>
                  <p className="text-muted text-xs text-pretty">
                    Answered to server roots/list requests and MRTR input requests. Applying sends
                    notifications/roots/list_changed to the connected server.
                  </p>
                </div>

                <TextField
                  fullWidth
                  value={rootsDraftText}
                  variant="secondary"
                  onChange={setRootsDraftText}
                >
                  <Label className="text-xs">Roots JSON</Label>
                  <TextArea
                    aria-label="Roots JSON"
                    className="min-h-32 font-mono text-xs"
                    placeholder='[{"uri":"file:///workspace","name":"workspace"}]'
                  />
                </TextField>

                <div>
                  <span title={liveDisabledReason}>
                    <Button
                      isDisabled={Boolean(liveDisabledReason)}
                      size="sm"
                      onPress={() => void handleApplyRoots()}
                    >
                      Apply roots
                    </Button>
                  </span>
                </div>
              </div>
            ) : (
              /* RAW JSON-RPC */
              <div className="flex flex-col gap-3 p-4">
                <div className="border-border bg-surface flex flex-wrap items-end gap-2 rounded-lg border p-3">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs" htmlFor="raw-log-level">
                      Log level
                    </Label>
                    <NativeSelect variant="secondary">
                      <NativeSelect.Trigger
                        aria-label="Log level"
                        className="font-mono text-xs"
                        id="raw-log-level"
                        value={logLevel}
                        onChange={(e) => setLogLevel(e.target.value)}
                      >
                        {LOG_LEVELS.map((lvl) => (
                          <NativeSelect.Option key={lvl} value={lvl}>
                            {lvl}
                          </NativeSelect.Option>
                        ))}
                      </NativeSelect.Trigger>
                    </NativeSelect>
                  </div>
                  <span title={liveDisabledReason}>
                    <Button
                      isDisabled={Boolean(liveDisabledReason)}
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        if (selectedConnectionId) {
                          void sendRpc(selectedConnectionId, "logging/setLevel", {
                            level: logLevel,
                          });
                        }
                      }}
                    >
                      Set server log level
                    </Button>
                  </span>
                  {!hasCapability("logging") ? (
                    <span className="text-muted text-xs">Server did not declare logging</span>
                  ) : null}
                </div>

                <TextField
                  fullWidth
                  value={rawMethod}
                  variant="secondary"
                  onChange={setRawMethod}
                >
                  <Label className="text-xs">Method</Label>
                  <Input
                    aria-label="Method"
                    className="font-mono text-xs"
                    list="inspector-rpc-methods"
                  />
                </TextField>
                <datalist id="inspector-rpc-methods">
                  {STANDARD_METHODS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>

                <TextField
                  fullWidth
                  value={rawParams}
                  variant="secondary"
                  onChange={setRawParams}
                >
                  <Label className="text-xs">Params JSON</Label>
                  <TextArea
                    aria-label="Params JSON"
                    className="min-h-28 font-mono text-xs"
                    placeholder='{"name": "..."} or leave blank'
                  />
                </TextField>

                <TextField
                  fullWidth
                  value={rawTimeoutMs}
                  variant="secondary"
                  onChange={setRawTimeoutMs}
                >
                  <Label className="text-xs">Timeout ms</Label>
                  <Input
                    aria-label="Timeout ms"
                    className="font-mono text-xs tabular-nums"
                    type="number"
                  />
                </TextField>

                <div className="flex flex-wrap items-center gap-2">
                  <span title={liveDisabledReason}>
                    <Button
                      isDisabled={Boolean(liveDisabledReason)}
                      size="sm"
                      onPress={() => void handleSendRawRequest()}
                    >
                      Send request
                    </Button>
                  </span>
                  <span title={liveDisabledReason}>
                    <Button
                      isDisabled={Boolean(liveDisabledReason)}
                      size="sm"
                      variant="secondary"
                      onPress={() => void handleSendRawNotification()}
                    >
                      Send notification
                    </Button>
                  </span>
                </div>

                <InspectorResultView
                  envelope={connResults.raw ?? null}
                  roots={currentRoots}
                  onReadResource={(uri) => void handleReadResourceUri(uri)}
                  onResume={(extra) => handleSendRawRequest(extra)}
                  onValidationError={(msg) => setStatusMessage(msg, true)}
                />
              </div>
            )}
          </div>
        </main>

        {/* Separator 2: Resize activity pane */}
        <div
          aria-label="Resize activity pane"
          aria-orientation="vertical"
          aria-valuemax={MAX_RIGHT_WIDTH}
          aria-valuemin={MIN_RIGHT_WIDTH}
          aria-valuenow={rightWidth}
          className="bg-border/60 hover:bg-accent/50 hidden min-h-[420px] w-1.5 shrink-0 select-none md:block"
          role="separator"
          style={{cursor: "ew-resize", touchAction: "none"}}
          tabIndex={0}
          onDoubleClick={() => setRightWidth(DEFAULT_RIGHT_WIDTH)}
          onKeyDown={(e) =>
            handleSeparatorKey(
              e,
              MIN_RIGHT_WIDTH,
              MAX_RIGHT_WIDTH,
              DEFAULT_RIGHT_WIDTH,
              true,
              setRightWidth,
            )
          }
          onMouseDown={(e) =>
            startHorizontalDrag(
              e,
              () => rightPaneRef.current?.getBoundingClientRect().width ?? rightWidth,
              MIN_RIGHT_WIDTH,
              MAX_RIGHT_WIDTH,
              true,
              setRightWidth,
            )
          }
        />

        {/* Right Pane: Activity (Server Requests + History) */}
        <InspectorActivityPane
          connectionLive={Boolean(selectedConnection?.live)}
          messages={inspectorState?.messages ?? []}
          paneRef={rightPaneRef}
          roots={currentRoots}
          selectedConnectionId={selectedConnectionId}
          serverRequests={inspectorState?.server_requests ?? []}
          width={rightWidth}
          onAnswerRequest={handleAnswerServerRequest}
          onRejectRequest={handleRejectServerRequest}
          onReplayMessage={handleReplayMessage}
          onStatus={setStatusMessage}
        />
      </section>
    </div>
  );
}
