"use client";

import type {InspectorMessage, InspectorServerRequest} from "../lib/types";
import type {AnswerDraftState, RootEntry} from "./inspector-schema-form";
import type {RefObject} from "react";

import {Button} from "@heroui/react";
import {NativeSelect} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {
  InspectorAnswerEditor,
  buildAnswerPayload,
  createInitialAnswerDraft,
} from "./inspector-schema-form";

type HistoryFilterKind = "all" | "rpc" | "notification" | "server" | "stderr" | "error";

interface ServerRequestCardProps {
  request: InspectorServerRequest;
  roots: RootEntry[];
  onAnswer: (requestId: string, result: unknown) => Promise<void>;
  onReject: (requestId: string, reason: string) => Promise<void>;
  onValidationError: (message: string) => void;
}

function ServerRequestCard({
  onAnswer,
  onReject,
  onValidationError,
  request,
  roots,
}: ServerRequestCardProps) {
  const [draft, setDraft] = useState<AnswerDraftState>(() =>
    createInitialAnswerDraft(request.params),
  );
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSendAnswer = async () => {
    setLocalError(null);
    try {
      const payload = buildAnswerPayload(request.method, request.params, draft, roots);

      setSubmitting(true);
      await onAnswer(request.request_id, payload);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to deliver answer";

      setLocalError(msg);
      onValidationError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    setLocalError(null);
    setSubmitting(true);
    try {
      await onReject(request.request_id, "Rejected by the operator");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to reject request";

      setLocalError(msg);
      onValidationError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const statusClass =
    request.status === "Pending"
      ? "text-warning shrink-0 font-mono text-xs font-medium"
      : request.status === "Answered"
        ? "text-success shrink-0 font-mono text-xs font-medium"
        : "text-danger shrink-0 font-mono text-xs font-medium";

  return (
    <div className="border-border bg-background flex flex-col gap-2.5 rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-foreground font-mono text-xs font-semibold">
          {request.method}
        </strong>
        <div className="flex items-center gap-2">
          <span className={statusClass}>{request.status}</span>
          <span className="text-muted font-mono text-xs tabular-nums">
            {new Date(request.created_at * 1000).toLocaleTimeString()}
          </span>
        </div>
      </div>

      {request.status === "Pending" ? (
        <>
          <InspectorAnswerEditor
            draft={draft}
            method={request.method}
            params={request.params}
            roots={roots}
            onChange={setDraft}
          />
          {localError ? (
            <div
              className="banner bad border-danger/40 bg-danger/10 text-danger rounded-lg border p-2 text-xs text-pretty"
              role="alert"
            >
              {localError}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              isDisabled={submitting}
              size="sm"
              onPress={() => void handleSendAnswer()}
            >
              Send answer
            </Button>
            <Button
              isDisabled={submitting}
              size="sm"
              variant="secondary"
              onPress={() => void handleReject()}
            >
              Reject
            </Button>
          </div>
        </>
      ) : (
        <details className="text-xs">
          <summary className="text-muted cursor-pointer font-mono text-xs">
            Request and answer
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <pre className="border-border bg-surface max-h-48 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
              {JSON.stringify(request.params, null, 2)}
            </pre>
            <pre className="border-border bg-surface max-h-48 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
              {JSON.stringify(request.response, null, 2)}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}

export interface InspectorActivityPaneProps {
  paneRef: RefObject<HTMLElement | null>;
  width: number;
  selectedConnectionId: string | null;
  connectionLive: boolean;
  serverRequests: InspectorServerRequest[];
  messages: InspectorMessage[];
  roots: RootEntry[];
  onAnswerRequest: (requestId: string, result: unknown) => Promise<void>;
  onRejectRequest: (requestId: string, reason: string) => Promise<void>;
  onReplayMessage: (method: string, params: unknown) => Promise<void>;
  onStatus: (message: string, isError?: boolean) => void;
}

export function InspectorActivityPane({
  connectionLive,
  messages,
  onAnswerRequest,
  onRejectRequest,
  onReplayMessage,
  onStatus,
  paneRef,
  roots,
  selectedConnectionId,
  serverRequests,
  width,
}: InspectorActivityPaneProps) {
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKind>("all");
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  const pendingCount = useMemo(
    () => serverRequests.filter((r) => r.status === "Pending").length,
    [serverRequests],
  );

  const filteredMessages = useMemo(() => {
    const matching = messages.filter((m) => {
      if (historyFilter === "all") return true;
      if (historyFilter === "rpc") {
        return m.direction === "client_to_server"
          ? m.kind === "request"
          : m.kind === "response" || m.kind === "error";
      }
      if (historyFilter === "notification") return m.kind === "notification";
      if (historyFilter === "server") {
        return (
          (m.direction === "server_to_client" && m.kind === "request") ||
          (m.direction === "client_to_server" && m.reply_to !== null && m.kind !== "request")
        );
      }
      if (historyFilter === "stderr") return m.kind === "stderr";

      return m.kind === "error";
    });

    return [...matching].reverse();
  }, [historyFilter, messages]);

  const toggleExpanded = (messageId: number) => {
    setExpandedIds((prev) => ({...prev, [messageId]: !prev[messageId]}));
  };

  return (
    <aside
      ref={paneRef}
      aria-label="Activity"
      className="border-border bg-surface flex shrink-0 flex-col overflow-y-auto border-t md:border-t-0"
      style={{width: `${width}px`}}
    >
      {/* Server Requests */}
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-foreground text-xs font-semibold text-balance">Server Requests</h2>
        <span
          className={
            pendingCount > 0
              ? "text-warning font-mono text-xs font-medium tabular-nums"
              : "text-muted font-mono text-xs tabular-nums"
          }
          id="pending-count"
        >
          {pendingCount > 0 ? `${pendingCount} waiting` : ""}
        </span>
      </div>

      <div className="border-border flex flex-col gap-2 border-b p-3" id="server-requests">
        {!selectedConnectionId ? (
          <p className="text-muted text-xs">No connection selected.</p>
        ) : serverRequests.length === 0 ? (
          <p className="text-muted text-xs text-pretty">
            No sampling or elicitation requests from this server.
          </p>
        ) : (
          serverRequests.map((req) => (
            <ServerRequestCard
              key={req.request_id}
              request={req}
              roots={roots}
              onAnswer={onAnswerRequest}
              onReject={onRejectRequest}
              onValidationError={(msg) => onStatus(msg, true)}
            />
          ))
        )}
      </div>

      {/* History */}
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-foreground text-xs font-semibold text-balance">History</h2>
        <div className="w-40">
          <NativeSelect fullWidth variant="secondary">
            <NativeSelect.Trigger
              aria-label="History filter"
              className="font-mono text-xs"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryFilterKind)}
            >
              <NativeSelect.Option value="all">All</NativeSelect.Option>
              <NativeSelect.Option value="rpc">Requests &amp; responses</NativeSelect.Option>
              <NativeSelect.Option value="notification">Notifications</NativeSelect.Option>
              <NativeSelect.Option value="server">Server → client</NativeSelect.Option>
              <NativeSelect.Option value="stderr">stderr</NativeSelect.Option>
              <NativeSelect.Option value="error">Errors</NativeSelect.Option>
            </NativeSelect.Trigger>
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-1 flex-col" id="history">
        {!selectedConnectionId ? (
          <div className="text-muted p-3 text-xs">Select a connection to inspect JSON-RPC frames.</div>
        ) : filteredMessages.length === 0 ? (
          <div className="text-muted p-3 text-xs">Nothing recorded for this filter.</div>
        ) : (
          filteredMessages.map((msg) => {
            const isExpanded = Boolean(expandedIds[msg.message_id]);
            const kindColor =
              msg.kind === "error"
                ? "text-danger"
                : msg.kind === "notification"
                  ? "text-warning"
                  : msg.kind === "stderr"
                    ? "text-muted"
                    : "text-success";

            const bodyObj =
              msg.body && typeof msg.body === "object"
                ? (msg.body as {line?: unknown; method?: unknown; params?: unknown})
                : null;
            const displayMethod =
              msg.kind === "stderr" && bodyObj?.line !== undefined
                ? String(bodyObj.line)
                : msg.method;
            const canReplay =
              msg.direction === "client_to_server" &&
              msg.kind === "request" &&
              typeof bodyObj?.method === "string";

            return (
              <div
                key={msg.message_id}
                className={
                  isExpanded
                    ? "msg selected border-accent bg-accent-soft/15 border p-2.5"
                    : "msg border-border hover:bg-default/20 border-b p-2.5"
                }
                style={{boxShadow: "none"}}
              >
                <button
                  aria-expanded={isExpanded}
                  className="flex w-full items-baseline justify-between gap-2 text-left"
                  type="button"
                  onClick={() => toggleExpanded(msg.message_id)}
                >
                  <span className={`${kindColor} shrink-0 font-mono text-xs`}>
                    {msg.direction === "client_to_server" ? "→ " : "← "}
                    {msg.kind}
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate font-mono text-xs">
                    {displayMethod}
                  </span>
                  <span className="text-muted shrink-0 font-mono text-xs tabular-nums">
                    {msg.latency_ms !== null ? `${msg.latency_ms} ms · ` : ""}#{msg.message_id}
                    {msg.reply_to ? ` ↳${msg.reply_to}` : ""}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <div className="text-muted font-mono text-xs tabular-nums">
                      {new Date(msg.created_at_ms).toLocaleString()}
                    </div>
                    <pre className="border-border bg-background max-h-72 overflow-auto rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap break-words">
                      {JSON.stringify(msg.body, null, 2)}
                    </pre>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          void (async () => {
                            try {
                              await navigator.clipboard.writeText(
                                JSON.stringify(msg.body, null, 2),
                              );
                              onStatus(`Copied message #${msg.message_id}`);
                            } catch (error) {
                              onStatus(
                                `Clipboard unavailable: ${error instanceof Error ? error.message : "error"}`,
                                true,
                              );
                            }
                          })();
                        }}
                      >
                        Copy JSON
                      </Button>

                      {canReplay ? (
                        <span
                          title={
                            connectionLive
                              ? "Re-send this JSON-RPC request"
                              : "Connection is not live"
                          }
                        >
                          <Button
                            isDisabled={!connectionLive}
                            size="sm"
                            onPress={() =>
                              void onReplayMessage(String(bodyObj!.method), bodyObj?.params)
                            }
                          >
                            Replay
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
