"use client";

import type {
  CapabilityReceiptRow,
  FingerprintObservation,
  McpFrame,
  ProxyTrafficRow,
} from "../lib/types";
import type {DataGridColumn} from "@heroui-pro/react";
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent} from "react";

import {Button, SearchField} from "@heroui/react";
import {DataGrid} from "@heroui-pro/react";
import {useCallback, useMemo, useRef, useState} from "react";

import {useOutrider} from "../lib/outrider-store";

import {RowActions} from "./employees-table-row-actions";

const DEFAULT_SESSIONS_WIDTH = 280;
const MIN_SESSIONS_WIDTH = 200;
const MAX_SESSIONS_WIDTH = 520;

type EvidenceCanvasTab = "traffic" | "mcp" | "receipts" | "handshake";

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString();
}

export function EmployeesTable() {
  const {
    busy,
    clefStatus,
    mutate,
    openDialog,
    probePolicy,
    selectedEvidence,
    selectedReceipt,
    selectedReceiptId,
    selectedSession,
    selectedSessionId,
    setSelectedEvidence,
    setSelectedReceiptId,
    setSelectedSessionId,
    snapshot,
    unlocked,
  } = useOutrider();

  const [sessionSearch, setSessionSearch] = useState("");
  const [canvasTab, setCanvasTab] = useState<EvidenceCanvasTab>("traffic");
  const [sessionsWidth, setSessionsWidth] = useState(DEFAULT_SESSIONS_WIDTH);
  const paneRef = useRef<HTMLElement | null>(null);

  const sessions = useMemo(() => {
    const all = snapshot?.agent_sessions ?? [];

    if (!sessionSearch.trim()) return all;
    const q = sessionSearch.toLowerCase();

    return all.filter((session) => {
      const clientName = session.client_config?.clientInfo?.name ?? "";

      return (
        clientName.toLowerCase().includes(q) ||
        session.session_id.toLowerCase().includes(q) ||
        session.subject.toLowerCase().includes(q) ||
        session.transport.toLowerCase().includes(q)
      );
    });
  }, [sessionSearch, snapshot?.agent_sessions]);

  const reasons = useMemo(() => {
    const baseReason = !unlocked
      ? "Admin token required"
      : busy
        ? "Backend action in progress"
        : "";

    const next = {
      evaluate: baseReason,
      issue: baseReason,
      probe: baseReason,
      revoke: baseReason,
      synthesize: baseReason,
    };

    if (unlocked && !busy) {
      if (!selectedSession) {
        next.probe = "Select an agent session";
        next.evaluate = "Select an agent session";
        next.synthesize = "Select an agent session";
        next.issue = "Select an agent session";
      } else {
        const peer = snapshot?.active_peers.find(
          (p) => p.session_id === selectedSession.session_id && p.connected,
        );

        if (probePolicy === "off") {
          next.probe = "Probes disabled by operator";
        } else if (selectedSession.client_config?.protocolVersion === "2026-07-28") {
          next.probe =
            "MCP 2026: the agent must invoke outrider_run_probe to carry the input-required round trip";
        } else if (!peer?.sampling) {
          next.probe =
            "MCP 2026 sampling required: no connected sampling-capable client on this session";
        }
      }

      if (clefStatus?.status !== "Ready") {
        next.evaluate =
          clefStatus?.status === "ModelError"
            ? `CLEF ModelError: ${clefStatus.error}`
            : "CLEF Unconfigured: no model loaded";
      }

      if ((snapshot?.bundles.length ?? 0) === 0) {
        next.synthesize = "Configure at least one bundle";
        next.issue = "Configure at least one bundle";
      }

      if (!selectedReceipt) {
        next.revoke = "Select a capability receipt";
      } else if (selectedReceipt.revoked) {
        next.revoke = "Receipt already revoked";
      }
    }

    return next;
  }, [busy, clefStatus, probePolicy, selectedReceipt, selectedSession, snapshot, unlocked]);

  const activeReasonEntries = useMemo(
    () => Object.entries(reasons).filter(([, text]) => Boolean(text)),
    [reasons],
  );

  const sessionOffers = useMemo(
    () =>
      (snapshot?.session_offers ?? []).filter(
        (offer) => offer.session_id === selectedSessionId,
      ),
    [selectedSessionId, snapshot?.session_offers],
  );

  const latestEvaluation = useMemo(
    () =>
      (snapshot?.clef_evaluations ?? []).find(
        (evaluation) => evaluation.session_id === selectedSessionId,
      ) ?? null,
    [selectedSessionId, snapshot?.clef_evaluations],
  );

  const sessionObservations = useMemo(
    () =>
      (snapshot?.fingerprint_observations ?? []).filter(
        (obs) => obs.session_id === selectedSessionId,
      ),
    [selectedSessionId, snapshot?.fingerprint_observations],
  );

  const trafficRows = useMemo(() => snapshot?.proxy_traffic ?? [], [snapshot?.proxy_traffic]);

  const mcpRows = useMemo(
    () =>
      (snapshot?.mcp_frames ?? []).filter(
        (frame) =>
          !selectedSessionId ||
          frame.session_id === selectedSessionId ||
          Boolean(frame.upstream_name),
      ),
    [selectedSessionId, snapshot?.mcp_frames],
  );

  const receiptRows = useMemo(
    () => snapshot?.capability_receipts ?? [],
    [snapshot?.capability_receipts],
  );

  const handleResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = paneRef.current?.getBoundingClientRect().width ?? DEFAULT_SESSIONS_WIDTH;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const clamped = Math.max(
        MIN_SESSIONS_WIDTH,
        Math.min(MAX_SESSIONS_WIDTH, Math.round(startWidth + delta)),
      );

      setSessionsWidth(clamped);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSessionsWidth((w) => Math.min(MAX_SESSIONS_WIDTH, w + 16));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSessionsWidth((w) => Math.max(MIN_SESSIONS_WIDTH, w - 16));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSessionsWidth(DEFAULT_SESSIONS_WIDTH);
    }
  }, []);

  const trafficColumns = useMemo<DataGridColumn<ProxyTrafficRow>[]>(
    () => [
      {
        cell: (row) => {
          const wsMessages = (snapshot?.proxy_websocket_messages ?? []).filter(
            (m) => m.run_id === row.run_id && m.websocket_id === row.head.websocket_id,
          );
          const record = {...row, websocket_messages: wsMessages};
          const label = `T-${row.id}`;

          return (
            <button
              className="cite text-accent font-mono text-xs whitespace-nowrap hover:underline"
              type="button"
              onClick={() => setSelectedEvidence({label, record})}
            >
              [{label}]
            </button>
          );
        },
        header: "Ref",
        id: "ref",
        isRowHeader: true,
        minWidth: 90,
      },
      {
        cell: (row) => <span className="font-mono text-xs">{row.head.method ?? "—"}</span>,
        header: "Method",
        id: "method",
        minWidth: 90,
      },
      {
        cell: (row) => (
          <span className="block max-w-[280px] truncate font-mono text-xs">
            {row.head.uri ?? "—"}
          </span>
        ),
        header: "Target",
        id: "uri",
        minWidth: 220,
      },
      {
        cell: (row) => <span className="font-mono text-xs tabular-nums">{row.head.status ?? "—"}</span>,
        header: "Status",
        id: "status",
        minWidth: 80,
      },
      {
        align: "end",
        cell: (row) => <RowActions label={`T-${row.id}`} record={row} />,
        header: "Inspect",
        id: "inspect",
        minWidth: 80,
      },
    ],
    [setSelectedEvidence, snapshot?.proxy_websocket_messages],
  );

  const mcpColumns = useMemo<DataGridColumn<McpFrame>[]>(
    () => [
      {
        cell: (row) => {
          const label = `M-${row.frame_id}`;

          return (
            <button
              className="cite text-accent font-mono text-xs whitespace-nowrap hover:underline"
              type="button"
              onClick={() => setSelectedEvidence({label, record: row})}
            >
              [{label}]
            </button>
          );
        },
        header: "Ref",
        id: "ref",
        isRowHeader: true,
        minWidth: 90,
      },
      {
        accessorKey: "direction",
        cell: (row) => <span className="font-mono text-xs">{row.direction}</span>,
        header: "Direction",
        id: "direction",
        minWidth: 120,
      },
      {
        accessorKey: "method",
        cell: (row) => <span className="font-mono text-xs font-medium">{row.method}</span>,
        header: "Method",
        id: "method",
        minWidth: 180,
      },
      {
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {row.upstream_name || (row.session_id ? row.session_id.slice(0, 12) : "—")}
          </span>
        ),
        header: "Session / Upstream",
        id: "scope",
        minWidth: 150,
      },
      {
        align: "end",
        cell: (row) => <RowActions label={`M-${row.frame_id}`} record={row} />,
        header: "Inspect",
        id: "inspect",
        minWidth: 80,
      },
    ],
    [setSelectedEvidence],
  );

  const receiptColumns = useMemo<DataGridColumn<CapabilityReceiptRow>[]>(
    () => [
      {
        cell: (row) => {
          const label = `R-${row.receipt_id.slice(0, 8)}`;

          return (
            <button
              className="cite text-accent font-mono text-xs whitespace-nowrap hover:underline"
              type="button"
              onClick={() => {
                setSelectedReceiptId(row.receipt_id);
                setSelectedEvidence({label, record: row});
              }}
            >
              [{label}]
            </button>
          );
        },
        header: "Receipt",
        id: "receipt",
        isRowHeader: true,
        minWidth: 110,
      },
      {
        accessorKey: "bundle_id",
        cell: (row) => <span className="font-mono text-xs">{row.bundle_id}</span>,
        header: "Bundle",
        id: "bundle",
        minWidth: 120,
      },
      {
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">
            {row.remaining_calls} / {row.max_calls}
          </span>
        ),
        header: "Remaining",
        id: "quota",
        minWidth: 100,
      },
      {
        cell: (row) => (
          <span className="text-xs">
            {row.revoked
              ? "Revoked"
              : row.signature_verified
                ? "Ed25519 verified"
                : "Invalid signature"}
          </span>
        ),
        header: "Verification",
        id: "verification",
        minWidth: 140,
      },
      {
        align: "end",
        cell: (row) => <RowActions label={`R-${row.receipt_id.slice(0, 8)}`} record={row} />,
        header: "Inspect",
        id: "inspect",
        minWidth: 80,
      },
    ],
    [setSelectedEvidence, setSelectedReceiptId],
  );

  const observationColumns = useMemo<DataGridColumn<FingerprintObservation>[]>(
    () => [
      {
        cell: (row) => {
          const label = `F-${row.observation_id.slice(0, 8)}`;

          return (
            <button
              className="cite text-accent font-mono text-xs whitespace-nowrap hover:underline"
              type="button"
              onClick={() => setSelectedEvidence({label, record: row})}
            >
              [{label}]
            </button>
          );
        },
        header: "Ref",
        id: "ref",
        isRowHeader: true,
        minWidth: 110,
      },
      {
        accessorKey: "kind",
        cell: (row) => <span className="font-mono text-xs">{row.kind}</span>,
        header: "Kind",
        id: "kind",
        minWidth: 160,
      },
      {
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatTimestamp(row.created_at)}
          </span>
        ),
        header: "Captured",
        id: "captured",
        minWidth: 120,
      },
      {
        align: "end",
        cell: (row) => <RowActions label={`F-${row.observation_id.slice(0, 8)}`} record={row} />,
        header: "Inspect",
        id: "inspect",
        minWidth: 80,
      },
    ],
    [setSelectedEvidence],
  );

  return (
    <section
      aria-label="Session commerce and evidence workbench"
      className="border-border bg-surface flex flex-col overflow-hidden rounded-2xl border lg:flex-row"
    >
      {/* Left Resizable Pane: Agent Sessions */}
      <aside
        ref={paneRef}
        aria-label="Agent sessions"
        className="border-border flex shrink-0 flex-col border-b lg:border-b-0"
        style={{width: `${sessionsWidth}px`}}
      >
        <div className="border-border flex flex-col gap-2 border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-foreground text-sm font-semibold text-balance">Agent Sessions</h2>
            <span className="text-muted font-mono text-xs tabular-nums">{sessions.length}</span>
          </div>
          <SearchField
            aria-label="Filter agent sessions"
            name="session-search"
            value={sessionSearch}
            variant="secondary"
            onChange={setSessionSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Filter sessions..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>

        <div className="flex max-h-[520px] flex-1 flex-col overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="text-muted p-4 text-xs text-pretty">
              {unlocked
                ? "No MCP agent sessions recorded yet."
                : "Enter the admin token above to read persisted sessions."}
            </div>
          ) : (
            sessions.map((session) => {
              const isSelected = session.session_id === selectedSessionId;
              const clientName =
                session.client_config?.clientInfo?.name || "Unreported MCP client";

              return (
                <button
                  key={session.session_id}
                  className={
                    isSelected
                      ? "session selected border-accent bg-accent-soft/20 flex w-full flex-col gap-1 border p-3 text-left"
                      : "session border-border hover:bg-default/20 flex w-full flex-col gap-1 border-b p-3 text-left"
                  }
                  data-session-id={session.session_id}
                  style={{boxShadow: "none"}}
                  type="button"
                  onClick={() => setSelectedSessionId(session.session_id)}
                >
                  <span className="text-foreground truncate text-xs font-medium">{clientName}</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted truncate font-mono text-xs tabular-nums">
                      {session.session_id.slice(0, 12)} · {session.transport}
                    </span>
                    <span className="state text-accent shrink-0 font-mono text-xs font-medium">
                      {session.state}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Draggable Split-Pane Resize Handle */}
      <div
        aria-label="Resize sessions pane"
        aria-orientation="vertical"
        aria-valuemax={MAX_SESSIONS_WIDTH}
        aria-valuemin={MIN_SESSIONS_WIDTH}
        aria-valuenow={sessionsWidth}
        className="bg-border/60 hover:bg-accent/50 hidden min-h-[380px] w-1.5 shrink-0 select-none lg:block"
        role="separator"
        style={{cursor: "ew-resize", touchAction: "none"}}
        tabIndex={0}
        onDoubleClick={() => setSessionsWidth(DEFAULT_SESSIONS_WIDTH)}
        onKeyDown={handleResizeKeyDown}
        onMouseDown={handleResizeMouseDown}
      />

      {/* Right Detail Pane: Operator Action Bar + Lenses + Substrate DataGrid */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Fixed-Coordinate Operator Action Rail */}
        <div className="border-border flex flex-col gap-2 border-b p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span title={reasons.probe || "Run active capability probe"}>
              <Button
                isDisabled={Boolean(reasons.probe)}
                size="sm"
                variant="secondary"
                onPress={() => {
                  if (selectedSessionId) {
                    void mutate("/probe", {session_id: selectedSessionId});
                  }
                }}
              >
                Probe Session
              </Button>
            </span>

            <span title={reasons.evaluate || "Evaluate session with CLEF"}>
              <Button
                isDisabled={Boolean(reasons.evaluate)}
                size="sm"
                variant="secondary"
                onPress={() => openDialog("evaluate-clef")}
              >
                Run CLEF Eval
              </Button>
            </span>

            <span title={reasons.synthesize || "Synthesize session bundle offers"}>
              <Button
                isDisabled={Boolean(reasons.synthesize)}
                size="sm"
                variant="secondary"
                onPress={() => {
                  if (selectedSessionId) {
                    void mutate("/offers/synthesize", {session_id: selectedSessionId});
                  }
                }}
              >
                Synthesize Offer
              </Button>
            </span>

            <span title={reasons.issue || "Issue Ed25519 capability receipt"}>
              <Button
                isDisabled={Boolean(reasons.issue)}
                size="sm"
                variant="secondary"
                onPress={() => openDialog("issue-receipt")}
              >
                Issue Receipt
              </Button>
            </span>

            <span title={reasons.revoke || "Revoke selected capability receipt"}>
              <Button
                isDisabled={Boolean(reasons.revoke)}
                size="sm"
                variant="danger-soft"
                onPress={() => {
                  if (selectedReceiptId) {
                    void mutate("/receipts/revoke", {receipt_id: selectedReceiptId});
                  }
                }}
              >
                Revoke Receipt
              </Button>
            </span>
          </div>

          <div className="text-muted flex flex-wrap gap-x-4 gap-y-1 text-xs" id="control-reasons">
            {activeReasonEntries.map(([action, reason]) => (
              <span key={action}>
                <strong className="font-medium">{action}:</strong> {reason}
              </span>
            ))}
          </div>
        </div>

        {/* 3 Grounded Evidence Panels: CLEF Lens (#clef), Session Offers (#offers), Receipt (#receipt) */}
        <div className="border-border grid grid-cols-1 border-b lg:grid-cols-3">
          {/* CLEF Lens */}
          <div
            className="border-border flex min-w-0 flex-col gap-2 border-b p-3 lg:border-b-0 lg:border-r"
            id="clef"
          >
            <h3 className="text-foreground text-xs font-semibold">CLEF Evaluation</h3>
            {clefStatus?.status !== "Ready" ? (
              <div className="banner border-border bg-background text-muted rounded-lg border p-2.5 text-xs [overflow-wrap:anywhere]">
                {clefStatus?.status === "ModelError"
                  ? `ModelError: ${clefStatus.error}`
                  : "Unconfigured · no model loaded"}
              </div>
            ) : (
              <div className="text-muted truncate font-mono text-xs">
                {clefStatus.backend} · {clefStatus.model_path.split("/").pop()}
              </div>
            )}

            {latestEvaluation ? (
              <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted">Status</dt>
                <dd className="min-w-0 font-mono">{latestEvaluation.status}</dd>
                <dt className="text-muted">Question</dt>
                <dd className="min-w-0 font-mono [overflow-wrap:anywhere]">
                  {JSON.stringify(latestEvaluation.question)}
                </dd>
                <dt className="text-muted">Pick</dt>
                <dd className="min-w-0 font-mono [overflow-wrap:anywhere]">
                  {JSON.stringify(latestEvaluation.pick)}
                </dd>
                <dt className="text-muted">Input tokens</dt>
                <dd className="font-mono tabular-nums">{latestEvaluation.input_tokens ?? 0}</dd>
                <dt className="text-muted">Output tokens</dt>
                <dd className="font-mono tabular-nums">{latestEvaluation.output_tokens ?? 0}</dd>
                <dt className="text-muted">Latency</dt>
                <dd className="font-mono tabular-nums">
                  {latestEvaluation.latency_ms === null ? "0 ms" : `${latestEvaluation.latency_ms} ms`}
                </dd>
                <dt className="text-muted">option_scores</dt>
                <dd className="font-mono">null</dd>
              </dl>
            ) : (
              <p className="text-muted text-xs">No CLEF evaluation recorded for this session.</p>
            )}
          </div>

          {/* Session Offers */}
          <div
            className="border-border flex min-w-0 flex-col gap-2 border-b p-3 lg:border-b-0 lg:border-r"
            id="offers"
          >
            <h3 className="text-foreground text-xs font-semibold">Session Offers</h3>
            {sessionOffers.length === 0 ? (
              <p className="text-muted text-xs">
                {unlocked
                  ? "No persisted offers for this session."
                  : "Unlock to inspect synthesized session offers."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {sessionOffers.map((offer) => (
                  <li
                    key={offer.offer_id}
                    className="border-border bg-background flex min-w-0 flex-col gap-0.5 rounded-lg border p-2 text-xs"
                  >
                    <span className="text-foreground font-mono font-medium [overflow-wrap:anywhere]">
                      {offer.bundle_id}
                    </span>
                    <span className="text-muted text-xs [overflow-wrap:anywhere]">{offer.source}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Capability Receipt */}
          <div className="flex min-w-0 flex-col gap-2 p-3" id="receipt">
            <h3 className="text-foreground text-xs font-semibold">Capability Receipt</h3>
            {selectedReceipt ? (
              <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted">Receipt</dt>
                <dd className="min-w-0 truncate font-mono tabular-nums">
                  {selectedReceipt.receipt_id}
                </dd>
                <dt className="text-muted">Bundle</dt>
                <dd className="min-w-0 font-mono [overflow-wrap:anywhere]">
                  {selectedReceipt.bundle_id}
                </dd>
                <dt className="text-muted">Signature</dt>
                <dd className="text-success font-medium">
                  {selectedReceipt.signature_verified
                    ? "Ed25519 verified"
                    : "Verification failed"}
                </dd>
                <dt className="text-muted">Remaining</dt>
                <dd className="font-mono tabular-nums">
                  {selectedReceipt.remaining_calls} / {selectedReceipt.max_calls}
                </dd>
                <dt className="text-muted">Revoked</dt>
                <dd className="font-mono">{selectedReceipt.revoked ? "yes" : "no"}</dd>
              </dl>
            ) : (snapshot?.bundles.length ?? 0) > 0 ? (
              <div className="text-muted flex flex-col gap-1 font-mono text-xs [overflow-wrap:anywhere]">
                {snapshot!.bundles.map((b) => (
                  <div key={b.bundle_id}>
                    {b.bundle_id} · {b.items.join(", ")}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted text-xs">No bundles or receipts configured.</p>
            )}
          </div>
        </div>

        {/* Substrate Switcher + HeroUI Pro DataGrid + Raw Evidence JSON (#evidence) */}
        <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
          <Button
            size="sm"
            variant={canvasTab === "traffic" ? "primary" : "tertiary"}
            onPress={() => setCanvasTab("traffic")}
          >
            HTTP / WS
          </Button>
          <Button
            size="sm"
            variant={canvasTab === "mcp" ? "primary" : "tertiary"}
            onPress={() => setCanvasTab("mcp")}
          >
            MCP / MRTR
          </Button>
          <Button
            size="sm"
            variant={canvasTab === "receipts" ? "primary" : "tertiary"}
            onPress={() => setCanvasTab("receipts")}
          >
            RECEIPTS
          </Button>
          <Button
            size="sm"
            variant={canvasTab === "handshake" ? "primary" : "tertiary"}
            onPress={() => setCanvasTab("handshake")}
          >
            HANDSHAKE
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="border-border min-w-0 border-b p-3 lg:border-b-0 lg:border-r">
            {canvasTab === "traffic" ? (
              <DataGrid
                aria-label="Proxy HTTP and WebSocket traffic"
                columns={trafficColumns}
                data={trafficRows}
                getRowId={(row) => row.id}
                renderEmptyState={() => (
                  <span className="text-muted py-6 text-xs">No persisted HTTP/WS traffic rows.</span>
                )}
              />
            ) : null}

            {canvasTab === "mcp" ? (
              <DataGrid
                aria-label="Persisted MCP frames"
                columns={mcpColumns}
                data={mcpRows}
                getRowId={(row) => row.frame_id}
                renderEmptyState={() => (
                  <span className="text-muted py-6 text-xs">No persisted MCP frames.</span>
                )}
              />
            ) : null}

            {canvasTab === "receipts" ? (
              <DataGrid
                aria-label="Issued capability receipts"
                columns={receiptColumns}
                data={receiptRows}
                getRowId={(row) => row.receipt_id}
                renderEmptyState={() => (
                  <span className="text-muted py-6 text-xs">No capability receipts issued.</span>
                )}
              />
            ) : null}

            {canvasTab === "handshake" ? (
              <DataGrid
                aria-label="Session handshake observations"
                columns={observationColumns}
                data={sessionObservations}
                getRowId={(row) => row.observation_id}
                renderEmptyState={() => (
                  <span className="text-muted py-6 text-xs">
                    No fingerprint observations captured for this session.
                  </span>
                )}
              />
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-2 p-3" id="evidence">
            <h3 className="text-foreground text-xs font-semibold">Selected Citation</h3>
            {selectedEvidence ? (
              <>
                <span className="text-accent font-mono text-xs font-medium">
                  {selectedEvidence.label}
                </span>
                <pre className="border-border bg-background max-h-[280px] overflow-auto rounded-lg border p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedEvidence.record, null, 2)}
                </pre>
              </>
            ) : (
              <p className="text-muted text-xs">
                Click any <span className="font-mono">[T-xx]</span>,{" "}
                <span className="font-mono">[M-xx]</span>, or{" "}
                <span className="font-mono">[R-xx]</span> citation to inspect raw persisted SQLite
                JSON.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
