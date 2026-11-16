"use client";

import type {InspectorMessage, InspectorServerRequest} from "../lib/types";

import {Terminal} from "@gravity-ui/icons";
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  ScrollShadow,
  Select,
  Surface,
  Switch,
  Tabs,
  TextArea,
  TextField,
  toast,
} from "@heroui/react";
import {EmptyState} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {useMemo, useState} from "react";

export interface McpToolSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
}

export interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, McpToolSchemaProperty>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplateDescriptor {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface InspectorRequestResponse {
  kind: "response" | "error" | (string & {});
  result: unknown;
  latency_ms: number;
  request_message_id: number;
  message_id: number;
}

export interface InspectorExplorerProps {
  connectionId: string | null;
  isLive: boolean;
  busy: boolean;
  messages: InspectorMessage[];
  serverRequests: InspectorServerRequest[];
  cachedTools?: McpToolDescriptor[];
  onToolsLoaded: (connectionId: string, tools: McpToolDescriptor[]) => void;
  mutate: <T = unknown>(path: string, body: unknown) => Promise<T>;
  onRefreshState: () => Promise<void>;
}

const RAW_METHOD_PRESETS: ReadonlyArray<{id: string; label: string}> = [
  {id: "ping", label: "ping"},
  {id: "server/discover", label: "server/discover"},
  {id: "tools/list", label: "tools/list"},
  {id: "resources/list", label: "resources/list"},
  {id: "prompts/list", label: "prompts/list"},
  {id: "skills/list", label: "skills/list"},
];

type PrimitiveFieldType = "string" | "number" | "integer" | "boolean";

interface ExtractedSchemaField {
  name: string;
  fieldType: PrimitiveFieldType;
  description?: string;
  required: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePrimitiveType(rawType: string | string[] | undefined): PrimitiveFieldType | null {
  const candidates = Array.isArray(rawType) ? rawType : rawType ? [rawType] : [];

  for (const entry of candidates) {
    if (
      entry === "string" ||
      entry === "number" ||
      entry === "integer" ||
      entry === "boolean"
    ) {
      return entry;
    }
  }

  return null;
}

function extractToolFields(tool: McpToolDescriptor | null): ExtractedSchemaField[] {
  if (!tool?.inputSchema || !isRecord(tool.inputSchema.properties)) {
    return [];
  }
  const requiredSet = new Set(
    Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [],
  );
  const fields: ExtractedSchemaField[] = [];

  for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
    if (!isRecord(prop)) continue;
    const fieldType = resolvePrimitiveType(
      prop.type as string | string[] | undefined,
    );

    if (!fieldType) continue;
    fields.push({
      description: typeof prop.description === "string" ? prop.description : undefined,
      fieldType,
      name,
      required: requiredSet.has(name),
    });
  }

  return fields;
}

function parseJsonObjectSafe(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonObjectOrToast(text: string, label: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (!isRecord(parsed)) {
      toast.danger(`${label} must be a JSON object`);

      return null;
    }

    return parsed;
  } catch {
    toast.danger(`Invalid JSON in ${label}`);

    return null;
  }
}

function parseAnyJsonOrToast(text: string, label: string): {ok: true; value: unknown} | {ok: false} {
  const trimmed = text.trim();

  if (!trimmed) return {ok: true, value: {}};
  try {
    return {ok: true, value: JSON.parse(trimmed) as unknown};
  } catch {
    toast.danger(`Invalid JSON in ${label}`);

    return {ok: false};
  }
}

function extractLatestArrayFromMessages<T>(
  messages: InspectorMessage[],
  method: string,
  field: string,
): T[] | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];

    if (msg.kind === "response" && msg.method === method && isRecord(msg.body)) {
      const arr = msg.body[field];

      if (Array.isArray(arr)) {
        return arr as T[];
      }
    }
  }

  return null;
}

function buildDefaultServerAnswer(method: string): string {
  if (method === "sampling/createMessage") {
    return JSON.stringify(
      {
        content: {
          text: "",
          type: "text",
        },
        model: "operator",
        role: "assistant",
        stopReason: "endTurn",
      },
      null,
      2,
    );
  }
  if (method === "elicitation/create") {
    return JSON.stringify(
      {
        action: "accept",
        content: {},
      },
      null,
      2,
    );
  }

  return "{}";
}

