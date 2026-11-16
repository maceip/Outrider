"use client";

import type {
  ClefEvaluation,
  CommerceSnapshot,
  InspectorMessage,
  InspectorState,
  TrafficBody,
  TrafficDetail,
  TrafficHead,
  TrafficHeader,
} from "../lib/types";
import type {Selection} from "@heroui/react";
import type {DataGridColumn, DataGridSortDescriptor} from "@heroui-pro/react";

import {
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  ScrollShadow,
  SearchField,
  Table,
  Tabs,
  toast,
} from "@heroui/react";
import {DataGrid, DropZone, EmptyState, Segment, useDropZonePickerContext} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {Resizable} from "@heroui-pro/react/resizable";
import {useCallback, useMemo, useState} from "react";

import {withWwwBasePath} from "../lib/www-base-path";

export interface LiveSessionBundle {
  binaryVersion: string;
  capturedAtIso: string;
  commerceSnapshot: CommerceSnapshot;
  harSha256: string;
  inspectorState: InspectorState;
  trafficDetailsById: Record<string, TrafficDetail>;
  traffics: TrafficHead[];
}

export interface WwwDemoWorkbenchProps {
  bundle: LiveSessionBundle | null;
  loading?: boolean;
}

type WorkbenchTab = "traffic" | "mcp-clef";
type DetailTab = "request" | "response";
type ProtocolBadge = "HTTP" | "HTTPS" | "MCP" | "WS";
type ProtocolFilter = "all" | "HTTP" | "MCP";

interface CustomHarState {
  detailsById: Record<string, TrafficDetail>;
  fileName: string;
  rawText: string;
  traffics: TrafficHead[];
}

const SHIKI_HIGHLIGHT_CHAR_LIMIT = 64_000;
const BASE64_PREVIEW_LIMIT = 2_048;

function HarPickerTrigger() {
  const {openFilePicker} = useDropZonePickerContext();

  return (
    <Button size="sm" variant="secondary" onPress={openFilePicker}>
      Load .har
    </Button>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
    return "—";
  }
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  if (bytes < 1_024 * 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }

  return `${(bytes / (1_024 * 1_024)).toFixed(2)} MB`;
}

function getUriPathname(uri: string): string {
  if (uri.startsWith("/")) {
    return uri.split("?")[0]?.split("#")[0] ?? "";
  }
  try {
    return new URL(uri).pathname;
  } catch {
    return "";
  }
}

function getPacketProtocol(item: TrafficHead): ProtocolBadge {
  const pathname = getUriPathname(item.uri);

  if (pathname === "/mcp" || pathname === "/mcp/") {
    return "MCP";
  }
  if (item.websocket_id != null || /^wss?:/i.test(item.uri)) {
    return "WS";
  }
  if (item.uri.startsWith("https:")) {
    return "HTTPS";
  }

  return "HTTP";
}

