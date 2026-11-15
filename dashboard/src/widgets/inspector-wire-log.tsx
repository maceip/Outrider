"use client";

import type {InspectorMessage} from "../lib/types";

import {Terminal} from "@gravity-ui/icons";
import {Chip} from "@heroui/react";
import {EmptyState} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {Resizable} from "@heroui-pro/react/resizable";
import {useEffect, useMemo, useRef, useState} from "react";

export interface InspectorWireLogProps {
  messages: InspectorMessage[];
}

type ChipColor = "accent" | "danger" | "default" | "success" | "warning";

function getKindColor(kind: string): ChipColor {
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

function formatMessageArrow(direction: string): string {
  return direction === "client_to_server" ? "->" : "<-";
}

function formatJsonPayload(body: unknown): string {
  try {
    return JSON.stringify(body ?? null, null, 2);
  } catch {
    return String(body);
  }
}

export function InspectorWireLog({messages}: InspectorWireLogProps) {
  const newestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const newestId = newestMessage?.message_id ?? null;

  const [pinnedSelection, setPinnedSelection] = useState<{
    atLatestId: number;
    selectedId: number;
  } | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (newestId !== null && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [newestId]);

  const activeMessage = useMemo(() => {
    if (!newestMessage) return null;
    if (pinnedSelection && pinnedSelection.atLatestId === newestMessage.message_id) {
      return (
        messages.find((item) => item.message_id === pinnedSelection.selectedId) ?? newestMessage
      );
    }

    return newestMessage;
  }, [messages, newestMessage, pinnedSelection]);

  const formattedBody = useMemo(
    () => (activeMessage ? formatJsonPayload(activeMessage.body) : ""),
    [activeMessage],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-separator flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-foreground text-sm font-medium">Wire Log</span>
        <Chip className="tabular-nums" size="sm" variant="soft">
          {messages.length}
        </Chip>
      </div>

      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <Terminal />
              </EmptyState.Media>
              <EmptyState.Title>No Wire Messages</EmptyState.Title>
              <EmptyState.Description>
                Connect to an MCP server above to inspect live JSON-RPC requests, responses, and
                notifications.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Resizable orientation="vertical">
            <Resizable.Panel defaultSize={42} minSize={20}>
              <div ref={listRef} className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
                {messages.map((msg) => {
                  const isSelected = activeMessage?.message_id === msg.message_id;
                  const arrow = formatMessageArrow(msg.direction);

                  return (
                    <button
                      key={msg.message_id}
                      className={`flex w-full cursor-[var(--cursor-interactive)] items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-left ${
                        isSelected ? "bg-surface-secondary" : "hover:bg-surface-secondary/50"
                      }`}
                      type="button"
                      onClick={() => {
                        if (newestId !== null && msg.message_id !== newestId) {
                          setPinnedSelection({
                            atLatestId: newestId,
                            selectedId: msg.message_id,
                          });
                        } else {
                          setPinnedSelection(null);
                        }
                      }}
                    >
                      <span className="text-foreground min-w-0 truncate font-mono text-xs font-medium">
                        {`${arrow} ${msg.method}`}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {msg.latency_ms !== null ? (
                          <span className="text-muted text-xs tabular-nums">
                            {`${msg.latency_ms} ms`}
                          </span>
                        ) : null}
                        <Chip color={getKindColor(msg.kind)} size="sm" variant="soft">
                          {msg.kind}
                        </Chip>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Resizable.Panel>

            <Resizable.Handle type="line" variant="secondary" />

            <Resizable.Panel defaultSize={58} minSize={25}>
              {activeMessage ? (
                <div className="flex h-full min-h-0 flex-col p-2">
                  <CodeBlock className="my-0 flex h-full min-h-0 flex-col">
                    <CodeBlock.Header className="shrink-0 pb-1">
                      <span className="text-muted min-w-0 truncate font-mono text-xs">
                        {`${formatMessageArrow(activeMessage.direction)} ${activeMessage.method}`}
                      </span>
                      <CodeBlock.CopyButton
                        aria-label="Copy JSON-RPC payload"
                        code={formattedBody}
                      />
                    </CodeBlock.Header>
                    <CodeBlock.Code
                      className="min-h-0 flex-1 overflow-y-auto"
                      code={formattedBody}
                      language="json"
                    />
                  </CodeBlock>
                </div>
              ) : null}
            </Resizable.Panel>
          </Resizable>
        </div>
      )}
    </div>
  );
}
