"use client";

import type {
  TrafficBody,
  TrafficDetail,
  TrafficHead,
  TrafficHeader,
  WebsocketFrameMessage,
} from "../lib/types";

import {Button, Chip, Tabs, toast} from "@heroui/react";
import {EmptyState} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {useEffect, useMemo, useState} from "react";

import {PROXYFOR_BASE, useCoreStore} from "../lib/core-store";

type DetailTab = "request" | "response" | "websocket";

const BASE64_PREVIEW_LIMIT = 2_048;
const SHIKI_HIGHLIGHT_CHAR_LIMIT = 64_000;

export function formatTrafficBytes(bytes: number | null | undefined): string {
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

export function renderTrafficStatusChip(status: number | null) {
  if (status === null) {
    return (
      <Chip color="default" size="sm" variant="soft">
        Pending
      </Chip>
    );
  }
  if (status >= 400) {
    return (
      <Chip color="danger" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }
  if (status >= 300) {
    return (
      <Chip color="warning" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }
  if (status >= 200) {
    return (
      <Chip color="success" size="sm" variant="soft">
        {status}
      </Chip>
    );
  }

  return (
    <Chip color="accent" size="sm" variant="soft">
      {status}
    </Chip>
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function findHeaderValue(headers: TrafficHeader[] | undefined, targetName: string): string {
  if (!headers) return "";
  const lower = targetName.toLowerCase();
  const match = headers.find((item) => item.name.toLowerCase() === lower);

  return match?.value ?? "";
}

function formatBase64Preview(rawBase64: string): string {
  const sliced = rawBase64.slice(0, BASE64_PREVIEW_LIMIT);
  const wrapped = sliced.match(/.{1,76}/g)?.join("\n") ?? sliced;

  if (rawBase64.length > BASE64_PREVIEW_LIMIT) {
    return `${wrapped}\n… (${rawBase64.length - BASE64_PREVIEW_LIMIT} more base64 chars)`;
  }

  return wrapped;
}

interface FormattedBodyPayload {
  code: string;
  copyText: string;
  label: string;
  language: string;
}

function formatBodyForDisplay(body: TrafficBody, contentTypeHint = ""): FormattedBodyPayload {
  if (body.encode === "base64") {
    return {
      code: formatBase64Preview(body.value),
      copyText: body.value,
      label: `Base64 (${formatTrafficBytes(body.size)})`,
      language: "plaintext",
    };
  }

  const raw = body.value;
  const trimmed = raw.trim();
  const lowerMime = contentTypeHint.toLowerCase();

  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    lowerMime.includes("json")
  ) {
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
      // Fall through to plain text if body is partial or NDJSON/SSE.
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

function formatFrameTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);

  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }

  return parsed.toLocaleTimeString("en-US", {
    fractionalSecondDigits: 3,
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
}

function HeadersSection({headers}: {headers: TrafficHeader[]}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground text-xs font-medium">Headers</span>
        <span className="text-muted text-xs tabular-nums">{headers.length}</span>
      </div>
      {headers.length === 0 ? (
        <p className="text-muted text-xs">No headers recorded.</p>
      ) : (
        <div className="border-separator overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {headers.map((header, index) => (
                <tr
                  key={`${header.name}-${index}`}
                  className="border-separator/60 border-b last:border-b-0"
                >
                  <td className="text-muted w-48 px-3 py-1.5 align-top font-mono font-medium break-all">
                    {header.name}
                  </td>
                  <td className="text-foreground px-3 py-1.5 align-top font-mono break-all">
                    {header.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BodySection({
  body,
  contentTypeHint,
  emptyDescription,
  emptyTitle,
}: {
  body: TrafficBody | null;
  contentTypeHint?: string;
  emptyDescription: string;
  emptyTitle: string;
}) {
  const formatted = useMemo(
    () => (body && (body.value.length > 0 || body.size > 0) ? formatBodyForDisplay(body, contentTypeHint) : null),
    [body, contentTypeHint],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground text-xs font-medium">Body</span>
        {body ? (
          <span className="text-muted text-xs tabular-nums">{formatTrafficBytes(body.size)}</span>
        ) : null}
      </div>
      {formatted ? (
        <CodeBlock className="my-0">
          <CodeBlock.Header>
            <span className="text-muted text-xs">{formatted.label}</span>
            <CodeBlock.CopyButton code={formatted.copyText} />
          </CodeBlock.Header>
          <CodeBlock.Code code={formatted.code} language={formatted.language} />
        </CodeBlock>
      ) : (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>{emptyTitle}</EmptyState.Title>
            <EmptyState.Description>{emptyDescription}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      )}
    </div>
  );
}

export interface TrafficDetailPaneProps {
  selectedHead: TrafficHead | null;
  selectedId: number | null;
}

export function TrafficDetailPane({selectedHead, selectedId}: TrafficDetailPaneProps) {
  const {copyTrafficCurl, downloadTrafficHar, fetchTrafficDetail} = useCoreStore();
  const [activeTab, setActiveTab] = useState<DetailTab>("request");
  const [detailState, setDetailState] = useState<{
    detail: TrafficDetail | null;
    id: number;
    loaded: boolean;
  } | null>(null);
  const [wsState, setWsState] = useState<{
    frames: WebsocketFrameMessage[];
    wsId: number | null;
  }>({frames: [], wsId: null});

  const headStatus = selectedHead?.status ?? null;
  const headSize = selectedHead?.size ?? null;
  const headTime = selectedHead?.time ?? null;
  const headWsId = selectedHead?.websocket_id ?? null;

  useEffect(() => {
    if (selectedId === null || selectedHead === null) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextDetail = await fetchTrafficDetail(selectedId);

        if (!cancelled) {
          setDetailState({detail: nextDetail, id: selectedId, loaded: true});
        }
      } catch {
        // Error toast is already surfaced by fetchTrafficDetail().
        if (!cancelled) {
          setDetailState((prev) =>
            prev?.id === selectedId ? {...prev, loaded: true} : {detail: null, id: selectedId, loaded: true},
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchTrafficDetail, headSize, headStatus, headTime, headWsId, selectedHead, selectedId]);

  const activeDetail =
    selectedId !== null && detailState?.id === selectedId ? detailState.detail : null;
  const isDetailLoading =
    selectedId !== null && (detailState === null || detailState.id !== selectedId || !detailState.loaded);

  const websocketId = activeDetail?.websocket_id ?? headWsId ?? null;

  useEffect(() => {
    if (websocketId === null) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`${PROXYFOR_BASE}/subscribe/websocket/${websocketId}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          if (!controller.signal.aborted && response.status !== 404) {
            toast.danger(`WebSocket stream unavailable (${response.status})`);
          }

          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let isFirstBatch = true;

        const appendLines = (lines: string[]) => {
          const parsedFrames: WebsocketFrameMessage[] = [];

          for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed) as WebsocketFrameMessage;

              if (msg && typeof msg === "object" && ("data" in msg || "error" in msg)) {
                parsedFrames.push(msg);
              }
            } catch {
              // Ignore malformed stream line fragments.
            }
          }

          if (parsedFrames.length > 0 || isFirstBatch) {
            const replaceExisting = isFirstBatch;

            isFirstBatch = false;
            setWsState((prev) => ({
              frames:
                !replaceExisting && prev.wsId === websocketId
                  ? [...prev.frames, ...parsedFrames]
                  : parsedFrames,
              wsId: websocketId,
            }));
          }
        };

        while (!controller.signal.aborted) {
          const {done, value} = await reader.read();

          if (done) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              appendLines(buffer.split("\n"));
            }
            break;
          }

          buffer += decoder.decode(value, {stream: true});
          const lines = buffer.split("\n");

          buffer = lines.pop() ?? "";
          if (lines.length > 0) {
            appendLines(lines);
          }
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        toast.danger("WebSocket frame stream interrupted");
      }
    })();

    return () => {
      controller.abort();
    };
  }, [websocketId]);

  if (selectedId === null || selectedHead === null) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Title>No Request Selected</EmptyState.Title>
            <EmptyState.Description>
              Select a request above to inspect headers and payload.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </div>
    );
  }

  const summaryMethod = activeDetail?.method ?? selectedHead.method;
  const summaryUri = activeDetail?.uri ?? selectedHead.uri;
  const summaryStatus = activeDetail?.status ?? selectedHead.status;

  const reqHeaders = activeDetail?.req_headers?.items ?? [];
  const resHeaders = activeDetail?.res_headers?.items ?? [];
  const reqContentType = findHeaderValue(reqHeaders, "content-type");
  const resContentType =
    findHeaderValue(resHeaders, "content-type") || selectedHead.mime || "";

  const wsFrames =
    websocketId !== null && wsState.wsId === websocketId ? wsState.frames : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-separator flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="text-foreground truncate text-sm font-medium"
            title={`${summaryMethod} ${summaryUri}`}
          >
            {summaryMethod} {summaryUri}
          </span>
          {renderTrafficStatusChip(summaryStatus)}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void copyTrafficCurl(selectedId)}
          >
            Copy cURL
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void downloadTrafficHar(selectedId)}
          >
            Download HAR
          </Button>
        </div>
      </div>

      <Tabs
        className="min-h-0 flex-1 gap-0"
        selectedKey={activeTab}
        variant="secondary"
        onSelectionChange={(key) => setActiveTab(String(key) as DetailTab)}
      >
        <Tabs.ListContainer className="shrink-0 px-4">
          <Tabs.List aria-label="Packet inspector sections" className="w-max min-w-0 gap-4">
            <Tabs.Tab className="w-auto px-2 text-xs" id="request">
              Request
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab className="w-auto px-2 text-xs" id="response">
              Response
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab className="w-auto px-2 text-xs" id="websocket">
              WebSocket
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel className="mt-0 min-h-0 flex-1 overflow-auto p-4" id="request">
          {isDetailLoading && !activeDetail ? (
            <p className="text-muted text-xs">Loading request details…</p>
          ) : (
            <div className="flex flex-col gap-4">
              <HeadersSection headers={reqHeaders} />
              <BodySection
                body={activeDetail?.req_body ?? null}
                contentTypeHint={reqContentType}
                emptyDescription="This request did not send a payload."
                emptyTitle="No Request Body"
              />
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel className="mt-0 min-h-0 flex-1 overflow-auto p-4" id="response">
          {isDetailLoading && !activeDetail ? (
            <p className="text-muted text-xs">Loading response details…</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground text-xs font-medium tabular-nums">
                  {activeDetail?.http_version || "HTTP"}{" "}
                  {summaryStatus !== null ? summaryStatus : "Pending"}
                </span>
                <div className="flex items-center gap-3">
                  {selectedHead.time !== null ? (
                    <span className="text-muted text-xs tabular-nums">
                      {selectedHead.time} ms
                    </span>
                  ) : null}
                  {activeDetail?.res_body_size !== null &&
                  activeDetail?.res_body_size !== undefined ? (
                    <span className="text-muted text-xs tabular-nums">
                      {formatTrafficBytes(activeDetail.res_body_size)}
                    </span>
                  ) : null}
                </div>
              </div>

              {activeDetail?.error ? (
                <div className="flex flex-col gap-2">
                  <span className="text-danger text-xs font-medium">Connection Error</span>
                  <CodeBlock className="my-0">
                    <CodeBlock.Header>
                      <span className="text-muted text-xs">Upstream error</span>
                      <CodeBlock.CopyButton code={activeDetail.error} />
                    </CodeBlock.Header>
                    <CodeBlock.Code code={activeDetail.error} language="plaintext" />
                  </CodeBlock>
                </div>
              ) : null}

              <HeadersSection headers={resHeaders} />

              <BodySection
                body={activeDetail?.res_body ?? null}
                contentTypeHint={resContentType}
                emptyDescription={
                  summaryStatus === null
                    ? "Waiting for upstream response payload."
                    : "This response did not include a body."
                }
                emptyTitle="No Response Body"
              />
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel className="mt-0 min-h-0 flex-1 overflow-auto p-4" id="websocket">
          {websocketId === null ? (
            <div className="flex h-full items-center justify-center py-4">
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>Not a WebSocket connection.</EmptyState.Title>
                  <EmptyState.Description>
                    Select an upgraded WebSocket request to stream frames in real time.
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            </div>
          ) : wsFrames.length === 0 ? (
            <div className="flex h-full items-center justify-center py-4">
              <EmptyState size="sm">
                <EmptyState.Header>
                  <EmptyState.Title>No Frames Yet</EmptyState.Title>
                  <EmptyState.Description>
                    Listening for live frames on WebSocket #{websocketId}.
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {wsFrames.map((frame, index) => {
                if ("error" in frame) {
                  return (
                    <div key={`err-${index}`} className="flex flex-col gap-1.5">
                      <span className="text-danger text-xs font-medium">Stream Error</span>
                      <CodeBlock className="my-0">
                        <CodeBlock.Header>
                          <span className="text-muted text-xs">Error</span>
                          <CodeBlock.CopyButton code={frame.error} />
                        </CodeBlock.Header>
                        <CodeBlock.Code code={frame.error} language="plaintext" />
                      </CodeBlock>
                    </div>
                  );
                }

                const formattedPayload = formatBodyForDisplay(frame.data.body);
                const directionLabel = frame.data.server_to_client
                  ? "Server -> Client"
                  : "Client -> Server";

                return (
                  <div key={`frame-${index}`} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-foreground text-xs font-medium">
                        {directionLabel}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted text-xs tabular-nums">
                          {formatFrameTimestamp(frame.data.create)}
                        </span>
                        <span className="text-muted text-xs tabular-nums">
                          {formatTrafficBytes(frame.data.body.size)}
                        </span>
                      </div>
                    </div>
                    <CodeBlock className="my-0">
                      <CodeBlock.Header>
                        <span className="text-muted text-xs">{formattedPayload.label}</span>
                        <CodeBlock.CopyButton code={formattedPayload.copyText} />
                      </CodeBlock.Header>
                      <CodeBlock.Code
                        code={formattedPayload.code}
                        language={formattedPayload.language}
                      />
                    </CodeBlock>
                  </div>
                );
              })}
            </div>
          )}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