function renderStatusChip(status: number | null) {
  if (status === null) {
    return (
      <Chip className="font-mono tabular-nums" color="default" size="sm" variant="soft">
        Pending
      </Chip>
    );
  }
  if (status >= 400) {
    return (
      <Chip className="font-mono tabular-nums" color="danger" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }
  if (status >= 300) {
    return (
      <Chip className="font-mono tabular-nums" color="warning" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }
  if (status >= 200) {
    return (
      <Chip className="font-mono tabular-nums" color="success" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }

  return (
    <Chip className="font-mono tabular-nums" color="accent" size="sm" variant="soft">
      {status}
    </Chip>
  );
}

function findHeaderValue(headers: TrafficHeader[] | undefined, targetName: string): string {
  if (!headers) return "";
  const lower = targetName.toLowerCase();
  const match = headers.find((item) => item.name.toLowerCase() === lower);

  return match?.value ?? "";
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function buildCurlCommand(head: TrafficHead, detail: TrafficDetail | null): string {
  const method = detail?.method ?? head.method;
  const uri = detail?.uri ?? head.uri;
  let cmd = `curl '${escapeSingleQuotes(uri)}'`;

  if (method.toUpperCase() !== "GET") {
    cmd += ` \\\n  -X ${method}`;
  }

  const headers = detail?.req_headers?.items ?? [];

  for (const header of headers) {
    const lower = header.name.toLowerCase();

    if (lower === "content-length" || lower === "host") {
      continue;
    }
    cmd += ` \\\n  -H '${escapeSingleQuotes(header.name)}: ${escapeSingleQuotes(header.value)}'`;
  }

  const reqBody = detail?.req_body;

  if (reqBody && reqBody.value.length > 0 && reqBody.encode !== "base64") {
    cmd += ` \\\n  --data-raw '${escapeSingleQuotes(reqBody.value)}'`;
  }

  return cmd;
}

function formatBodyForDisplay(body: TrafficBody, contentTypeHint = "") {
  if (body.encode === "base64") {
    const sliced = body.value.slice(0, BASE64_PREVIEW_LIMIT);
    const wrapped = sliced.match(/.{1,76}/g)?.join("\n") ?? sliced;
    const preview =
      body.value.length > BASE64_PREVIEW_LIMIT
        ? `${wrapped}\n… (${body.value.length - BASE64_PREVIEW_LIMIT} more base64 chars)`
        : wrapped;

    return {
      code: preview,
      copyText: body.value,
      label: `Base64 (${formatBytes(body.size)})`,
      language: "plaintext",
    };
  }

  const raw = body.value;
  const trimmed = raw.trim();
  const lowerMime = contentTypeHint.toLowerCase();

  if (trimmed.startsWith("{") || trimmed.startsWith("[") || lowerMime.includes("json")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);

      return {
        code: pretty,
        copyText: pretty,
        label: "JSON",
        language: pretty.length <= SHIKI_HIGHLIGHT_CHAR_LIMIT ? "json" : "plaintext",
      };
    } catch {
      // Fall through to plain text when NDJSON or SSE stream body.
    }
  }

  if (lowerMime.includes("html") && raw.length <= SHIKI_HIGHLIGHT_CHAR_LIMIT) {
    return {code: raw, copyText: raw, label: "HTML", language: "html"};
  }
  if (lowerMime.includes("xml") && raw.length <= SHIKI_HIGHLIGHT_CHAR_LIMIT) {
    return {code: raw, copyText: raw, label: "XML", language: "xml"};
  }

  return {
    code: raw,
    copyText: raw,
    label: "Plain text",
    language: "plaintext",
  };
}

function normalizeHarHeaders(rawHeaders: unknown): TrafficHeader[] {
  if (!Array.isArray(rawHeaders)) return [];
  const items: TrafficHeader[] = [];

  for (const item of rawHeaders) {
    if (isRecord(item) && typeof item.name === "string") {
      items.push({
        name: item.name,
        value: typeof item.value === "string" ? item.value : String(item.value ?? ""),
      });
    }
  }

  return items;
}

export function parseHar12Archive(rawText: string): {
  detailsById: Record<string, TrafficDetail>;
  traffics: TrafficHead[];
} {
  const parsed: unknown = JSON.parse(rawText);

  if (!isRecord(parsed) || !isRecord(parsed.log) || !Array.isArray(parsed.log.entries)) {
    throw new Error("Invalid HAR file: missing log.entries array");
  }

  const traffics: TrafficHead[] = [];
  const detailsById: Record<string, TrafficDetail> = {};

  parsed.log.entries.forEach((rawEntry, index) => {
    if (!isRecord(rawEntry)) return;
    const id = index + 1;
    const req = isRecord(rawEntry.request) ? rawEntry.request : {};
    const res = isRecord(rawEntry.response) ? rawEntry.response : {};

    const method = typeof req.method === "string" && req.method ? req.method : "GET";
    const uri = typeof req.url === "string" ? req.url : "";
    const rawStatus = typeof res.status === "number" ? res.status : null;
    const status = rawStatus !== null && rawStatus > 0 ? rawStatus : null;
    const rawTime = typeof rawEntry.time === "number" ? rawEntry.time : null;
    const time = rawTime !== null && rawTime >= 0 ? Math.round(rawTime) : null;

    const reqHeaders = normalizeHarHeaders(req.headers);
    const resHeaders = normalizeHarHeaders(res.headers);

    const postData = isRecord(req.postData) ? req.postData : null;
    const reqText = postData && typeof postData.text === "string" ? postData.text : "";
    const reqEncoding = postData && postData.encoding === "base64" ? "base64" : "utf8";
    const reqBody: TrafficBody | null =
      reqText.length > 0
        ? {
            encode: reqEncoding,
            size: new TextEncoder().encode(reqText).byteLength,
            value: reqText,
          }
        : null;

    const resContent = isRecord(res.content) ? res.content : null;
    const resText = resContent && typeof resContent.text === "string" ? resContent.text : "";
    const resEncoding = resContent && resContent.encoding === "base64" ? "base64" : "utf8";
    const explicitSize =
      resContent && typeof resContent.size === "number" && resContent.size >= 0
        ? resContent.size
        : typeof res.bodySize === "number" && res.bodySize >= 0
          ? res.bodySize
          : null;
    const computedResSize =
      explicitSize ?? (resText.length > 0 ? new TextEncoder().encode(resText).byteLength : null);
    const resBody: TrafficBody | null =
      resText.length > 0
        ? {
            encode: resEncoding,
            size: computedResSize ?? new TextEncoder().encode(resText).byteLength,
            value: resText,
          }
        : null;

    const mime =
      (resContent && typeof resContent.mimeType === "string" ? resContent.mimeType : "") ||
      findHeaderValue(resHeaders, "content-type");

    const startedIso = typeof rawEntry.startedDateTime === "string" ? rawEntry.startedDateTime : null;
    const parsedMs = startedIso ? Date.parse(startedIso) : Number.NaN;

    traffics.push({
      id,
      method,
      mime,
      size: computedResSize,
      start_time_unix_ms: Number.isFinite(parsedMs) ? parsedMs : undefined,
      status,
      time,
      uri,
    });

    detailsById[String(id)] = {
      end_time: null,
      error: null,
      gid: id,
      http_version:
        typeof res.httpVersion === "string"
          ? res.httpVersion
          : typeof req.httpVersion === "string"
            ? req.httpVersion
            : "HTTP/1.1",
      method,
      req_body: reqBody,
      req_body_file: null,
      req_headers: {items: reqHeaders, size: reqHeaders.length},
      res_body: resBody,
      res_body_file: null,
      res_body_size: computedResSize,
      res_headers: {items: resHeaders, size: resHeaders.length},
      start_time: startedIso,
      status,
      uri,
      websocket_id: null,
    };
  });

  return {detailsById, traffics};
}

function getKindColor(kind: string): "accent" | "danger" | "default" | "success" | "warning" {
  switch (kind) {
    case "error":
      return "danger";
    case "handshake":
      return "success";
    case "response":
      return "accent";
    case "stderr":
      return "warning";
    default:
      return "default";
  }
}

function formatClefQuestion(question: ClefEvaluation["question"]): string {
  if (isRecord(question) && typeof question.question === "string") {
    return question.question;
  }

  return "Session CLEF evaluation";
}

function HeadersTable({
  ariaLabel,
  headers,
}: {
  ariaLabel: string;
  headers: TrafficHeader[];
}) {
  if (headers.length === 0) {
    return <p className="text-muted text-xs">No headers recorded.</p>;
  }

  return (
    <Table
      className="border-border rounded-lg border [&_.table__column]:rounded-none! [&_.table__row:hover_.table__cell]:bg-transparent!"
      variant="secondary"
    >
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel} className="text-xs">
          <Table.Header>
            <Table.Column isRowHeader className="w-48 px-3 py-1.5">
              Name
            </Table.Column>
            <Table.Column className="px-3 py-1.5">Value</Table.Column>
          </Table.Header>
          <Table.Body>
            {headers.map((header, index) => (
              <Table.Row key={`${header.name}-${index}`} id={`${header.name}-${index}`}>
                <Table.Cell className="text-muted w-48 px-3 py-1.5 align-top font-mono text-xs font-medium break-all tabular-nums">
                  {header.name}
                </Table.Cell>
                <Table.Cell className="text-foreground px-3 py-1.5 align-top font-mono text-xs break-all tabular-nums">
                  {header.value}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export function WwwDemoWorkbench({bundle, loading = false}: WwwDemoWorkbenchProps) {
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("traffic");
  const [detailTab, setDetailTab] = useState<DetailTab>("response");
  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>("all");
  const [selectedPacketId, setSelectedPacketId] = useState<number | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [customHar, setCustomHar] = useState<CustomHarState | null>(null);
  const [sortDescriptor, setSortDescriptor] = useState<DataGridSortDescriptor>({
    column: "id",
    direction: "ascending",
  });

  const activeTraffics = useMemo<TrafficHead[]>(
    () => (customHar ? customHar.traffics : (bundle?.traffics ?? [])),
    [bundle, customHar],
  );

  const activeDetailsById = useMemo<Record<string, TrafficDetail>>(
    () => (customHar ? customHar.detailsById : (bundle?.trafficDetailsById ?? {})),
    [bundle, customHar],
  );

  const filteredTraffics = useMemo<TrafficHead[]>(() => {
    const query = search.trim().toLowerCase();

    return activeTraffics.filter((item) => {
      const protocol = getPacketProtocol(item);

      if (protocolFilter === "MCP" && protocol !== "MCP") {
        return false;
      }
      if (protocolFilter === "HTTP" && protocol !== "HTTP" && protocol !== "HTTPS") {
        return false;
      }

      if (!query) {
        return true;
      }

      const statusText = item.status === null ? "pending" : String(item.status);

      return (
        item.uri.toLowerCase().includes(query) ||
        item.method.toLowerCase().includes(query) ||
        statusText.includes(query) ||
        protocol.toLowerCase().includes(query) ||
        item.mime.toLowerCase().includes(query) ||
        String(item.id).includes(query) ||
        `#${item.id}`.includes(query)
      );
    });
  }, [activeTraffics, protocolFilter, search]);

  const sortedTraffics = useMemo<TrafficHead[]>(() => {
    if (!sortDescriptor.column) return filteredTraffics;
    const col = String(sortDescriptor.column);
    const dir = sortDescriptor.direction === "descending" ? -1 : 1;

    return [...filteredTraffics].sort((a, b) => {
      if (col === "id") return (a.id - b.id) * dir;
      if (col === "protocol") return getPacketProtocol(a).localeCompare(getPacketProtocol(b)) * dir;
      if (col === "method") return a.method.localeCompare(b.method) * dir;
      if (col === "uri") return a.uri.localeCompare(b.uri) * dir;
      if (col === "status") return ((a.status ?? -1) - (b.status ?? -1)) * dir;
      if (col === "time") return ((a.time ?? -1) - (b.time ?? -1)) * dir;
      if (col === "size") return ((a.size ?? -1) - (b.size ?? -1)) * dir;

      return 0;
    });
  }, [filteredTraffics, sortDescriptor]);

  const effectiveSelectedHead = useMemo<TrafficHead | null>(() => {
    if (sortedTraffics.length === 0) return null;
    if (selectedPacketId !== null) {
      const match = sortedTraffics.find((item) => item.id === selectedPacketId);

      if (match) return match;
    }

    return sortedTraffics[0];
  }, [selectedPacketId, sortedTraffics]);

  const effectiveSelectedDetail = useMemo<TrafficDetail | null>(() => {
    if (!effectiveSelectedHead) return null;

    return activeDetailsById[String(effectiveSelectedHead.id)] ?? null;
  }, [activeDetailsById, effectiveSelectedHead]);

  const selectedRowKeys = useMemo<Selection>(
    () =>
      effectiveSelectedHead ? new Set([String(effectiveSelectedHead.id)]) : new Set(),
    [effectiveSelectedHead],
  );

  const handleRowSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const first = Array.from(keys)[0];

    if (first === undefined) return;
    const parsed = typeof first === "number" ? first : Number(first);

    if (Number.isFinite(parsed)) {
      setSelectedPacketId(parsed);
    }
  }, []);

  const handleRowAction = useCallback((key: string | number) => {
    const parsed = typeof key === "number" ? key : Number(key);

    if (Number.isFinite(parsed)) {
      setSelectedPacketId(parsed);
    }
  }, []);

  const inspectorMessages = useMemo<InspectorMessage[]>(
    () => bundle?.inspectorState.messages ?? [],
    [bundle],
  );

  const clefEvaluations = useMemo<ClefEvaluation[]>(
    () => bundle?.commerceSnapshot.clef_evaluations ?? [],
    [bundle],
  );

  const activeMessage = useMemo<InspectorMessage | null>(() => {
    if (inspectorMessages.length === 0) return null;
    if (selectedMessageId !== null) {
      const found = inspectorMessages.find((msg) => msg.message_id === selectedMessageId);

      if (found) return found;
    }

    return inspectorMessages[inspectorMessages.length - 1];
  }, [inspectorMessages, selectedMessageId]);

  const selectedMessageKeys = useMemo<Selection>(
    () => (activeMessage ? new Set([String(activeMessage.message_id)]) : new Set()),
    [activeMessage],
  );

  const handleMessageSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const first = Array.from(keys)[0];

    if (first === undefined) return;
    const parsed = Number(first);

    if (Number.isFinite(parsed)) {
      setSelectedMessageId(parsed);
    }
  }, []);

  const formattedMessageJson = useMemo(() => {
    if (!activeMessage) return "";
    try {
      return JSON.stringify(activeMessage.body ?? null, null, 2);
    } catch {
      return String(activeMessage.body);
    }
  }, [activeMessage]);

  const handleCopyCurl = useCallback(async () => {
    if (!effectiveSelectedHead) return;
    try {
      const cmd = buildCurlCommand(effectiveSelectedHead, effectiveSelectedDetail);

      await navigator.clipboard.writeText(cmd);
      toast.success(`Copied cURL for #${effectiveSelectedHead.id}`);
    } catch {
      toast.danger("Clipboard write failed");
    }
  }, [effectiveSelectedDetail, effectiveSelectedHead]);

  const handleDownloadHar = useCallback(async () => {
    try {
      if (customHar) {
        const blob = new Blob([customHar.rawText], {type: "application/json; charset=utf-8"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = customHar.fileName || "capture.har";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded ${customHar.fileName}`);

        return;
      }

      const response = await fetch(withWwwBasePath("/demo/live-capture.har"), {cache: "no-store"});

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const harText = await response.text();
      const blob = new Blob([harText], {type: "application/json; charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "outrider-live-capture.har";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Downloaded recorded HAR capture");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to download HAR";

      toast.danger(msg);
    }
  }, [customHar]);

  const handleLoadHarFiles = useCallback(async (files: FileList) => {
    const file = files[0];

    if (!file) return;

    try {
      const rawText = await file.text();
      const parsed = parseHar12Archive(rawText);

      if (parsed.traffics.length === 0) {
        toast.danger("Selected HAR file contains zero entries");

        return;
      }

      setCustomHar({
        detailsById: parsed.detailsById,
        fileName: file.name,
        rawText,
        traffics: parsed.traffics,
      });
      setSelectedPacketId(parsed.traffics[0]?.id ?? null);
      setWorkbenchTab("traffic");
      toast.success(`Loaded ${parsed.traffics.length} packets from ${file.name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to parse HAR file";

      toast.danger(msg);
    }
  }, []);

  const handleResetCapture = useCallback(() => {
    setCustomHar(null);
    setSelectedPacketId(bundle?.traffics[0]?.id ?? null);
    toast.success("Restored recorded Outrider capture");
  }, [bundle]);

  const columns = useMemo<DataGridColumn<TrafficHead>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs font-medium tabular-nums">#{item.id}</span>
        ),
        header: "#",
        id: "id",
        isRowHeader: true,
        minWidth: 70,
        width: 78,
      },
      {
        allowsSorting: true,
        cell: (item) => {
          const protocol = getPacketProtocol(item);

          return (
            <Chip
              className="font-mono tabular-nums"
              color={protocol === "MCP" ? "accent" : "default"}
              size="sm"
              variant="soft"
            >
              {protocol}
            </Chip>
          );
        },
        header: "Protocol",
        id: "protocol",
        minWidth: 96,
        width: 108,
      },
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-foreground font-mono text-xs font-semibold tabular-nums">
            {item.method}
          </span>
        ),
        header: "Method",
        id: "method",
        minWidth: 88,
        width: 96,
      },
      {
        accessorKey: "uri",
        allowsSorting: true,
        cell: (item) => (
          <span
            className="text-foreground block max-w-[480px] truncate font-mono text-xs tabular-nums"
            title={item.uri}
          >
            {item.uri}
          </span>
        ),
        header: "URL",
        id: "uri",
        minWidth: 240,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (item) => renderStatusChip(item.status),
        header: "Status",
        id: "status",
        minWidth: 92,
        width: 104,
      },
      {
        accessorKey: "time",
        align: "end",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {item.time !== null ? `${item.time} ms` : "—"}
          </span>
        ),
        header: "Time",
        id: "time",
        minWidth: 88,
        width: 100,
      },
      {
        accessorKey: "size",
        align: "end",
        allowsSorting: true,
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatBytes(item.size)}
          </span>
        ),
        header: "Size",
        id: "size",
        minWidth: 88,
        width: 100,
      },
    ],
    [],
  );

  const reqHeaders = useMemo<TrafficHeader[]>(
    () => effectiveSelectedDetail?.req_headers?.items ?? [],
    [effectiveSelectedDetail],
  );
  const resHeaders = useMemo<TrafficHeader[]>(
    () => effectiveSelectedDetail?.res_headers?.items ?? [],
    [effectiveSelectedDetail],
  );
  const reqBodyFormatted = useMemo(() => {
    const body = effectiveSelectedDetail?.req_body;

    if (!body || (body.value.length === 0 && body.size === 0)) return null;

    return formatBodyForDisplay(body, findHeaderValue(reqHeaders, "content-type"));
  }, [effectiveSelectedDetail, reqHeaders]);

  const resBodyFormatted = useMemo(() => {
    const body = effectiveSelectedDetail?.res_body;

    if (!body || (body.value.length === 0 && body.size === 0)) return null;
    const hint =
      findHeaderValue(resHeaders, "content-type") || effectiveSelectedHead?.mime || "";

    return formatBodyForDisplay(body, hint);
  }, [effectiveSelectedDetail, effectiveSelectedHead, resHeaders]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-foreground text-base font-semibold">Live Session Workbench</h2>
          {customHar ? (
            <Chip color="accent" size="sm" variant="soft">
              Custom Capture
            </Chip>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DropZone className="w-auto">
            <DropZone.Input
              accept=".har,application/json"
              aria-label="Upload HAR file"
              onSelect={(files) => void handleLoadHarFiles(files)}
            />
            <HarPickerTrigger />
          </DropZone>
          {customHar ? (
            <Button size="sm" variant="tertiary" onPress={handleResetCapture}>
              Reset Capture
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void handleDownloadHar()}
          >
            Download .har
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <Tabs
          className="gap-0"
          selectedKey={workbenchTab}
          variant="secondary"
          onSelectionChange={(key) => setWorkbenchTab(String(key) as WorkbenchTab)}
        >
          <Tabs.ListContainer className="border-separator border-b px-4 pt-2">
            <Tabs.List aria-label="Workbench surfaces" className="w-max min-w-0 gap-4">
              <Tabs.Tab className="w-auto px-2 text-xs" id="traffic">
                Traffic Monitor
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab className="w-auto px-2 text-xs" id="mcp-clef">
                MCP &amp; CLEF
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel className="mt-0 flex flex-col p-0" id="traffic">
            <div className="border-separator flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <SearchField
                  aria-label="Filter captured packets"
                  className="w-full sm:w-72"
                  name="www-demo-traffic-search"
                  value={search}
                  variant="secondary"
                  onChange={setSearch}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      className="font-mono text-xs"
                      placeholder="Filter by path, method, or status..."
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>

                <Segment
                  aria-label="Filter packets by protocol"
                  className="shrink-0"
                  selectedKey={protocolFilter}
                  size="sm"
                  onSelectionChange={(key) => setProtocolFilter(String(key) as ProtocolFilter)}
                >
                  <Segment.Item id="all">All</Segment.Item>
                  <Segment.Item id="HTTP">HTTP</Segment.Item>
                  <Segment.Item id="MCP">MCP</Segment.Item>
                </Segment>
              </div>

              <span className="text-muted font-mono text-xs tabular-nums">
                {sortedTraffics.length} / {activeTraffics.length} packets
              </span>
            </div>

            <div className="h-[560px] min-h-0">
              <Resizable orientation="vertical">
                <Resizable.Panel className="flex flex-col" defaultSize={48} minSize={25}>
                  <DataGrid
                    stickyHeader
                    aria-label="Recorded packet stream"
                    className="h-full min-h-0 flex-1 [&_.data-grid__empty-state]:py-6 [&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)] [&_.table__row[data-selected=true]_.table__cell]:bg-accent-soft [&_.table__row[data-selected=true]_.table__cell]:text-foreground [&_.table__row[data-selected=true]:hover_.table__cell]:bg-accent-soft-hover"
                    columns={columns}
                    contentClassName="min-w-[780px]"
                    data={sortedTraffics}
                    getRowId={(item) => String(item.id)}
                    renderEmptyState={() => (
                      <EmptyState size="sm">
                        <EmptyState.Header>
                          <EmptyState.Title>
                            {loading ? "Loading Capture" : "No Matching Packets"}
                          </EmptyState.Title>
                          <EmptyState.Description>
                            {loading
                              ? "Loading recorded traffic..."
                              : "Adjust your search query or protocol filter."}
                          </EmptyState.Description>
                        </EmptyState.Header>
                      </EmptyState>
                    )}
                    scrollContainerClassName="h-full overflow-auto"
                    selectedKeys={selectedRowKeys}
                    selectionBehavior="replace"
                    selectionMode="single"
                    sortDescriptor={sortDescriptor}
                    variant="secondary"
                    onRowAction={handleRowAction}
                    onSelectionChange={handleRowSelectionChange}
                    onSortChange={setSortDescriptor}
                  />
                </Resizable.Panel>

                <Resizable.Handle
                  aria-label="Resize packet stream and payload inspector"
                  type="drag"
                  variant="secondary"
                />

                <Resizable.Panel className="flex flex-col" defaultSize={52} minSize={25}>
                  {effectiveSelectedHead ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="border-separator flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="text-foreground truncate font-mono text-xs font-semibold tabular-nums"
                            title={`${effectiveSelectedHead.method} ${effectiveSelectedHead.uri}`}
                          >
                            {effectiveSelectedHead.method} {effectiveSelectedHead.uri}
                          </span>
                          {renderStatusChip(effectiveSelectedHead.status)}
                        </div>
                        <Button
                          className="shrink-0"
                          size="sm"
                          variant="secondary"
                          onPress={() => void handleCopyCurl()}
                        >
                          Copy cURL
                        </Button>
                      </div>

                      <Tabs
                        className="min-h-0 flex-1 gap-0"
                        selectedKey={detailTab}
                        variant="secondary"
                        onSelectionChange={(key) => setDetailTab(String(key) as DetailTab)}
                      >
                        <Tabs.ListContainer className="shrink-0 px-4">
                          <Tabs.List aria-label="Packet detail sections" className="w-max min-w-0 gap-4">
                            <Tabs.Tab className="w-auto px-2 text-xs" id="request">
                              Request
                              <Tabs.Indicator />
                            </Tabs.Tab>
                            <Tabs.Tab className="w-auto px-2 text-xs" id="response">
                              Response
                              <Tabs.Indicator />
                            </Tabs.Tab>
                          </Tabs.List>
                        </Tabs.ListContainer>

                        <Tabs.Panel className="mt-0 min-h-0 flex-1 overflow-auto p-4" id="request">
                          <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-foreground text-xs font-medium">
                                  Request Headers
                                </span>
                                <Chip className="font-mono tabular-nums" size="sm" variant="soft">
                                  {reqHeaders.length}
                                </Chip>
                              </div>
                              <HeadersTable ariaLabel="Request headers" headers={reqHeaders} />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-foreground text-xs font-medium">
                                  Request Body
                                </span>
                                <span className="text-muted font-mono text-xs tabular-nums">
                                  {effectiveSelectedDetail?.req_body
                                    ? formatBytes(effectiveSelectedDetail.req_body.size)
                                    : "0 B"}
                                </span>
                              </div>
                              {reqBodyFormatted ? (
                                <CodeBlock className="my-0 rounded-lg">
                                  <CodeBlock.Header>
                                    <span className="text-muted font-mono text-xs">
                                      {reqBodyFormatted.label}
                                    </span>
                                    <CodeBlock.CopyButton code={reqBodyFormatted.copyText} />
                                  </CodeBlock.Header>
                                  <CodeBlock.Code
                                    code={reqBodyFormatted.code}
                                    language={reqBodyFormatted.language}
                                  />
                                </CodeBlock>
                              ) : (
                                <p className="text-muted text-xs">No request body sent.</p>
                              )}
                            </div>
                          </div>
                        </Tabs.Panel>

                        <Tabs.Panel className="mt-0 min-h-0 flex-1 overflow-auto p-4" id="response">
                          <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-foreground text-xs font-medium">
                                  Response Headers
                                </span>
                                <Chip className="font-mono tabular-nums" size="sm" variant="soft">
                                  {resHeaders.length}
                                </Chip>
                              </div>
                              <HeadersTable ariaLabel="Response headers" headers={resHeaders} />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-foreground text-xs font-medium">
                                  Response Body
                                </span>
                                <span className="text-muted font-mono text-xs tabular-nums">
                                  {effectiveSelectedDetail?.res_body
                                    ? formatBytes(effectiveSelectedDetail.res_body.size)
                                    : "0 B"}
                                </span>
                              </div>
                              {resBodyFormatted ? (
                                <CodeBlock className="my-0 rounded-lg">
                                  <CodeBlock.Header>
                                    <span className="text-muted font-mono text-xs">
                                      {resBodyFormatted.label}
                                    </span>
                                    <CodeBlock.CopyButton code={resBodyFormatted.copyText} />
                                  </CodeBlock.Header>
                                  <CodeBlock.Code
                                    code={resBodyFormatted.code}
                                    language={resBodyFormatted.language}
                                  />
                                </CodeBlock>
                              ) : (
                                <p className="text-muted text-xs">No response body recorded.</p>
                              )}
                            </div>
                          </div>
                        </Tabs.Panel>
                      </Tabs>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center p-4">
                      <EmptyState size="sm">
                        <EmptyState.Header>
                          <EmptyState.Title>Select a Packet</EmptyState.Title>
                          <EmptyState.Description>
                            Choose a row above to inspect headers and payload.
                          </EmptyState.Description>
                        </EmptyState.Header>
                      </EmptyState>
                    </div>
                  )}
                </Resizable.Panel>
              </Resizable>
            </div>
          </Tabs.Panel>

          <Tabs.Panel className="mt-0 p-0" id="mcp-clef">
            <div className="h-[560px] min-h-0">
              <Resizable orientation="horizontal">
                <Resizable.Panel className="flex flex-col" defaultSize={44} minSize={28}>
                  <ScrollShadow className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground text-xs font-semibold">
                          Recorded MCP Inspector Wire Frames
                        </span>
                        <Chip className="font-mono tabular-nums" size="sm" variant="soft">
                          {inspectorMessages.length}
                        </Chip>
                      </div>

                      {inspectorMessages.length === 0 ? (
                        <p className="text-muted text-xs">No recorded MCP messages.</p>
                      ) : (
                        <ListBox
                          disallowEmptySelection
                          aria-label="Recorded MCP messages"
                          className="gap-1 p-0"
                          selectedKeys={selectedMessageKeys}
                          selectionMode="single"
                          onSelectionChange={handleMessageSelectionChange}
                        >
                          {inspectorMessages.map((msg) => {
                            const arrow = msg.direction === "client_to_server" ? "->" : "<-";
                            const labelText = `${arrow} ${msg.method}`;

                            return (
                              <ListBox.Item
                                key={msg.message_id}
                                className="bg-surface-secondary/60 items-center justify-between gap-2 rounded-lg px-3 py-2 normal-case data-[selected=true]:bg-accent-soft"
                                id={String(msg.message_id)}
                                textValue={labelText}
                              >
                                <Label className="text-foreground min-w-0 flex-1 truncate font-mono text-xs font-medium tabular-nums normal-case">
                                  {labelText}
                                </Label>
                                <span className="flex shrink-0 items-center gap-2">
                                  {msg.latency_ms !== null ? (
                                    <span className="text-muted font-mono text-xs tabular-nums">
                                      {`${msg.latency_ms} ms`}
                                    </span>
                                  ) : null}
                                  <Chip color={getKindColor(msg.kind)} size="sm" variant="soft">
                                    {msg.kind}
                                  </Chip>
                                </span>
                              </ListBox.Item>
                            );
                          })}
                        </ListBox>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground text-xs font-semibold">
                          Recorded On-Device CLEF Evaluations
                        </span>
                        <Chip className="font-mono tabular-nums" size="sm" variant="soft">
                          {clefEvaluations.length}
                        </Chip>
                      </div>

                      {clefEvaluations.length === 0 ? (
                        <p className="text-muted text-xs">No CLEF evaluations recorded.</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {clefEvaluations.map((ev) => (
                            <Card
                              key={ev.evaluation_id}
                              className="gap-2 p-3"
                              variant="secondary"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-foreground font-mono text-xs font-semibold tabular-nums">
                                  pick: {JSON.stringify(ev.pick)}
                                </span>
                                <div className="flex shrink-0 items-center gap-2">
                                  <span className="text-muted font-mono text-xs tabular-nums">
                                    {ev.latency_ms !== null ? `${ev.latency_ms} ms` : "—"}
                                  </span>
                                  <Chip
                                    color={ev.status === "Verified" ? "success" : "default"}
                                    size="sm"
                                    variant="soft"
                                  >
                                    {ev.status}
                                  </Chip>
                                </div>
                              </div>
                              <p className="text-muted text-xs leading-relaxed">
                                {formatClefQuestion(ev.question)}
                              </p>
                            </Card>
                          ))}
                        </div>
                      )}
                    </div>
                  </ScrollShadow>
                </Resizable.Panel>

                <Resizable.Handle
                  aria-label="Resize MCP frames list and JSON-RPC wire payload"
                  type="drag"
                  variant="secondary"
                />

                <Resizable.Panel className="flex flex-col" defaultSize={56} minSize={30}>
                  {activeMessage ? (
                    <div className="flex h-full min-h-0 flex-col p-4">
                      <CodeBlock className="my-0 flex h-full min-h-0 flex-col rounded-lg">
                        <CodeBlock.Header className="shrink-0">
                          <span className="text-muted min-w-0 truncate font-mono text-xs tabular-nums">
                            {`${activeMessage.direction === "client_to_server" ? "->" : "<-"} ${activeMessage.method}`}
                          </span>
                          <CodeBlock.CopyButton
                            aria-label="Copy JSON-RPC wire payload"
                            code={formattedMessageJson}
                          />
                        </CodeBlock.Header>
                        <CodeBlock.Code
                          className="min-h-0 flex-1 overflow-auto"
                          code={formattedMessageJson}
                          language="json"
                        />
                      </CodeBlock>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center p-4">
                      <EmptyState size="sm">
                        <EmptyState.Header>
                          <EmptyState.Title>No Wire Frame Selected</EmptyState.Title>
                          <EmptyState.Description>
                            Select a recorded MCP message on the left to inspect its JSON-RPC
                            payload.
                          </EmptyState.Description>
                        </EmptyState.Header>
                      </EmptyState>
                    </div>
                  )}
                </Resizable.Panel>
              </Resizable>
            </div>
          </Tabs.Panel>
        </Tabs>
      </Card>
    </div>
  );
}
