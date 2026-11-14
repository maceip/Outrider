"use client";

import type {AnswerDraftState, RootEntry} from "./inspector-schema-form";

import {Button} from "@heroui/react";
import Image from "next/image";
import {useState} from "react";

import {
  InspectorAnswerEditor,
  buildAnswerPayload,
  createInitialAnswerDraft,
} from "./inspector-schema-form";

export interface RpcEnvelopeResult {
  kind: "response" | "error" | (string & {});
  result: Record<string, unknown> | null;
  latency_ms?: number;
  request_message_id?: number;
  message_id?: number;
}

interface InputRequestEntry {
  method?: string;
  params?: Record<string, unknown>;
}

function formatMaybeJsonText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

interface ContentBlockViewProps {
  block: Record<string, unknown>;
  onReadResource?: (uri: string) => void;
}

function ContentBlockView({block, onReadResource}: ContentBlockViewProps) {
  const blockType = typeof block.type === "string" ? block.type : "content";
  const mimeType = typeof block.mimeType === "string" ? block.mimeType : null;

  return (
    <div className="border-border bg-background flex flex-col gap-1.5 rounded-lg border p-2.5">
      <div className="text-muted font-mono text-xs">
        {blockType.toUpperCase()}
        {mimeType ? ` · ${mimeType}` : ""}
      </div>

      {blockType === "text" && typeof block.text === "string" ? (
        <pre className="border-border bg-surface max-h-96 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
          {formatMaybeJsonText(block.text)}
        </pre>
      ) : blockType === "image" && typeof block.data === "string" ? (
        <Image
          unoptimized
          alt="Image content returned by the server"
          className="border-border h-auto max-w-full rounded border"
          height={320}
          src={`data:${mimeType ?? "image/png"};base64,${block.data}`}
          width={480}
        />
      ) : blockType === "audio" && typeof block.data === "string" ? (
        <audio controls src={`data:${mimeType ?? "audio/wav"};base64,${block.data}`} />
      ) : blockType === "resource" ? (
        (() => {
          const resource = (block.resource ?? {}) as {
            uri?: string;
            text?: string;
            blob?: string;
          };

          return (
            <div className="flex flex-col gap-1">
              {resource.uri ? (
                <span className="text-muted font-mono text-xs break-all">{resource.uri}</span>
              ) : null}
              <pre className="border-border bg-surface max-h-96 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
                {resource.text !== undefined
                  ? formatMaybeJsonText(resource.text)
                  : `blob, ${(resource.blob ?? "").length} base64 chars`}
              </pre>
            </div>
          );
        })()
      ) : blockType === "resource_link" && typeof block.uri === "string" ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs break-all">{block.uri}</span>
            {onReadResource ? (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => onReadResource(String(block.uri))}
              >
                Read
              </Button>
            ) : null}
          </div>
          {typeof block.description === "string" ? (
            <span className="text-muted text-xs">{block.description}</span>
          ) : null}
        </div>
      ) : (
        <pre className="border-border bg-surface max-h-96 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
          {JSON.stringify(block, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface MrtrResumeCardProps {
  result: Record<string, unknown>;
  roots: RootEntry[];
  onResume: (extraParams: Record<string, unknown>) => Promise<void>;
  onValidationError?: (message: string) => void;
}

function MrtrResumeCard({onResume, onValidationError, result, roots}: MrtrResumeCardProps) {
  const inputRequests = (result.inputRequests ?? {}) as Record<string, InputRequestEntry>;
  const entries = Object.entries(inputRequests);

  const [drafts, setDrafts] = useState<Record<string, AnswerDraftState>>(() => {
    const initial: Record<string, AnswerDraftState> = {};

    for (const [key, req] of Object.entries(inputRequests)) {
      initial[key] = createInitialAnswerDraft(req?.params ?? null);
    }

    return initial;
  });
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const handleResume = async () => {
    setErrorText(null);
    try {
      const inputResponses: Record<string, unknown> = {};

      for (const [key, req] of entries) {
        const method = req?.method ?? "unknown";
        const draft = drafts[key] ?? createInitialAnswerDraft(req?.params ?? null);

        inputResponses[key] = buildAnswerPayload(method, req?.params ?? null, draft, roots);
      }

      setResuming(true);
      await onResume({
        ...(Object.keys(inputResponses).length > 0 ? {inputResponses} : {}),
        ...(result.requestState !== undefined ? {requestState: result.requestState} : {}),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to resume request";

      setErrorText(msg);
      onValidationError?.(msg);
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="border-border bg-background flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-foreground font-mono text-xs font-semibold text-balance">
          INPUT REQUIRED · MULTI ROUND-TRIP
        </h3>
        <p className="text-muted text-xs text-pretty">
          The server requires additional client inputs before completing this request. Answer each
          item below and resume; the opaque requestState is echoed back unchanged.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted text-xs">
          No input requests attached; resuming echoes requestState.
        </p>
      ) : (
        entries.map(([key, req]) => {
          const method = req?.method ?? "unknown";
          const draft = drafts[key] ?? createInitialAnswerDraft(req?.params ?? null);

          return (
            <div
              key={key}
              className="border-border bg-surface flex flex-col gap-2.5 rounded-lg border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground font-mono text-xs font-medium">{key}</span>
                <span className="text-muted font-mono text-xs">{method}</span>
              </div>
              <InspectorAnswerEditor
                draft={draft}
                method={method}
                params={req?.params ?? null}
                roots={roots}
                onChange={(nextDraft) => setDrafts((prev) => ({...prev, [key]: nextDraft}))}
              />
            </div>
          );
        })
      )}

      {errorText ? (
        <div
          className="banner bad border-danger/40 bg-danger/10 text-danger rounded-lg border p-2 text-xs"
          role="alert"
        >
          {errorText}
        </div>
      ) : null}

      <div>
        <Button isDisabled={resuming} size="sm" onPress={() => void handleResume()}>
          Resume
        </Button>
      </div>
    </div>
  );
}

export interface InspectorResultViewProps {
  envelope: RpcEnvelopeResult | null;
  roots: RootEntry[];
  onResume?: (extraParams: Record<string, unknown>) => Promise<void>;
  onReadResource?: (uri: string) => void;
  onValidationError?: (message: string) => void;
}

export function InspectorResultView({
  envelope,
  onReadResource,
  onResume,
  onValidationError,
  roots,
}: InspectorResultViewProps) {
  if (!envelope) return null;

  const metaParts = [
    envelope.kind,
    envelope.latency_ms !== undefined ? `${envelope.latency_ms} ms` : null,
    envelope.message_id !== undefined ? `history #${envelope.message_id}` : null,
  ].filter(Boolean);

  if (envelope.kind === "error") {
    const errObj = envelope.result ?? {};
    const code = errObj.code !== undefined ? ` ${String(errObj.code)}` : "";
    const message =
      typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);

    return (
      <div className="flex flex-col gap-2">
        <div className="text-muted font-mono text-xs tabular-nums">{metaParts.join(" · ")}</div>
        <div
          className="banner bad border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 font-mono text-xs text-pretty"
          role="alert"
        >
          Error{code}: {message}
        </div>
        {errObj.data !== undefined ? (
          <pre className="border-border bg-background max-h-80 overflow-auto rounded-lg border p-2.5 font-mono text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(errObj.data, null, 2)}
          </pre>
        ) : null}
      </div>
    );
  }

  const res = envelope.result ?? {};
  const isInputRequired =
    res.resultType === "input_required" || res.status === "input_required";

  if (isInputRequired && onResume) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-muted font-mono text-xs tabular-nums">{metaParts.join(" · ")}</div>
        <MrtrResumeCard
          key={String(envelope.message_id ?? "mrtr")}
          result={res}
          roots={roots}
          onResume={onResume}
          onValidationError={onValidationError}
        />
      </div>
    );
  }

  const contentBlocks = Array.isArray(res.content)
    ? (res.content as Array<Record<string, unknown>>)
    : [];
  const contentsList = Array.isArray(res.contents)
    ? (res.contents as Array<Record<string, unknown>>)
    : Array.isArray(res.files)
      ? (res.files as Array<Record<string, unknown>>)
      : [];
  const promptMessages = Array.isArray(res.messages)
    ? (res.messages as Array<{role?: string; content?: unknown}>)
    : [];
  const hasStructured = res.structuredContent !== undefined;
  const hasRenderedBlocks =
    contentBlocks.length > 0 ||
    contentsList.length > 0 ||
    promptMessages.length > 0 ||
    hasStructured;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-muted font-mono text-xs tabular-nums">{metaParts.join(" · ")}</div>

      {res.isError === true ? (
        <div
          className="banner bad border-danger/40 bg-danger/10 text-danger rounded-lg border p-2.5 text-xs"
          role="alert"
        >
          The tool reported an error (isError: true).
        </div>
      ) : null}

      {contentBlocks.map((block, idx) => (
        <ContentBlockView key={`content-${idx}`} block={block} onReadResource={onReadResource} />
      ))}

      {contentsList.map((item, idx) => {
        const normalized =
          item.text !== undefined || item.blob !== undefined
            ? {
                mimeType: item.mimeType,
                resource: item,
                type: "resource",
              }
            : item;

        return (
          <ContentBlockView
            key={`contents-${idx}`}
            block={normalized}
            onReadResource={onReadResource}
          />
        );
      })}

      {promptMessages.map((msg, idx) => {
        const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];

        return (
          <div
            key={`msg-${idx}`}
            className="border-border bg-background flex flex-col gap-2 rounded-lg border p-2.5"
          >
            <div className="text-muted font-mono text-xs">
              MESSAGE · {String(msg.role ?? "assistant")}
            </div>
            {blocks.map((b, bIdx) => (
              <ContentBlockView
                key={`msg-${idx}-${bIdx}`}
                block={
                  b && typeof b === "object"
                    ? (b as Record<string, unknown>)
                    : {text: String(b ?? ""), type: "text"}
                }
                onReadResource={onReadResource}
              />
            ))}
          </div>
        );
      })}

      {hasStructured ? (
        <div className="border-border bg-background flex flex-col gap-1.5 rounded-lg border p-2.5">
          <div className="text-muted font-mono text-xs">STRUCTURED CONTENT</div>
          <pre className="border-border bg-surface max-h-96 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(res.structuredContent, null, 2)}
          </pre>
        </div>
      ) : null}

      {Boolean(res.task || res.taskId) ? (
        <div className="banner border-border bg-background text-foreground rounded-lg border p-2.5 text-xs">
          The server created a task. Poll or update it from RAW JSON-RPC with tasks/get or
          tasks/update.
        </div>
      ) : null}

      <details
        open={!hasRenderedBlocks}
        className="border-border bg-background rounded-lg border p-2 text-xs"
      >
        <summary className="text-muted cursor-pointer font-mono text-xs">Raw result</summary>
        <pre className="mt-2 max-h-96 overflow-auto font-mono text-xs whitespace-pre-wrap break-words">
          {JSON.stringify(res, null, 2)}
        </pre>
      </details>
    </div>
  );
}