function getRequestStatusColor(
  status: string,
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "Pending":
      return "warning";
    case "Answered":
      return "success";
    case "Rejected":
      return "danger";
    default:
      return "default";
  }
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

export function InspectorExplorer({
  busy,
  cachedTools,
  connectionId,
  isLive,
  messages,
  mutate,
  onRefreshState,
  onToolsLoaded,
  serverRequests,
}: InspectorExplorerProps) {
  const [activeTab, setActiveTab] = useState<string>("tools");

  // Tools state
  const [selectedToolOverride, setSelectedToolOverride] = useState<string | null>(null);
  const [toolArgsByKey, setToolArgsByKey] = useState<Record<string, string>>({});
  const [toolResultByKey, setToolResultByKey] = useState<Record<string, string>>({});

  // Resources state
  const [resourcesByConn, setResourcesByConn] = useState<Record<string, McpResourceDescriptor[]>>(
    {},
  );
  const [templatesByConn, setTemplatesByConn] = useState<
    Record<string, McpResourceTemplateDescriptor[]>
  >({});
  const [resourceUriByConn, setResourceUriByConn] = useState<Record<string, string>>({});
  const [resourceResultByConn, setResourceResultByConn] = useState<Record<string, string>>({});

  // Prompts state
  const [promptsByConn, setPromptsByConn] = useState<Record<string, McpPromptDescriptor[]>>({});
  const [selectedPromptOverride, setSelectedPromptOverride] = useState<string | null>(null);
  const [promptArgsByKey, setPromptArgsByKey] = useState<Record<string, string>>({});
  const [promptResultByKey, setPromptResultByKey] = useState<Record<string, string>>({});

  // Server Requests answers keyed by request_id
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});

  // Raw JSON-RPC state
  const [rawPreset, setRawPreset] = useState<string>("ping");
  const [rawMethod, setRawMethod] = useState<string>("ping");
  const [rawParamsText, setRawParamsText] = useState<string>("{}");
  const [rawResultByConn, setRawResultByConn] = useState<Record<string, string>>({});

  const tools = useMemo<McpToolDescriptor[]>(() => {
    if (cachedTools) return cachedTools;

    return extractLatestArrayFromMessages<McpToolDescriptor>(messages, "tools/list", "tools") ?? [];
  }, [cachedTools, messages]);

  const resources = useMemo<McpResourceDescriptor[]>(() => {
    if (connectionId && resourcesByConn[connectionId]) {
      return resourcesByConn[connectionId];
    }

    return (
      extractLatestArrayFromMessages<McpResourceDescriptor>(
        messages,
        "resources/list",
        "resources",
      ) ?? []
    );
  }, [connectionId, messages, resourcesByConn]);

  const resourceTemplates = useMemo<McpResourceTemplateDescriptor[]>(() => {
    if (connectionId && templatesByConn[connectionId]) {
      return templatesByConn[connectionId];
    }

    return (
      extractLatestArrayFromMessages<McpResourceTemplateDescriptor>(
        messages,
        "resources/templates/list",
        "resourceTemplates",
      ) ?? []
    );
  }, [connectionId, messages, templatesByConn]);

  const prompts = useMemo<McpPromptDescriptor[]>(() => {
    if (connectionId && promptsByConn[connectionId]) {
      return promptsByConn[connectionId];
    }

    return (
      extractLatestArrayFromMessages<McpPromptDescriptor>(messages, "prompts/list", "prompts") ?? []
    );
  }, [connectionId, messages, promptsByConn]);

  const selectedTool = useMemo<McpToolDescriptor | null>(() => {
    if (tools.length === 0) return null;
    if (selectedToolOverride) {
      const match = tools.find((item) => item.name === selectedToolOverride);

      if (match) return match;
    }

    return tools[0];
  }, [selectedToolOverride, tools]);

  const connKey = connectionId ?? "none";
  const toolKey = `${connKey}:${selectedTool?.name ?? ""}`;
  const toolArgsText = toolArgsByKey[toolKey] ?? "{}";
  const toolResult = toolResultByKey[toolKey] ?? null;
  const parsedToolArgs = useMemo(() => parseJsonObjectSafe(toolArgsText), [toolArgsText]);
  const toolSchemaFields = useMemo(() => extractToolFields(selectedTool), [selectedTool]);

  const resourceUri = resourceUriByConn[connKey] ?? "";
  const resourceResult = resourceResultByConn[connKey] ?? null;

  const selectedPrompt = useMemo<McpPromptDescriptor | null>(() => {
    if (prompts.length === 0) return null;
    if (selectedPromptOverride) {
      const match = prompts.find((item) => item.name === selectedPromptOverride);

      if (match) return match;
    }

    return prompts[0];
  }, [prompts, selectedPromptOverride]);

  const promptKey = `${connKey}:${selectedPrompt?.name ?? ""}`;
  const defaultPromptArgs = useMemo(() => {
    if (!selectedPrompt?.arguments || selectedPrompt.arguments.length === 0) {
      return "{}";
    }
    const seed: Record<string, string> = {};

    for (const arg of selectedPrompt.arguments) {
      seed[arg.name] = "";
    }

    return JSON.stringify(seed, null, 2);
  }, [selectedPrompt]);
  const promptArgsText = promptArgsByKey[promptKey] ?? defaultPromptArgs;
  const promptResult = promptResultByKey[promptKey] ?? null;
  const rawResult = rawResultByConn[connKey] ?? null;

  const pendingRequests = useMemo(
    () => serverRequests.filter((req) => req.status === "Pending"),
    [serverRequests],
  );

  if (!isLive || !connectionId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon">
              <Terminal />
            </EmptyState.Media>
            <EmptyState.Title>No Live Connection</EmptyState.Title>
            <EmptyState.Description>
              Click Connect in the toolbar above to open an MCP session and explore tools,
              resources, prompts, and raw requests.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </div>
    );
  }

  const setToolArgs = (nextText: string) => {
    setToolArgsByKey((prev) => ({...prev, [toolKey]: nextText}));
  };

  const updateToolSchemaField = (
    field: ExtractedSchemaField,
    rawValue: string | boolean,
  ) => {
    const nextObj: Record<string, unknown> = {...parsedToolArgs};

    if (field.fieldType === "boolean") {
      nextObj[field.name] = Boolean(rawValue);
    } else if (field.fieldType === "number" || field.fieldType === "integer") {
      const str = String(rawValue).trim();

      if (!str) {
        delete nextObj[field.name];
      } else {
        const num = Number(str);

        if (Number.isFinite(num)) {
          nextObj[field.name] = field.fieldType === "integer" ? Math.trunc(num) : num;
        }
      }
    } else {
      const str = String(rawValue);

      if (!str && !field.required) {
        delete nextObj[field.name];
      } else {
        nextObj[field.name] = str;
      }
    }

    setToolArgs(JSON.stringify(nextObj, null, 2));
  };

  const handleRefreshTools = async () => {
    try {
      const res = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "tools/list",
        params: {},
      });

      if (res.kind === "response" && isRecord(res.result) && Array.isArray(res.result.tools)) {
        onToolsLoaded(connectionId, res.result.tools as McpToolDescriptor[]);
      }
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const setResourceUri = (nextUri: string) => {
    setResourceUriByConn((prev) => ({...prev, [connectionId]: nextUri}));
  };

  const handleRunTool = async () => {
    if (!selectedTool) return;
    const parsed = parseJsonObjectOrToast(toolArgsText, "JSON arguments");

    if (!parsed) return;
    try {
      const res = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "tools/call",
        params: {
          arguments: parsed,
          name: selectedTool.name,
        },
      });

      setToolResultByKey((prev) => ({...prev, [toolKey]: formatJson(res.result)}));
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleListResources = async () => {
    try {
      const listRes = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "resources/list",
        params: {},
      });

      if (
        listRes.kind === "response" &&
        isRecord(listRes.result) &&
        Array.isArray(listRes.result.resources)
      ) {
        const nextResources = listRes.result.resources as McpResourceDescriptor[];

        setResourcesByConn((prev) => ({...prev, [connectionId]: nextResources}));
        if (!resourceUri && nextResources.length > 0) {
          setResourceUri(nextResources[0].uri);
        }
      }

      const tplRes = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "resources/templates/list",
        params: {},
      });

      if (
        tplRes.kind === "response" &&
        isRecord(tplRes.result) &&
        Array.isArray(tplRes.result.resourceTemplates)
      ) {
        const nextTemplates = tplRes.result.resourceTemplates as McpResourceTemplateDescriptor[];

        setTemplatesByConn((prev) => ({...prev, [connectionId]: nextTemplates}));
      }

      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleReadResource = async () => {
    const trimmed = resourceUri.trim();

    if (!trimmed) {
      toast.danger("Enter or select a resource URI");

      return;
    }
    try {
      const res = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "resources/read",
        params: {uri: trimmed},
      });

      setResourceResultByConn((prev) => ({...prev, [connectionId]: formatJson(res.result)}));
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleListPrompts = async () => {
    try {
      const res = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "prompts/list",
        params: {},
      });

      if (res.kind === "response" && isRecord(res.result) && Array.isArray(res.result.prompts)) {
        const nextPrompts = res.result.prompts as McpPromptDescriptor[];

        setPromptsByConn((prev) => ({
          ...prev,
          [connectionId]: nextPrompts,
        }));
      }
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleGetPrompt = async () => {
    if (!selectedPrompt) return;
    const parsed = parseJsonObjectOrToast(promptArgsText, "Prompt arguments");

    if (!parsed) return;
    const hasArgs = Object.keys(parsed).length > 0;

    try {
      const res = await mutate<InspectorRequestResponse>("/inspector/request", {
        connection_id: connectionId,
        method: "prompts/get",
        params: hasArgs ? {arguments: parsed, name: selectedPrompt.name} : {name: selectedPrompt.name},
      });

      setPromptResultByKey((prev) => ({...prev, [promptKey]: formatJson(res.result)}));
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleAnswerServerRequest = async (req: InspectorServerRequest) => {
    const draft = answerDrafts[req.request_id] ?? buildDefaultServerAnswer(req.method);
    const parsed = parseAnyJsonOrToast(draft, "Response JSON");

    if (!parsed.ok) return;
    try {
      await mutate("/inspector/answer", {
        request_id: req.request_id,
        result: parsed.value,
      });
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleRejectServerRequest = async (requestId: string) => {
    try {
      await mutate("/inspector/answer", {
        reject: "Rejected by user",
        request_id: requestId,
      });
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const handleSendRaw = async (mode: "request" | "notify") => {
    const trimmedMethod = rawMethod.trim();

    if (!trimmedMethod) {
      toast.danger("Enter a JSON-RPC method");

      return;
    }
    const parsed = parseJsonObjectOrToast(rawParamsText, "JSON params");

    if (!parsed) return;
    try {
      if (mode === "request") {
        const res = await mutate<InspectorRequestResponse>("/inspector/request", {
          connection_id: connectionId,
          method: trimmedMethod,
          params: parsed,
        });

        setRawResultByConn((prev) => ({...prev, [connectionId]: formatJson(res.result)}));
      } else {
        const res = await mutate("/inspector/notify", {
          connection_id: connectionId,
          method: trimmedMethod,
          params: parsed,
        });

        setRawResultByConn((prev) => ({...prev, [connectionId]: formatJson(res)}));
      }
      await onRefreshState();
    } catch {
      // Handled by mutate toast.
    }
  };

  const requestsTabLabel =
    pendingRequests.length > 0 ? `Requests (${pendingRequests.length})` : "Requests";

  return (
    <Tabs
      className="flex h-full min-h-0 flex-col gap-0"
      selectedKey={activeTab}
      variant="secondary"
      onSelectionChange={(key) => setActiveTab(String(key))}
    >
      <Tabs.ListContainer className="shrink-0 px-4 pt-1">
        <Tabs.List aria-label="MCP Inspector Explorer" className="w-max min-w-0 gap-3">
          <Tabs.Tab className="w-auto px-2 text-xs" id="tools">
            Tools
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab className="w-auto px-2 text-xs" id="resources">
            Resources
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab className="w-auto px-2 text-xs" id="prompts">
            Prompts
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab className="w-auto px-2 text-xs tabular-nums" id="requests">
            {requestsTabLabel}
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab className="w-auto px-2 text-xs" id="raw">
            Raw
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>

      {/* 1. TOOLS */}
      <Tabs.Panel
        className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        id="tools"
      >
        <div className="flex items-center gap-2">
          <Select
            className="min-w-0 flex-1"
            isDisabled={tools.length === 0 || busy}
            name="inspector-tool-select"
            placeholder={tools.length === 0 ? "No tools loaded" : "Select a tool"}
            value={selectedTool?.name ?? null}
            variant="secondary"
            onChange={(key) => {
              if (typeof key === "string") {
                setSelectedToolOverride(key);
              }
            }}
          >
            <Label className="sr-only">Tool</Label>
            <Select.Trigger className="normal-case">
              <Select.Value className="truncate font-mono text-xs normal-case" />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {tools.map((tool) => (
                  <ListBox.Item
                    key={tool.name}
                    className="normal-case"
                    id={tool.name}
                    textValue={tool.name}
                  >
                    <Label className="font-mono text-xs normal-case">{tool.name}</Label>
                    {tool.description ? (
                      <Description className="line-clamp-1 text-xs">{tool.description}</Description>
                    ) : null}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Button
            className="shrink-0"
            isDisabled={busy}
            size="sm"
            variant="secondary"
            onPress={() => {
              void handleRefreshTools();
            }}
          >
            Refresh
          </Button>
        </div>

        {selectedTool ? (
          <div className="flex flex-col gap-3">
            {toolSchemaFields.length > 0 ? (
              <Surface className="flex flex-col gap-2.5 rounded-lg p-3" variant="secondary">
                {toolSchemaFields.map((field) => {
                  if (field.fieldType === "boolean") {
                    return (
                      <Switch
                        key={field.name}
                        aria-label={field.name}
                        className="w-full"
                        isDisabled={busy}
                        isSelected={Boolean(parsedToolArgs[field.name])}
                        size="sm"
                        onChange={(checked) => updateToolSchemaField(field, checked)}
                      >
                        <Switch.Content className="w-full justify-between">
                          <Label className="font-mono text-xs normal-case">{field.name}</Label>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Content>
                        {field.description ? (
                          <Description className="truncate text-xs">{field.description}</Description>
                        ) : null}
                      </Switch>
                    );
                  }

                  const rawVal = parsedToolArgs[field.name];
                  const stringVal =
                    typeof rawVal === "string" || typeof rawVal === "number" ? String(rawVal) : "";

                  return (
                    <TextField
                      key={field.name}
                      fullWidth
                      isDisabled={busy}
                      name={`tool-arg-${field.name}`}
                      value={stringVal}
                      onChange={(val) => updateToolSchemaField(field, val)}
                    >
                      <Label className="font-mono text-xs">
                        {field.required ? `${field.name} *` : field.name}
                      </Label>
                      <Input
                        fullWidth
                        className={
                          field.fieldType === "number" || field.fieldType === "integer"
                            ? "font-mono text-xs tabular-nums"
                            : "font-mono text-xs"
                        }
                        inputMode={
                          field.fieldType === "number" || field.fieldType === "integer"
                            ? "decimal"
                            : undefined
                        }
                        placeholder={field.description ?? field.name}
                      />
                    </TextField>
                  );
                })}
              </Surface>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" htmlFor="inspector-tool-json-args">
                JSON Arguments
              </Label>
              <TextArea
                fullWidth
                className="font-mono text-xs tabular-nums"
                disabled={busy}
                id="inspector-tool-json-args"
                rows={4}
                value={toolArgsText}
                variant="secondary"
                onChange={(event) => setToolArgs(event.target.value)}
              />
            </div>

            <div className="flex items-center">
              <Button
                isDisabled={busy}
                size="sm"
                onPress={() => {
                  void handleRunTool();
                }}
              >
                Run Tool
              </Button>
            </div>

            {toolResult !== null ? (
              <CodeBlock className="my-0 rounded-lg">
                <CodeBlock.Header>
                  <span className="text-muted font-mono text-xs">Result</span>
                  <CodeBlock.CopyButton aria-label="Copy tool result" code={toolResult} />
                </CodeBlock.Header>
                <CodeBlock.Code
                  className="max-h-60 overflow-y-auto"
                  code={toolResult}
                  language="json"
                />
              </CodeBlock>
            ) : null}
          </div>
        ) : (
          <p className="text-muted text-xs">
            Click Refresh to query available tools from the connected MCP server.
          </p>
        )}
      </Tabs.Panel>

      {/* 2. RESOURCES */}
      <Tabs.Panel
        className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        id="resources"
      >
        <div className="flex items-center justify-end gap-2">
          <Button
            className="shrink-0"
            isDisabled={busy}
            size="sm"
            variant="secondary"
            onPress={() => {
              void handleListResources();
            }}
          >
            List Resources
          </Button>
        </div>

        {resources.length > 0 || resourceTemplates.length > 0 ? (
          <Surface className="rounded-lg p-1.5" variant="secondary">
            <ScrollShadow className="max-h-44 overflow-y-auto">
              <ListBox
                aria-label="Discovered resources"
                className="gap-0.5 p-0"
                selectedKeys={resourceUri ? new Set([resourceUri]) : new Set()}
                selectionMode="single"
                onSelectionChange={(keys) => {
                  if (keys !== "all") {
                    const first = Array.from(keys)[0];

                    if (typeof first === "string") {
                      setResourceUri(first);
                    }
                  }
                }}
              >
                {resources.map((item) => (
                  <ListBox.Item
                    key={`res:${item.uri}`}
                    className="normal-case data-[selected=true]:bg-accent-soft"
                    id={item.uri}
                    textValue={item.name}
                  >
                    <Label className="font-mono text-xs normal-case">{item.name}</Label>
                    <Description className="truncate font-mono text-xs tabular-nums">
                      {item.uri}
                    </Description>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
                {resourceTemplates.map((tpl) => (
                  <ListBox.Item
                    key={`tpl:${tpl.uriTemplate}`}
                    className="normal-case data-[selected=true]:bg-accent-soft"
                    id={tpl.uriTemplate}
                    textValue={tpl.name}
                  >
                    <Label className="font-mono text-xs normal-case">{tpl.name}</Label>
                    <Description className="truncate font-mono text-xs tabular-nums">
                      {tpl.uriTemplate}
                    </Description>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </ScrollShadow>
          </Surface>
        ) : null}

        <div className="flex items-end gap-2">
          <TextField
            fullWidth
            className="min-w-0 flex-1"
            isDisabled={busy}
            name="inspector-resource-uri"
            value={resourceUri}
            onChange={setResourceUri}
          >
            <Label className="text-xs">Resource URI</Label>
            <Input
              fullWidth
              className="font-mono text-xs tabular-nums"
              placeholder="file:///path/to/resource"
              variant="secondary"
            />
          </TextField>
          <Button
            className="shrink-0"
            isDisabled={busy || !resourceUri.trim()}
            size="sm"
            onPress={() => {
              void handleReadResource();
            }}
          >
            Read Resource
          </Button>
        </div>

        {resourceResult !== null ? (
          <CodeBlock className="my-0 rounded-lg">
            <CodeBlock.Header>
              <span className="text-muted font-mono text-xs">Resource Contents</span>
              <CodeBlock.CopyButton aria-label="Copy resource contents" code={resourceResult} />
            </CodeBlock.Header>
            <CodeBlock.Code
              className="max-h-64 overflow-y-auto"
              code={resourceResult}
              language="json"
            />
          </CodeBlock>
        ) : null}
      </Tabs.Panel>

      {/* 3. PROMPTS */}
      <Tabs.Panel
        className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        id="prompts"
      >
        <div className="flex items-center gap-2">
          <Select
            className="min-w-0 flex-1"
            isDisabled={prompts.length === 0 || busy}
            name="inspector-prompt-select"
            placeholder={prompts.length === 0 ? "No prompts loaded" : "Select a prompt"}
            value={selectedPrompt?.name ?? null}
            variant="secondary"
            onChange={(key) => {
              if (typeof key === "string") {
                setSelectedPromptOverride(key);
              }
            }}
          >
            <Label className="sr-only">Prompt</Label>
            <Select.Trigger className="normal-case">
              <Select.Value className="truncate font-mono text-xs normal-case" />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {prompts.map((prompt) => (
                  <ListBox.Item
                    key={prompt.name}
                    className="normal-case"
                    id={prompt.name}
                    textValue={prompt.name}
                  >
                    <Label className="font-mono text-xs normal-case">{prompt.name}</Label>
                    {prompt.description ? (
                      <Description className="line-clamp-1 text-xs">
                        {prompt.description}
                      </Description>
                    ) : null}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Button
            className="shrink-0"
            isDisabled={busy}
            size="sm"
            variant="secondary"
            onPress={() => {
              void handleListPrompts();
            }}
          >
            List Prompts
          </Button>
        </div>

        {selectedPrompt?.description ? (
          <p className="text-muted text-xs leading-relaxed">{selectedPrompt.description}</p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor="inspector-prompt-args">
            JSON Arguments
          </Label>
          <TextArea
            fullWidth
            className="font-mono text-xs tabular-nums"
            disabled={busy || !selectedPrompt}
            id="inspector-prompt-args"
            rows={4}
            value={promptArgsText}
            variant="secondary"
            onChange={(event) =>
              setPromptArgsByKey((prev) => ({...prev, [promptKey]: event.target.value}))
            }
          />
        </div>

        <div className="flex items-center">
          <Button
            isDisabled={busy || !selectedPrompt}
            size="sm"
            onPress={() => {
              void handleGetPrompt();
            }}
          >
            Get Prompt
          </Button>
        </div>

        {promptResult !== null ? (
          <CodeBlock className="my-0 rounded-lg">
            <CodeBlock.Header>
              <span className="text-muted font-mono text-xs">Prompt Result</span>
              <CodeBlock.CopyButton aria-label="Copy prompt result" code={promptResult} />
            </CodeBlock.Header>
            <CodeBlock.Code
              className="max-h-64 overflow-y-auto"
              code={promptResult}
              language="json"
            />
          </CodeBlock>
        ) : null}
      </Tabs.Panel>

      {/* 4. SERVER REQUESTS */}
      <Tabs.Panel
        className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        id="requests"
      >
        {serverRequests.length === 0 ? (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>No Server Requests</EmptyState.Title>
              <EmptyState.Description>
                Incoming sampling and elicitation requests from the MCP server will appear here for
                manual response.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          serverRequests.map((req) => {
            const paramsCode = formatJson(req.params ?? {});
            const draftValue =
              answerDrafts[req.request_id] ?? buildDefaultServerAnswer(req.method);
            const responseCode =
              req.status !== "Pending" && req.response !== undefined && req.response !== null
                ? formatJson(req.response)
                : null;

            return (
              <Card
                key={req.request_id}
                className="gap-2.5 p-3"
                variant="secondary"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground truncate font-mono text-xs font-medium">
                    {req.method}
                  </span>
                  <Chip
                    className="font-mono"
                    color={getRequestStatusColor(req.status)}
                    size="sm"
                    variant="soft"
                  >
                    {req.status}
                  </Chip>
                </div>

                <CodeBlock className="my-0 rounded-lg">
                  <CodeBlock.Header>
                    <span className="text-muted font-mono text-xs">Params</span>
                    <CodeBlock.CopyButton aria-label="Copy request params" code={paramsCode} />
                  </CodeBlock.Header>
                  <CodeBlock.Code
                    className="max-h-48 overflow-y-auto"
                    code={paramsCode}
                    language="json"
                  />
                </CodeBlock>

                {req.status === "Pending" ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs" htmlFor={`answer-${req.request_id}`}>
                        Response JSON
                      </Label>
                      <TextArea
                        fullWidth
                        className="font-mono text-xs tabular-nums"
                        disabled={busy}
                        id={`answer-${req.request_id}`}
                        rows={4}
                        value={draftValue}
                        variant="secondary"
                        onChange={(event) =>
                          setAnswerDrafts((prev) => ({
                            ...prev,
                            [req.request_id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        isDisabled={busy}
                        size="sm"
                        onPress={() => {
                          void handleAnswerServerRequest(req);
                        }}
                      >
                        Send Answer
                      </Button>
                      <Button
                        isDisabled={busy}
                        size="sm"
                        variant="danger-soft"
                        onPress={() => {
                          void handleRejectServerRequest(req.request_id);
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  </>
                ) : responseCode ? (
                  <CodeBlock className="my-0 rounded-lg">
                    <CodeBlock.Header>
                      <span className="text-muted font-mono text-xs">Recorded Answer</span>
                      <CodeBlock.CopyButton aria-label="Copy recorded answer" code={responseCode} />
                    </CodeBlock.Header>
                    <CodeBlock.Code
                      className="max-h-40 overflow-y-auto"
                      code={responseCode}
                      language="json"
                    />
                  </CodeBlock>
                ) : null}
              </Card>
            );
          })
        )}
      </Tabs.Panel>

      {/* 5. RAW JSON-RPC */}
      <Tabs.Panel
        className="mt-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        id="raw"
      >
        <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
          <Select
            className="w-48 min-w-48 shrink-0"
            isDisabled={busy}
            name="inspector-raw-preset"
            placeholder="Preset"
            value={rawPreset}
            variant="secondary"
            onChange={(key) => {
              if (typeof key === "string") {
                setRawPreset(key);
                setRawMethod(key);
                setRawParamsText("{}");
              }
            }}
          >
            <Label className="text-xs">Preset</Label>
            <Select.Trigger className="normal-case">
              <Select.Value className="truncate font-mono text-xs normal-case" />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {RAW_METHOD_PRESETS.map((preset) => (
                  <ListBox.Item
                    key={preset.id}
                    className="normal-case"
                    id={preset.id}
                    textValue={preset.label}
                  >
                    <Label className="font-mono text-xs normal-case">{preset.label}</Label>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <TextField
            fullWidth
            className="min-w-0 flex-1"
            isDisabled={busy}
            name="inspector-raw-method"
            value={rawMethod}
            onChange={setRawMethod}
          >
            <Label className="text-xs">Method</Label>
            <Input
              fullWidth
              className="font-mono text-xs"
              placeholder="tools/list"
              variant="secondary"
            />
          </TextField>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor="inspector-raw-params">
            JSON Params
          </Label>
          <TextArea
            fullWidth
            className="font-mono text-xs tabular-nums"
            disabled={busy}
            id="inspector-raw-params"
            rows={5}
            value={rawParamsText}
            variant="secondary"
            onChange={(event) => setRawParamsText(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            isDisabled={busy || !rawMethod.trim()}
            size="sm"
            onPress={() => {
              void handleSendRaw("request");
            }}
          >
            Send Request
          </Button>
          <Button
            isDisabled={busy || !rawMethod.trim()}
            size="sm"
            variant="secondary"
            onPress={() => {
              void handleSendRaw("notify");
            }}
          >
            Send Notification
          </Button>
        </div>

        {rawResult !== null ? (
          <CodeBlock className="my-0 rounded-lg">
            <CodeBlock.Header>
              <span className="text-muted font-mono text-xs">Response</span>
              <CodeBlock.CopyButton aria-label="Copy raw response" code={rawResult} />
            </CodeBlock.Header>
            <CodeBlock.Code
              className="max-h-64 overflow-y-auto"
              code={rawResult}
              language="json"
            />
          </CodeBlock>
        ) : null}
      </Tabs.Panel>
    </Tabs>
  );
}
