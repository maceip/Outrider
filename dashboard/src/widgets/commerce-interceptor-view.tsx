"use client";

import type {
  CommercePhase,
  CommerceTransaction,
  CommercialOffer,
  InterceptionDirection,
  InterceptionDraft,
  InterceptionEvent,
  InterceptionWorkspaceState,
} from "../lib/interceptor-types";
import type {Selection} from "@heroui/react";
import type {DataGridColumn} from "@heroui-pro/react";

import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CirclePause,
  Play,
  Pulse,
  ShieldCheck,
} from "@gravity-ui/icons";
import {
  Button,
  Card,
  Chip,
  Drawer,
  Dropdown,
  Label,
  ListBox,
  ScrollShadow,
  Switch,
  toast,
} from "@heroui/react";
import {DataGrid, EmptyState, Segment} from "@heroui-pro/react";
import {CodeBlock} from "@heroui-pro/react/code-block";
import {Resizable} from "@heroui-pro/react/resizable";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {COMMERCE_API_BASE, TOKEN_STORAGE_KEY, useCoreStore} from "../lib/core-store";
import {
  EMPTY_INTERCEPTION_STATE,
  formatMoneyCompact,
  formatMoneyExact,
  parseInterceptionWorkspaceState,
} from "../lib/interceptor-types";
import {WwwInterceptorEngine} from "../lib/www-interceptor-engine";

import {CausalCradledGraph} from "./causal-cradled-graph";
import {PassesLedgerPanel, getPassStatus} from "./passes-ledger-panel";
import {WireEvidencePanel} from "./wire-evidence-panel";

const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

export interface CommerceInterceptorViewProps {
  embedded?: boolean;
}

type EventFilterKey = "all" | "mcp" | "http" | "held_pending" | "errors";
type InvestigationViewMode = "both" | "graph" | "approve" | "wire" | "orders";

function useIsCompactViewport(): boolean {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsCompact(mql.matches);

    sync();
    mql.addEventListener("change", sync);

    return () => {
      mql.removeEventListener("change", sync);
    };
  }, []);

  return isCompact;
}

const PHASE_STEPS: ReadonlyArray<{id: CommercePhase; label: string}> = [
  {id: "discover", label: "Discover"},
  {id: "negotiate", label: "Negotiate"},
  {id: "cart", label: "Cart"},
  {id: "payment", label: "Payment"},
  {id: "fulfill", label: "Fulfill"},
];

function readSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

async function fetchInterceptionStateFromGateway(
  signal?: AbortSignal,
): Promise<InterceptionWorkspaceState | null> {
  if (IS_WWW) return null;
  const bearer = readSessionToken();

  if (!bearer) return null;
  try {
    const response = await fetch(`${COMMERCE_API_BASE}/interception/state`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
      signal,
    });

    if (!response.ok) return null;
    const raw: unknown = await response.json();

    return parseInterceptionWorkspaceState(raw);
  } catch {
    return null;
  }
}

function formatTraceTime(timestampMs: number, epistemicKind: string): string {
  if (epistemicKind === "pending" || !timestampMs || timestampMs <= 0) {
    return "—";
  }
  const date = new Date(timestampMs);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString("en-US", {
    fractionalSecondDigits: 3,
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatHoldDurationSec(baseHoldMs: number | null | undefined, extraElapsedMs: number): string {
  const totalMs = Math.max(0, (baseHoldMs ?? 0) + extraElapsedMs);
  const wholeSec = Math.max(1, Math.floor(totalMs / 1000));

  return `${wholeSec}s`;
}

function formatPhaseSubStatus(tx: CommerceTransaction): string {
  if (tx.sub_status.trim().length > 0) {
    return tx.sub_status;
  }
  const phaseLabel =
    PHASE_STEPS.find((step) => step.id === tx.phase)?.label ?? "Negotiate";

  if (tx.status === "held") {
    return `${phaseLabel} (held)`;
  }
  if (tx.status === "complete") {
    return `${phaseLabel} (complete)`;
  }

  return phaseLabel;
}

function renderTraceStatusChip(event: InterceptionEvent) {
  if (event.hold_state === "held" || event.epistemic_kind === "held") {
    return (
      <Chip className="font-mono tabular-nums" color="warning" size="sm" variant="soft">
        HELD
      </Chip>
    );
  }
  if (event.epistemic_kind === "pending") {
    return (
      <Chip className="font-mono tabular-nums" color="default" size="sm" variant="soft">
        PENDING
      </Chip>
    );
  }
  if ((event.status_code !== null && event.status_code >= 400) || event.status_label === "ERROR") {
    return (
      <Chip className="font-mono tabular-nums" color="danger" size="sm" variant="soft">
        {event.status_code ?? (event.status_label || "ERR")}
      </Chip>
    );
  }

  return (
    <Chip className="font-mono tabular-nums" color="success" size="sm" variant="soft">
      {event.status_code ?? (event.status_label || "200")}
    </Chip>
  );
}

function formatSellerPolicyLabel(
  status: InterceptionDraft["validation"]["seller_policy"] | undefined,
): string {
  if (status === "valid") return "Valid";
  if (status === "rejected") return "Rejected";

  return "Pending validation";
}

function formatOperatorApprovalLabel(
  status: InterceptionDraft["validation"]["operator_approval"] | undefined,
): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";

  return "Awaiting operator";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export function CommerceInterceptorView({embedded = false}: CommerceInterceptorViewProps) {
  const {eventsVersion, mutate, refreshTraffics, snapshot, traffics} = useCoreStore();

  const [liveState, setLiveState] = useState<InterceptionWorkspaceState | null>(null);
  const [wwwState, setWwwState] = useState<InterceptionWorkspaceState>(EMPTY_INTERCEPTION_STATE);
  const [stateFetchedAtMs, setStateFetchedAtMs] = useState<number>(() => Date.now());
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<EventFilterKey>("all");
  const [viewMode, setViewMode] = useState<InvestigationViewMode>("both");
  const [selectedWirePacketId, setSelectedWirePacketId] = useState<number | null>(null);
  const [laneOverride, setLaneOverride] = useState<InterceptionDirection | null>(null);
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [streamExpanded, setStreamExpanded] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const wwwEngineRef = useRef<WwwInterceptorEngine | null>(null);

  const syncWwwState = useCallback(() => {
    const engine = wwwEngineRef.current;

    if (!engine) return;
    setWwwState(engine.getState());
    setStateFetchedAtMs(Date.now());
  }, []);

  const getWwwEngine = useCallback((): WwwInterceptorEngine => {
    if (!wwwEngineRef.current) {
      wwwEngineRef.current = new WwwInterceptorEngine(syncWwwState);
    }

    return wwwEngineRef.current;
  }, [syncWwwState]);

  useEffect(() => {
    if (!IS_WWW) return;
    const controller = new AbortController();

    void getWwwEngine()
      .ensureLoaded(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const message =
            error instanceof Error ? error.message : "Unable to load demo interception state";

          toast.danger(message);
        }
      });

    return () => {
      controller.abort();
    };
  }, [getWwwEngine]);

  const snapshotInterception = useMemo<InterceptionWorkspaceState | null>(() => {
    if (IS_WWW || !snapshot) return null;
    const raw = (snapshot as unknown as Record<string, unknown>).interception;

    return parseInterceptionWorkspaceState(raw);
  }, [snapshot]);

  const refreshLiveInterceptionState = useCallback(async (): Promise<void> => {
    const parsed = await fetchInterceptionStateFromGateway();

    if (parsed) {
      setLiveState(parsed);
      setStateFetchedAtMs(Date.now());
      setNowTickMs(Date.now());
    }
  }, []);

  const hasSnapshot = snapshot !== null;

  useEffect(() => {
    if (IS_WWW || !hasSnapshot) return;
    const controller = new AbortController();

    void (async () => {
      const parsed = await fetchInterceptionStateFromGateway(controller.signal);

      if (!controller.signal.aborted && parsed) {
        setLiveState(parsed);
        setStateFetchedAtMs(Date.now());
        setNowTickMs(Date.now());
      }
    })();

    return () => {
      controller.abort();
    };
  }, [eventsVersion, hasSnapshot]);

  const workspaceState: InterceptionWorkspaceState = useMemo(() => {
    if (IS_WWW) return wwwState;

    return liveState ?? snapshotInterception ?? EMPTY_INTERCEPTION_STATE;
  }, [liveState, snapshotInterception, wwwState]);

  const hasHeldEvents = useMemo(
    () => workspaceState.events.some((ev) => ev.hold_state === "held"),
    [workspaceState.events],
  );

  useEffect(() => {
    if (!hasHeldEvents) return;
    const timer = setInterval(() => {
      setNowTickMs(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [hasHeldEvents]);

  const extraHoldElapsedMs = hasHeldEvents ? Math.max(0, nowTickMs - stateFetchedAtMs) : 0;

  const activeTx: CommerceTransaction | null = useMemo(() => {
    if (workspaceState.transactions.length === 0) return null;
    if (selectedTxId) {
      const matched = workspaceState.transactions.find((t) => t.tx_id === selectedTxId);

      if (matched) return matched;
    }

    return (
      workspaceState.transactions.find((t) => t.tx_id === "audioshop") ??
      workspaceState.transactions[0]
    );
  }, [selectedTxId, workspaceState.transactions]);

  const txEvents = useMemo<InterceptionEvent[]>(() => {
    if (!activeTx) return [];

    return workspaceState.events
      .filter((ev) => ev.tx_id === activeTx.tx_id)
      .sort((a, b) => a.seq - b.seq);
  }, [activeTx, workspaceState.events]);

  const txOffers = useMemo<CommercialOffer[]>(() => {
    if (!activeTx) return [];

    return workspaceState.offers.filter((offer) => offer.tx_id === activeTx.tx_id);
  }, [activeTx, workspaceState.offers]);

  const activeDraft = useMemo<InterceptionDraft | null>(() => {
    if (!activeTx) return null;

    return workspaceState.drafts.find((draft) => draft.tx_id === activeTx.tx_id) ?? null;
  }, [activeTx, workspaceState.drafts]);

  const effectiveSelectedEventId = useMemo<string | null>(() => {
    if (txEvents.length === 0) return null;
    if (selectedEventId && txEvents.some((ev) => ev.event_id === selectedEventId)) {
      return selectedEventId;
    }
    const heldEv = txEvents.find((ev) => ev.hold_state === "held" || ev.epistemic_kind === "held");

    if (heldEv) return heldEv.event_id;
    const r02 = txEvents.find((ev) => ev.event_id === "R02");

    if (r02) return r02.event_id;

    return txEvents[0].event_id;
  }, [selectedEventId, txEvents]);

  const selectedEvent = useMemo<InterceptionEvent | null>(
    () => txEvents.find((ev) => ev.event_id === effectiveSelectedEventId) ?? null,
    [effectiveSelectedEventId, txEvents],
  );

  const filterCounts = useMemo(() => {
    const mcp = txEvents.filter((ev) => ev.protocol === "MCP").length;
    const http = txEvents.filter((ev) => ev.protocol === "HTTP").length;
    const heldPending = txEvents.filter(
      (ev) => ev.epistemic_kind === "held" || ev.epistemic_kind === "pending",
    ).length;
    const errors = txEvents.filter(
      (ev) => (ev.status_code !== null && ev.status_code >= 400) || ev.status_label === "ERROR",
    ).length;

    return {
      all: txEvents.length,
      errors,
      held_pending: heldPending,
      http,
      mcp,
    };
  }, [txEvents]);

  const filteredTraceEvents = useMemo<InterceptionEvent[]>(() => {
    return txEvents.filter((ev) => {
      if (eventFilter === "mcp") return ev.protocol === "MCP";
      if (eventFilter === "http") return ev.protocol === "HTTP";
      if (eventFilter === "held_pending") {
        return ev.epistemic_kind === "held" || ev.epistemic_kind === "pending";
      }
      if (eventFilter === "errors") {
        return (ev.status_code !== null && ev.status_code >= 400) || ev.status_label === "ERROR";
      }

      return true;
    });
  }, [eventFilter, txEvents]);

  const effectiveLane: InterceptionDirection =
    laneOverride ?? activeDraft?.lane ?? "seller_to_buyer";

  const executeInterceptionMutation = useCallback(
    async (path: string, body: Record<string, unknown>, busyKey: string) => {
      setActionBusy(busyKey);
      try {
        if (IS_WWW) {
          const next = await getWwwEngine().mutate(path, body);

          setWwwState(next);
          setStateFetchedAtMs(Date.now());
          setNowTickMs(Date.now());

          return next;
        }
        const raw = await mutate(path, body);
        const parsed = parseInterceptionWorkspaceState(raw);

        if (parsed) {
          setLiveState(parsed);
          setStateFetchedAtMs(Date.now());
          setNowTickMs(Date.now());
        }
        await refreshLiveInterceptionState();
        void refreshTraffics();

        return parsed;
      } catch (error) {
        if (IS_WWW) {
          toast.danger(error instanceof Error ? error.message : "Interception action failed");
        }
        throw error;
      } finally {
        setActionBusy(null);
      }
    },
    [getWwwEngine, mutate, refreshLiveInterceptionState, refreshTraffics],
  );

  const handleRunScenario = useCallback(async () => {
    try {
      const next = await executeInterceptionMutation(
        "/interception/run-scenario",
        {include_peers: true, preset: "audioshop"},
        "scenario",
      );

      setLaneOverride(null);
      setSelectedTxId("audioshop");
      setViewMode("both");
      const heldId =
        next?.events.find((ev) => ev.tx_id === "audioshop" && ev.hold_state === "held")?.event_id ??
        "R02";

      setSelectedEventId(heldId);
      toast.success("AudioShop live interception active");
    } catch {
      // Error surfaced via toast.
    }
  }, [executeInterceptionMutation]);

  const handleLaneChange = useCallback(
    async (nextLane: InterceptionDirection) => {
      setLaneOverride(nextLane);
      if (!activeTx || !activeDraft) return;
      try {
        await executeInterceptionMutation(
          "/interception/draft",
          {
            enabled: activeDraft.enabled,
            lane: nextLane,
            target_event_id: activeDraft.target_event_id,
            tx_id: activeTx.tx_id,
          },
          "lane",
        );
      } catch {
        // Error surfaced via toast.
      }
    },
    [activeDraft, activeTx, executeInterceptionMutation],
  );

  const handleToggleDraft = useCallback(
    async (enabled: boolean) => {
      if (!activeTx || !activeDraft) return;
      try {
        await executeInterceptionMutation(
          "/interception/draft",
          {
            enabled,
            lane: effectiveLane,
            target_event_id: activeDraft.target_event_id,
            tx_id: activeTx.tx_id,
          },
          "draft",
        );
      } catch {
        // Error surfaced via toast.
      }
    },
    [activeDraft, activeTx, effectiveLane, executeInterceptionMutation],
  );

  const handleValidatePolicy = useCallback(async () => {
    if (!activeTx) return;
    const targetEventId = activeDraft?.target_event_id ?? selectedEvent?.event_id ?? "R02";

    try {
      await executeInterceptionMutation(
        "/interception/validate",
        {
          target_event_id: targetEventId,
          tx_id: activeTx.tx_id,
        },
        "validate",
      );
      toast.success("Seller policy verified");
    } catch {
      // Error surfaced via toast.
    }
  }, [activeDraft?.target_event_id, activeTx, executeInterceptionMutation, selectedEvent?.event_id]);

  const handleRelease = useCallback(
    async (requestedMode: "replacement" | "original") => {
      if (!activeTx) return;
      const targetEventId = activeDraft?.target_event_id ?? selectedEvent?.event_id ?? "R02";
      const effectiveMode =
        requestedMode === "replacement" && activeDraft?.enabled === false
          ? "original"
          : requestedMode;

      try {
        if (
          effectiveMode === "replacement" &&
          activeDraft?.validation.seller_policy === "pending_validation"
        ) {
          await executeInterceptionMutation(
            "/interception/validate",
            {
              target_event_id: targetEventId,
              tx_id: activeTx.tx_id,
            },
            "validate",
          );
        }
        await executeInterceptionMutation(
          "/interception/release",
          {
            mode: effectiveMode,
            target_event_id: targetEventId,
            tx_id: activeTx.tx_id,
          },
          requestedMode === "replacement" ? "release-replacement" : "release-original",
        );
        toast.success(
          effectiveMode === "replacement"
            ? "Replacement response released to buyer"
            : "Original seller response forwarded",
        );
      } catch {
        // Error surfaced via toast.
      }
    },
    [
      activeDraft,
      activeTx,
      executeInterceptionMutation,
      selectedEvent?.event_id,
    ],
  );

  const handleAuthorizePayment = useCallback(async () => {
    if (!activeTx) return;
    try {
      await executeInterceptionMutation(
        "/interception/authorize-payment",
        {
          bundle_id: "conduit_session_evidence",
          tx_id: activeTx.tx_id,
        },
        "authorize",
      );
      if (IS_WWW) {
        void mutate("/receipts/issue", {
          bundle_id: "conduit_session_evidence",
          max_calls: 10,
          subject: activeTx.buyer_agent,
        }).catch(() => {});
      }
      toast.success("Session payment pass authorized");
    } catch {
      // Error surfaced via toast.
    }
  }, [activeTx, executeInterceptionMutation, mutate]);

  const traceColumns = useMemo<DataGridColumn<InterceptionEvent>[]>(
    () => [
      {
        accessorKey: "event_id",
        cell: (item) => (
          <span className="text-foreground font-mono text-xs font-semibold tabular-nums">
            {item.event_id}
          </span>
        ),
        header: "ID",
        id: "event_id",
        isRowHeader: true,
        minWidth: 56,
        width: 62,
      },
      {
        cell: (item) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatTraceTime(item.timestamp_ms, item.epistemic_kind)}
          </span>
        ),
        header: "Time",
        id: "time",
        minWidth: 88,
        width: 96,
      },
      {
        cell: (item) => (
          <span className="text-muted font-mono text-xs whitespace-nowrap">
            {item.direction === "buyer_to_seller" ? "Buyer → Seller" : "Seller → Buyer"}
          </span>
        ),
        header: "Actor",
        id: "actor",
        minWidth: 112,
        width: 118,
      },
      {
        accessorKey: "event_name",
        cell: (item) => (
          <span className="text-foreground font-mono text-xs font-medium whitespace-nowrap">
            {item.event_name}
          </span>
        ),
        header: "Event",
        id: "event_name",
        minWidth: 168,
      },
      {
        accessorKey: "observation",
        cell: (item) => (
          <span
            className="text-muted block max-w-[280px] truncate text-xs"
            title={item.observation}
          >
            {item.observation}
          </span>
        ),
        header: "Observation",
        id: "observation",
        minWidth: 180,
      },
      {
        align: "end",
        cell: (item) => renderTraceStatusChip(item),
        header: "Status",
        id: "status",
        minWidth: 88,
        width: 96,
      },
    ],
    [],
  );

  const selectedTraceKeys = useMemo<Selection>(
    () => (effectiveSelectedEventId ? new Set([effectiveSelectedEventId]) : new Set()),
    [effectiveSelectedEventId],
  );

  const handleTraceSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const first = Array.from(keys)[0];

    if (typeof first === "string" && first.length > 0) {
      setSelectedEventId(first);
      setViewMode((prev) => (prev === "wire" || prev === "orders" ? "both" : prev));
    }
  }, []);

  const handleSessionSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const first = Array.from(keys)[0];

    if (typeof first === "string" && first.length > 0) {
      setSelectedTxId(first);
      setSelectedEventId(null);
      setLaneOverride(null);
      setViewMode((prev) => (prev === "wire" || prev === "orders" ? "both" : prev));
    }
  }, []);

  const handleFilterSelectionChange = useCallback((keys: Selection) => {
    if (keys === "all") return;
    const first = Array.from(keys)[0];

    if (typeof first === "string") {
      setEventFilter(first as EventFilterKey);
      setViewMode("both");
    }
  }, []);

  const primaryOffer = useMemo<CommercialOffer | null>(() => {
    if (txOffers.length === 0) return null;

    return (
      txOffers.find((o) => o.committed) ??
      txOffers.find((o) => !o.is_draft) ??
      txOffers[0]
    );
  }, [txOffers]);

  const promoOffer = useMemo<CommercialOffer | null>(() => {
    if (txOffers.length === 0) return null;

    return (
      txOffers.find(
        (o) => (activeDraft ? o.offer_id === activeDraft.promo_offer_id : false) || o.is_draft,
      ) ?? null
    );
  }, [activeDraft, txOffers]);

  const sellerResponses = useMemo<InterceptionEvent[]>(
    () =>
      txEvents.filter(
        (ev) =>
          ev.direction === "seller_to_buyer" ||
          ev.event_id === "R02" ||
          ev.event_id === "C04" ||
          ev.event_id === "C05",
      ),
    [txEvents],
  );

  const heldTargetEvent = useMemo<InterceptionEvent | null>(
    () =>
      txEvents.find((ev) => ev.hold_state === "held") ??
      (activeDraft
        ? (txEvents.find((ev) => ev.event_id === activeDraft.target_event_id) ?? null)
        : null),
    [activeDraft, txEvents],
  );

  const canReleaseIntercept = Boolean(heldTargetEvent && heldTargetEvent.hold_state === "held");

  const activePhaseIndex = useMemo(() => {
    if (!activeTx) return 0;
    const idx = PHASE_STEPS.findIndex((step) => step.id === activeTx.phase);

    return idx >= 0 ? idx : 0;
  }, [activeTx]);

  const streamPackets = useMemo(() => {
    const scopedEvents = activeTx
      ? workspaceState.events.filter((ev) => ev.tx_id === activeTx.tx_id)
      : workspaceState.events;
    const observedInterception = scopedEvents
      .filter((ev) => ev.epistemic_kind !== "pending")
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms || b.seq - a.seq);

    if (observedInterception.length > 0) {
      return observedInterception.map((ev) => ({
        arrow: ev.direction === "buyer_to_seller" ? "→" : "←",
        eventId: ev.event_id,
        id: `${ev.tx_id}:${ev.event_id}`,
        isHeld: ev.hold_state === "held",
        latencyText:
          ev.hold_state === "held"
            ? formatHoldDurationSec(ev.hold_ms, extraHoldElapsedMs)
            : ev.latency_ms !== null
              ? `${ev.latency_ms} ms`
              : "0 ms",
        name: ev.event_name,
        observation: ev.observation,
        protocol: ev.protocol,
        statusLabel: ev.hold_state === "held" ? "HELD" : ev.status_code ? "OK" : ev.status_label || "OK",
        txId: ev.tx_id,
      }));
    }

    return traffics.slice(0, 20).map((pkt) => ({
      arrow: "→",
      eventId: null as string | null,
      id: `pkt-${pkt.id}`,
      isHeld: false,
      latencyText: pkt.time !== null ? `${pkt.time} ms` : "0 ms",
      name: `${pkt.method} ${pkt.uri}`,
      observation: pkt.mime || "application/json",
      protocol: pkt.uri.includes("/mcp") ? ("MCP" as const) : ("HTTP" as const),
      statusLabel: pkt.status !== null && pkt.status >= 400 ? String(pkt.status) : "OK",
      txId: null as string | null,
    }));
  }, [activeTx, extraHoldElapsedMs, traffics, workspaceState.events]);

  const streamStats = useMemo(() => {
    const scopedEvents = activeTx
      ? workspaceState.events.filter((ev) => ev.tx_id === activeTx.tx_id)
      : workspaceState.events;
    const observedEvents = scopedEvents.filter((ev) => ev.epistemic_kind !== "pending");
    const totalEvents =
      observedEvents.length > 0 ? observedEvents.length : traffics.length;
    const heldCount = scopedEvents.filter((ev) => ev.hold_state === "held").length;

    const latencies =
      observedEvents.length > 0
        ? observedEvents
            .map((ev) => ev.latency_ms)
            .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms))
        : traffics
            .map((t) => t.time)
            .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms));

    const avgMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, val) => sum + val, 0) / latencies.length)
        : 0;

    return {
      avgMs,
      heldCount,
      totalEvents,
    };
  }, [activeTx, traffics, workspaceState.events]);

  const inspectOriginalEvent = heldTargetEvent ?? selectedEvent;
  const originalPayloadCode = useMemo(
    () => prettyJson(inspectOriginalEvent?.payload ?? {}),
    [inspectOriginalEvent],
  );
  const proposedPayloadCode = useMemo(
    () => (activeDraft ? prettyJson(activeDraft.proposed_payload) : ""),
    [activeDraft],
  );

  const sourceParty = activeTx
    ? effectiveLane === "seller_to_buyer"
      ? activeTx.seller_host
      : activeTx.buyer_agent
    : "—";
  const recipientParty = activeTx
    ? effectiveLane === "seller_to_buyer"
      ? activeTx.buyer_agent
      : activeTx.seller_host
    : "—";

  const promoSwitchText = promoOffer
    ? `Include ${promoOffer.offer_id} (${formatMoneyCompact(promoOffer.price_cents, promoOffer.currency)})`
    : activeDraft
      ? activeDraft.summary || `Include ${activeDraft.promo_offer_id}`
      : "Include promotional offer";

  const validation = activeDraft?.validation;
  const isTxComplete = activeTx?.status === "complete";
  const mcpSchemaValid = validation ? validation.mcp_schema === "valid" : true;
  const sellerPolicyState = validation?.seller_policy ?? (isTxComplete ? "valid" : "pending_validation");
  const operatorApprovalState =
    validation?.operator_approval ?? (isTxComplete ? "approved" : "awaiting_operator");
  const paymentAuthState =
    validation?.payment_auth ?? (isTxComplete ? "authorized" : "unverified");

  const selectedEventIsHeld = Boolean(
    selectedEvent && (selectedEvent.hold_state === "held" || selectedEvent.epistemic_kind === "held"),
  );

  const passes = useMemo(() => snapshot?.capability_receipts ?? [], [snapshot]);
  const bundles = useMemo(() => snapshot?.bundles ?? [], [snapshot]);
  const activePasses = useMemo(
    () => passes.filter((row) => getPassStatus(row) === "Active"),
    [passes],
  );
  const buyerPasses = useMemo(
    () =>
      activeTx
        ? passes.filter((row) => row.subject === activeTx.buyer_agent)
        : passes,
    [activeTx, passes],
  );

  const isCompactViewport = useIsCompactViewport();
  const desktopViewMode = viewMode === "approve" ? "both" : viewMode;
  const mobileViewMode = viewMode === "graph" ? "both" : viewMode;

  const rootHeightClass = isCompactViewport
    ? embedded
      ? "border-border bg-surface flex w-full min-w-0 flex-col overflow-hidden rounded-xl border"
      : "border-border bg-surface flex min-h-[calc(100dvh-6.75rem)] w-full min-w-0 flex-col overflow-hidden border-b"
    : embedded
      ? "border-border bg-surface flex h-[740px] w-full min-w-0 flex-col overflow-hidden rounded-xl border"
      : "border-border bg-surface flex h-[calc(100dvh-6.75rem)] min-h-[620px] w-full min-w-0 flex-col overflow-hidden border-b";

  const renderInspectDrawer = () => (
    <Drawer isOpen={isInspectOpen} onOpenChange={setIsInspectOpen}>
      <Button
        isDisabled={!inspectOriginalEvent && !activeDraft}
        size="sm"
        variant="ghost"
      >
        Inspect
      </Button>
      <Drawer.Backdrop>
        <Drawer.Content className="sm:max-w-xl" placement="right">
          <Drawer.Dialog aria-label="Inspect Payload">
            <Drawer.CloseTrigger />
            <Drawer.Header className="flex-col items-start gap-1">
              <Drawer.Heading className="text-foreground text-base font-semibold">
                Inspect Payload
              </Drawer.Heading>
              {inspectOriginalEvent ? (
                <p className="text-muted font-mono text-xs">
                  {`${inspectOriginalEvent.event_id} · ${inspectOriginalEvent.event_name}`}
                </p>
              ) : null}
            </Drawer.Header>
            <Drawer.Body className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-foreground text-xs font-semibold">
                  Original Wire Payload
                </span>
                <CodeBlock className="my-0 rounded-lg">
                  <CodeBlock.Header>
                    <span className="text-muted font-mono text-xs">Original JSON</span>
                    <CodeBlock.CopyButton code={originalPayloadCode} />
                  </CodeBlock.Header>
                  <CodeBlock.Code code={originalPayloadCode} language="json" />
                </CodeBlock>
              </div>

              {activeDraft ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-foreground text-xs font-semibold">
                    Proposed Replacement Payload
                  </span>
                  <CodeBlock className="my-0 rounded-lg">
                    <CodeBlock.Header>
                      <span className="text-muted font-mono text-xs">Proposed JSON</span>
                      <CodeBlock.CopyButton code={proposedPayloadCode} />
                    </CodeBlock.Header>
                    <CodeBlock.Code code={proposedPayloadCode} language="json" />
                  </CodeBlock>
                </div>
              ) : null}
            </Drawer.Body>
            <Drawer.Footer>
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => setIsInspectOpen(false)}
              >
                Close
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );

  const renderPhaseTimeline = (scrollable: boolean) => {
    if (!activeTx) return null;

    const listEl = (
      <div
        aria-label="Transaction phase timeline"
        className={scrollable ? "flex gap-1.5 pb-0.5" : "grid grid-cols-5 gap-1.5"}
        role="list"
      >
        {PHASE_STEPS.map((step, idx) => {
          const isCompletedStep = idx < activePhaseIndex || activeTx.status === "complete";
          const isCurrentStep = idx === activePhaseIndex && activeTx.status !== "complete";
          const isHeldStep = isCurrentStep && activeTx.status === "held";
          const isDownstream = idx > activePhaseIndex && activeTx.status !== "complete";

          let stepSurface = "border border-border bg-surface-secondary/40 text-muted opacity-55";

          if (isHeldStep) {
            stepSurface = "border border-warning/50 bg-warning-soft text-foreground";
          } else if (isCurrentStep) {
            stepSurface = "border border-accent/60 bg-accent-soft text-foreground";
          } else if (isCompletedStep) {
            stepSurface = "border border-success/35 bg-success-soft text-foreground";
          }

          return (
            <div
              key={step.id}
              className={`flex flex-col justify-center gap-0.5 rounded-lg px-2.5 py-1.5 ${
                scrollable ? "min-w-[136px] shrink-0" : "min-w-0"
              } ${stepSurface}`}
              role="listitem"
            >
              <div className="flex items-center gap-1.5">
                {isHeldStep ? (
                  <CirclePause className="text-warning size-3.5 shrink-0" />
                ) : isCompletedStep ? (
                  <CircleCheck className="text-success size-3.5 shrink-0" />
                ) : null}
                <span className="truncate text-xs font-semibold">{step.label}</span>
              </div>
              <span
                className={`truncate font-mono text-[10px] ${
                  isHeldStep
                    ? "text-warning-soft-foreground font-medium"
                    : isDownstream
                      ? "text-muted"
                      : "text-muted"
                }`}
              >
                {isHeldStep
                  ? "HELD — Awaiting operator"
                  : isCompletedStep
                    ? "Verified"
                    : isCurrentStep
                      ? activeTx.status_detail || "In progress"
                      : "Pending"}
              </span>
            </div>
          );
        })}
      </div>
    );

    if (scrollable) {
      return (
        <ScrollShadow className="w-full overflow-x-auto" orientation="horizontal">
          {listEl}
        </ScrollShadow>
      );
    }

    return listEl;
  };

  const renderVerificationGates = () => (
    <div
      aria-label="Verification gates"
      className="border-separator bg-surface-secondary/40 grid shrink-0 grid-cols-1 gap-2 border-t px-3 py-2 sm:grid-cols-2"
      role="region"
    >
      <div className="border-border bg-surface flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
        <span className="text-foreground truncate text-xs font-medium">MCP schema</span>
        <Chip color={mcpSchemaValid ? "success" : "danger"} size="sm" variant="soft">
          {mcpSchemaValid ? "Valid" : "Invalid"}
        </Chip>
      </div>

      <div className="border-border bg-surface flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate text-xs font-medium">Seller policy</span>
          <span
            className={`truncate font-mono text-[10px] ${
              sellerPolicyState === "valid"
                ? "text-success"
                : sellerPolicyState === "rejected"
                  ? "text-danger"
                  : "text-warning-soft-foreground"
            }`}
          >
            {formatSellerPolicyLabel(sellerPolicyState)}
          </span>
        </div>
        <Button
          isDisabled={!activeDraft}
          isPending={actionBusy === "validate"}
          size="sm"
          variant="tertiary"
          onPress={() => void handleValidatePolicy()}
        >
          Validate Policy
        </Button>
      </div>

      <div className="border-border bg-surface flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5">
        <span className="text-foreground truncate text-xs font-medium">Operator approval</span>
        <Chip
          color={
            operatorApprovalState === "approved"
              ? "success"
              : operatorApprovalState === "rejected"
                ? "danger"
                : "warning"
          }
          size="sm"
          variant="soft"
        >
          {formatOperatorApprovalLabel(operatorApprovalState)}
        </Chip>
      </div>

      <div className="border-border bg-surface flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate text-xs font-medium">
            Payment authorization
          </span>
          <span
            className={`truncate font-mono text-[10px] ${
              paymentAuthState === "authorized" ? "text-success" : "text-muted"
            }`}
          >
            {paymentAuthState === "authorized" ? "Authorized" : "Unverified"}
          </span>
        </div>
        <Button
          isDisabled={!activeTx || paymentAuthState === "authorized"}
          isPending={actionBusy === "authorize"}
          size="sm"
          variant="secondary"
          onPress={() => void handleAuthorizePayment()}
        >
          Authorize Payment
        </Button>
      </div>
    </div>
  );

  const renderEmptySessionState = () => (
    <div className="flex h-full min-h-[340px] flex-1 items-center justify-center p-6">
      <EmptyState size="md">
        <EmptyState.Header>
          <EmptyState.Media variant="icon">
            <ShieldCheck />
          </EmptyState.Media>
          <EmptyState.Title>Waiting for Agent Traffic</EmptyState.Title>
          <EmptyState.Description>
            Start a live scenario or connect an AI agent to fingerprint sessions, counter outbound
            quotes against your margin floors, and issue checkout passes.
          </EmptyState.Description>
        </EmptyState.Header>
        <EmptyState.Content>
          <Button
            isPending={actionBusy === "scenario"}
            variant="primary"
            onPress={() => void handleRunScenario()}
          >
            <Play className="size-3.5" />
            Start Live Scenario
          </Button>
        </EmptyState.Content>
      </EmptyState>
    </div>
  );

  return (
    <div className={rootHeightClass} data-slot="commerce-interceptor">
      {isCompactViewport ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile Full-Width Control Plane Header */}
          <div className="border-separator flex flex-col gap-2.5 border-b p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h2 className="text-foreground truncate text-sm font-semibold">
                  {activeTx ? activeTx.title : "Agentic Commerce Control Plane"}
                </h2>
                <p className="text-muted truncate font-mono text-[11px]">
                  {activeTx
                    ? `Merchant: ${activeTx.seller_host} ← Buyer: ${activeTx.buyer_agent} · ${activeTx.protocol}`
                    : `${traffics.length} wire frames · ${activePasses.length} active passes`}
                </p>
              </div>

              <Button
                className="shrink-0"
                isPending={actionBusy === "scenario"}
                size="sm"
                variant="secondary"
                onPress={() => void handleRunScenario()}
              >
                <Play className="size-3" />
                Scenario
              </Button>
            </div>

            {workspaceState.transactions.length > 0 ? (
              <Dropdown>
                <Button
                  aria-label="Switch commerce session"
                  className="w-full justify-between gap-2 px-3"
                  size="sm"
                  variant="tertiary"
                >
                  <span className="truncate text-xs font-medium">
                    {activeTx
                      ? `Session: ${activeTx.short_title || activeTx.title}`
                      : "Select session"}
                  </span>
                  <span className="text-muted flex shrink-0 items-center gap-1 font-mono text-[11px]">
                    {activeTx ? formatPhaseSubStatus(activeTx) : ""}
                    <ChevronDown className="size-3.5" />
                  </span>
                </Button>
                <Dropdown.Popover className="w-[min(22rem,calc(100vw-1.5rem))]" placement="bottom start">
                  <Dropdown.Menu
                    disallowEmptySelection
                    aria-label="Commerce sessions"
                    selectedKeys={activeTx ? new Set([activeTx.tx_id]) : new Set()}
                    selectionMode="single"
                    onSelectionChange={handleSessionSelectionChange}
                  >
                    {workspaceState.transactions.map((tx) => (
                      <Dropdown.Item
                        key={tx.tx_id}
                        id={tx.tx_id}
                        textValue={tx.short_title || tx.title}
                      >
                        <Label className="min-w-0 flex-1 truncate text-xs font-medium">
                          {tx.title}
                        </Label>
                        <span className="text-muted shrink-0 font-mono text-[11px]">
                          {formatPhaseSubStatus(tx)}
                        </span>
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            ) : null}

            <Segment
              aria-label="Investigation view"
              className="w-full"
              selectedKey={mobileViewMode}
              size="sm"
              onSelectionChange={(key) => setViewMode(String(key) as InvestigationViewMode)}
            >
              <Segment.Item className="flex-1 text-xs" id="both">
                Overview
              </Segment.Item>
              <Segment.Item className="flex-1 text-xs" id="approve">
                {streamStats.heldCount > 0 ? `Approve (${streamStats.heldCount})` : "Approve"}
              </Segment.Item>
              <Segment.Item className="flex-1 text-xs" id="wire">
                Wire
              </Segment.Item>
              <Segment.Item className="flex-1 text-xs" id="orders">
                Passes
              </Segment.Item>
            </Segment>

            {activeTx && (mobileViewMode === "both" || mobileViewMode === "approve")
              ? renderPhaseTimeline(true)
              : null}
          </div>

          {/* Mobile Active Surface Body */}
          {mobileViewMode === "wire" ? (
            <WireEvidencePanel
              selectedPacketId={selectedWirePacketId}
              onSelectPacketId={setSelectedWirePacketId}
            />
          ) : mobileViewMode === "orders" ? (
            <PassesLedgerPanel activeBuyerAgent={activeTx?.buyer_agent ?? null} />
          ) : !activeTx ? (
            renderEmptySessionState()
          ) : mobileViewMode === "approve" ? (
            <div className="flex flex-col">
              <div className="flex flex-col gap-3.5 p-3">
                {/* Catalog Offer */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Catalog Offer</span>
                  {primaryOffer ? (
                    <div className="border-border bg-surface-secondary/50 flex flex-col gap-1.5 rounded-lg border p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-foreground truncate text-xs font-semibold">
                          {primaryOffer.sku_title}
                        </span>
                        <span className="text-foreground shrink-0 font-mono text-sm font-semibold tabular-nums">
                          {formatMoneyExact(primaryOffer.price_cents, primaryOffer.currency)}
                        </span>
                      </div>
                      <span className="text-muted font-mono text-[11px]">
                        {`${primaryOffer.in_stock ? "In stock" : "Backorder"} · ${primaryOffer.warranty || "Standard warranty"}`}
                      </span>
                      {promoOffer && promoOffer.offer_id !== primaryOffer.offer_id ? (
                        <span className="text-warning-soft-foreground font-mono text-[11px] tabular-nums">
                          {`Staged promo: ${formatMoneyExact(promoOffer.price_cents, promoOffer.currency)}`}
                        </span>
                      ) : null}
                      {primaryOffer.returns_policy ? (
                        <span className="text-muted text-[11px]">{primaryOffer.returns_policy}</span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-muted text-xs">No catalog offers recorded.</p>
                  )}
                </div>

                {/* Direction & Parties */}
                <div className="flex flex-col gap-2">
                  <span className="text-muted text-xs font-semibold">Interception Direction</span>
                  <Segment
                    aria-label="Interception direction"
                    className="w-full"
                    isDisabled={!activeTx}
                    selectedKey={effectiveLane}
                    size="sm"
                    onSelectionChange={(key) =>
                      void handleLaneChange(String(key) as InterceptionDirection)
                    }
                  >
                    <Segment.Item className="flex-1 text-xs" id="buyer_to_seller">
                      Buyer → Seller
                    </Segment.Item>
                    <Segment.Item className="flex-1 text-xs" id="seller_to_buyer">
                      Seller → Buyer
                    </Segment.Item>
                  </Segment>

                  <div className="border-border bg-surface-secondary/50 flex flex-col gap-1 rounded-lg border px-3 py-2 font-mono text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Source</span>
                      <span className="text-foreground truncate font-medium">{sourceParty}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Recipient</span>
                      <span className="text-foreground truncate font-medium">{recipientParty}</span>
                    </div>
                  </div>
                </div>

                {/* Held / Selected Original Packet + Inspect Payload Drawer */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted text-xs font-semibold">Original</span>
                    {renderInspectDrawer()}
                  </div>
                  <div className="border-border bg-surface-secondary/40 rounded-lg border px-3 py-2 text-xs">
                    {inspectOriginalEvent ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-foreground font-mono font-semibold">
                          {`${inspectOriginalEvent.event_id} · ${inspectOriginalEvent.event_name}`}
                        </span>
                        <span className="text-muted text-[11px]">
                          {inspectOriginalEvent.observation}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">No held packet selected.</span>
                    )}
                  </div>
                </div>

                {/* Proposed Replacement Switch */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Proposed Replacement</span>
                  <div
                    className={`flex flex-col gap-1.5 rounded-lg p-3 ${
                      activeDraft?.enabled
                        ? "border border-warning/50 bg-warning-soft"
                        : "border border-border bg-surface-secondary/40"
                    }`}
                  >
                    <Switch
                      isDisabled={!activeDraft || activeDraft.delivery_state !== "proposed"}
                      isSelected={Boolean(activeDraft?.enabled)}
                      size="sm"
                      onChange={(enabled) => void handleToggleDraft(enabled)}
                    >
                      <Switch.Content className="font-mono text-xs font-medium">
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        {promoSwitchText}
                      </Switch.Content>
                    </Switch>
                    {activeDraft?.result_preview ? (
                      <span className="text-muted text-[11px] leading-snug">
                        {activeDraft.result_preview}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Primary Quote Decision Actions */}
                <div className="flex flex-col gap-2 pt-0.5">
                  <Button
                    fullWidth
                    isDisabled={!canReleaseIntercept}
                    isPending={actionBusy === "release-replacement"}
                    size="sm"
                    variant="primary"
                    onPress={() => void handleRelease("replacement")}
                  >
                    Review & Send Response
                  </Button>
                  <Button
                    fullWidth
                    isDisabled={!canReleaseIntercept}
                    isPending={actionBusy === "release-original"}
                    size="sm"
                    variant="tertiary"
                    onPress={() => void handleRelease("original")}
                  >
                    Forward Original
                  </Button>
                </div>
              </div>

              {renderVerificationGates()}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex flex-col gap-3 p-3">
                {canReleaseIntercept && heldTargetEvent ? (
                  <div className="border-warning/50 bg-warning-soft flex flex-wrap items-center justify-between gap-2.5 rounded-lg border px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-foreground font-mono text-xs font-semibold">
                        {`${heldTargetEvent.event_id} · ${heldTargetEvent.event_name} held`}
                      </span>
                      <span className="text-muted text-[11px] leading-snug">
                        {promoOffer
                          ? `Counter-offer ${promoOffer.offer_id} (${formatMoneyCompact(promoOffer.price_cents, promoOffer.currency)}) staged against margin floor.`
                          : heldTargetEvent.observation}
                      </span>
                    </div>
                    <Button
                      className="shrink-0"
                      size="sm"
                      variant="primary"
                      onPress={() => setViewMode("approve")}
                    >
                      Review Quote
                    </Button>
                  </div>
                ) : null}

                <CausalCradledGraph
                  draft={activeDraft}
                  events={txEvents}
                  offers={txOffers}
                  selectedEventId={effectiveSelectedEventId}
                  onSelectEvent={setSelectedEventId}
                />

                {selectedEvent ? (
                  <div className="border-border bg-surface-secondary/50 flex flex-col gap-1 rounded-lg border px-3 py-2">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-foreground truncate font-mono text-xs font-semibold">
                        {`${selectedEvent.event_id} · ${selectedEvent.event_name}`}
                      </span>
                      <span className="text-muted shrink-0 font-mono text-[11px] tabular-nums">
                        {selectedEvent.correlation_id}
                      </span>
                    </div>
                    <span className="text-muted text-xs leading-snug">
                      {selectedEvent.observation}
                    </span>
                  </div>
                ) : null}

                <Card className="overflow-x-auto p-0">
                  <DataGrid
                    stickyHeader
                    aria-label="Execution trace"
                    className={`w-full [&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)] ${
                      selectedEventIsHeld
                        ? "[&_.table__row[data-selected=true]_.table__cell]:bg-warning-soft [&_.table__row[data-selected=true]_.table__cell]:text-foreground"
                        : "[&_.table__row[data-selected=true]_.table__cell]:bg-accent-soft [&_.table__row[data-selected=true]_.table__cell]:text-foreground"
                    }`}
                    columns={traceColumns}
                    contentClassName="min-w-[660px]"
                    data={filteredTraceEvents}
                    getRowId={(item) => item.event_id}
                    renderEmptyState={() => (
                      <div className="py-6">
                        <EmptyState size="sm">
                          <EmptyState.Header>
                            <EmptyState.Title>No Matching Events</EmptyState.Title>
                            <EmptyState.Description>
                              No recorded events match the active trace filter.
                            </EmptyState.Description>
                          </EmptyState.Header>
                        </EmptyState>
                      </div>
                    )}
                    selectedKeys={selectedTraceKeys}
                    selectionBehavior="replace"
                    selectionMode="single"
                    variant="secondary"
                    onRowAction={(key) => setSelectedEventId(String(key))}
                    onSelectionChange={handleTraceSelectionChange}
                  />
                </Card>
              </div>

              {renderVerificationGates()}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Resizable orientation="horizontal">
            {/* 1. LEFT COLUMN: Live Sessions + Surfaces + Trace Filters */}
            <Resizable.Panel className="border-separator flex min-w-0 flex-col border-r" defaultSize={17} minSize={13}>
              <div className="border-separator flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
                <span className="text-foreground text-xs font-semibold">Live Sessions</span>
                <Button
                  isPending={actionBusy === "scenario"}
                  size="sm"
                  variant="secondary"
                  onPress={() => void handleRunScenario()}
                >
                  <Play className="size-3" />
                  {workspaceState.transactions.length > 0 ? "Reset" : "Start Scenario"}
                </Button>
              </div>

              <ScrollShadow className="min-h-0 flex-1 overflow-y-auto p-2">
                <div className="flex flex-col gap-4">
                  {workspaceState.transactions.length === 0 ? (
                    <p className="text-muted px-2 py-3 text-xs leading-relaxed">
                      No active sessions. Start a live scenario or route an AI agent through Conduit to package and price offers.
                    </p>
                  ) : (
                    <ListBox
                      disallowEmptySelection
                      aria-label="Commerce sessions"
                      className="gap-1 p-0"
                      selectedKeys={activeTx ? new Set([activeTx.tx_id]) : new Set()}
                      selectionMode="single"
                      onSelectionChange={handleSessionSelectionChange}
                    >
                      {workspaceState.transactions.map((tx) => {
                        const isHeldTx = tx.status === "held";
                        const isSelectedTx = activeTx?.tx_id === tx.tx_id;
                        const subLabel = formatPhaseSubStatus(tx);

                        let itemSurface = "border border-transparent hover:bg-surface-secondary/70";

                        if (isHeldTx) {
                          itemSurface = "border border-warning/50 bg-warning-soft";
                        } else if (isSelectedTx) {
                          itemSurface = "border border-border-secondary bg-surface-secondary";
                        }

                        return (
                          <ListBox.Item
                            key={tx.tx_id}
                            className={`flex flex-col items-start gap-1 rounded-lg px-2.5 py-2 normal-case ${itemSurface}`}
                            id={tx.tx_id}
                            textValue={tx.short_title || tx.title}
                          >
                            <div className="flex w-full items-center justify-between gap-1.5">
                              <Label className="text-foreground truncate text-xs font-semibold normal-case">
                                {tx.short_title || tx.title}
                              </Label>
                              <span className="text-muted shrink-0 font-mono text-[11px] tabular-nums">
                                {tx.category_label}
                              </span>
                            </div>
                            <span
                              className={`truncate font-mono text-[11px] ${
                                isHeldTx
                                  ? "text-warning-soft-foreground font-medium"
                                  : tx.status === "complete"
                                    ? "text-success"
                                    : "text-muted"
                              }`}
                            >
                              {subLabel}
                            </span>
                          </ListBox.Item>
                        );
                      })}
                    </ListBox>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted px-2 text-xs font-semibold">Surfaces</span>
                    <ListBox
                      disallowEmptySelection
                      aria-label="Investigation surfaces"
                      className="gap-0.5 p-0"
                      selectedKeys={new Set([desktopViewMode === "graph" ? "both" : desktopViewMode])}
                      selectionMode="single"
                      onSelectionChange={(keys) => {
                        if (keys === "all") return;
                        const first = Array.from(keys)[0];

                        if (typeof first === "string") {
                          setViewMode(first as InvestigationViewMode);
                        }
                      }}
                    >
                      {(
                        [
                          {count: txEvents.length, id: "both", label: "Deal Control"},
                          {count: traffics.length, id: "wire", label: "Wire Frames"},
                          {count: passes.length, id: "orders", label: "Passes & Bundles"},
                        ] as const
                      ).map((surfaceItem) => (
                        <ListBox.Item
                          key={surfaceItem.id}
                          className="items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 normal-case data-[selected=true]:bg-surface-secondary"
                          id={surfaceItem.id}
                          textValue={surfaceItem.label}
                        >
                          <Label className="text-foreground text-xs font-medium normal-case">
                            {surfaceItem.label}
                          </Label>
                          <span className="text-muted font-mono text-xs tabular-nums">
                            {surfaceItem.count}
                          </span>
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted px-2 text-xs font-semibold">Trace Filters</span>
                    <ListBox
                      disallowEmptySelection
                      aria-label="Trace filters"
                      className="gap-0.5 p-0"
                      selectedKeys={new Set([eventFilter])}
                      selectionMode="single"
                      onSelectionChange={handleFilterSelectionChange}
                    >
                      {(
                        [
                          {count: filterCounts.all, id: "all", label: "All"},
                          {count: filterCounts.mcp, id: "mcp", label: "MCP"},
                          {count: filterCounts.http, id: "http", label: "HTTP"},
                          {count: filterCounts.held_pending, id: "held_pending", label: "Held / Pending"},
                          {count: filterCounts.errors, id: "errors", label: "Errors"},
                        ] as const
                      ).map((filterItem) => (
                        <ListBox.Item
                          key={filterItem.id}
                          className="items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 normal-case data-[selected=true]:bg-surface-secondary"
                          id={filterItem.id}
                          textValue={filterItem.label}
                        >
                          <Label className="text-foreground text-xs font-medium normal-case">
                            {filterItem.label}
                          </Label>
                          <span className="text-muted font-mono text-xs tabular-nums">
                            {filterItem.count}
                          </span>
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </div>
                </div>
              </ScrollShadow>
            </Resizable.Panel>

            <Resizable.Handle aria-label="Resize sessions column" variant="secondary" />

            {/* 2. CENTER COLUMN: Control Plane Stage (Overview / Graph / Wire / Passes) */}
            <Resizable.Panel className="border-separator flex min-w-0 flex-col border-r" defaultSize={49} minSize={34}>
              <div className="border-separator flex shrink-0 flex-col gap-2.5 border-b px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 className="text-foreground truncate text-sm font-semibold">
                      {activeTx ? activeTx.title : "Agentic Commerce Control Plane"}
                    </h2>
                    <p className="text-muted truncate font-mono text-xs">
                      {activeTx
                        ? `Merchant: ${activeTx.seller_host} ← Buyer: ${activeTx.buyer_agent} · ${activeTx.protocol}`
                        : `${traffics.length} wire frames · ${activePasses.length} active passes`}
                    </p>
                  </div>

                  <Segment
                    aria-label="Investigation view"
                    className="shrink-0"
                    selectedKey={desktopViewMode}
                    size="sm"
                    onSelectionChange={(key) => setViewMode(String(key) as InvestigationViewMode)}
                  >
                    <Segment.Item id="both">Overview</Segment.Item>
                    <Segment.Item id="graph">Graph</Segment.Item>
                    <Segment.Item id="wire">Wire</Segment.Item>
                    <Segment.Item id="orders">Passes</Segment.Item>
                  </Segment>
                </div>

                {activeTx && (desktopViewMode === "both" || desktopViewMode === "graph")
                  ? renderPhaseTimeline(false)
                  : null}
              </div>

              {desktopViewMode === "wire" ? (
                <WireEvidencePanel
                  selectedPacketId={selectedWirePacketId}
                  onSelectPacketId={setSelectedWirePacketId}
                />
              ) : desktopViewMode === "orders" ? (
                <PassesLedgerPanel activeBuyerAgent={activeTx?.buyer_agent ?? null} />
              ) : !activeTx ? (
                renderEmptySessionState()
              ) : (
                <>
                  <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                    <CausalCradledGraph
                      draft={activeDraft}
                      events={txEvents}
                      offers={txOffers}
                      selectedEventId={effectiveSelectedEventId}
                      onSelectEvent={setSelectedEventId}
                    />

                    {desktopViewMode === "both" ? (
                      <Card className="min-h-[210px] shrink-0 overflow-hidden p-0">
                        <DataGrid
                          stickyHeader
                          aria-label="Execution trace"
                          className={`w-full [&_.table__column]:rounded-none! [&_.table__row]:cursor-[var(--cursor-interactive)] ${
                            selectedEventIsHeld
                              ? "[&_.table__row[data-selected=true]_.table__cell]:bg-warning-soft [&_.table__row[data-selected=true]_.table__cell]:text-foreground"
                              : "[&_.table__row[data-selected=true]_.table__cell]:bg-accent-soft [&_.table__row[data-selected=true]_.table__cell]:text-foreground"
                          }`}
                          columns={traceColumns}
                          contentClassName="min-w-[660px]"
                          data={filteredTraceEvents}
                          getRowId={(item) => item.event_id}
                          renderEmptyState={() => (
                            <div className="py-6">
                              <EmptyState size="sm">
                                <EmptyState.Header>
                                  <EmptyState.Title>No Matching Events</EmptyState.Title>
                                  <EmptyState.Description>
                                    Select another filter in the left rail to view recorded events.
                                  </EmptyState.Description>
                                </EmptyState.Header>
                              </EmptyState>
                            </div>
                          )}
                          selectedKeys={selectedTraceKeys}
                          selectionBehavior="replace"
                          selectionMode="single"
                          variant="secondary"
                          onRowAction={(key) => setSelectedEventId(String(key))}
                          onSelectionChange={handleTraceSelectionChange}
                        />
                      </Card>
                    ) : null}
                  </ScrollShadow>

                  {renderVerificationGates()}
                </>
              )}
            </Resizable.Panel>

            <Resizable.Handle aria-label="Resize seller context column" variant="secondary" />

            {/* 3. MIDDLE-RIGHT COLUMN: Merchant Desk */}
            <Resizable.Panel className="border-separator flex min-w-0 flex-col border-r" defaultSize={16} minSize={13}>
              <div className="border-separator flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
                <span className="text-foreground truncate text-xs font-semibold">
                  {activeTx ? `Merchant (${activeTx.seller_host})` : "Merchant"}
                </span>
              </div>

              <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3">
                {/* Catalog Offer */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Catalog Offer</span>
                  {primaryOffer ? (
                    <div className="border-border bg-surface-secondary/50 flex flex-col gap-1.5 rounded-lg border p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-foreground truncate text-xs font-semibold">
                          {primaryOffer.sku_title}
                        </span>
                        <span className="text-foreground shrink-0 font-mono text-sm font-semibold tabular-nums">
                          {formatMoneyExact(primaryOffer.price_cents, primaryOffer.currency)}
                        </span>
                      </div>
                      <span className="text-muted font-mono text-[11px]">
                        {`${primaryOffer.in_stock ? "In stock" : "Backorder"} · ${primaryOffer.warranty || "Standard warranty"}`}
                      </span>
                      {promoOffer && promoOffer.offer_id !== primaryOffer.offer_id ? (
                        <span className="text-warning-soft-foreground font-mono text-[11px] tabular-nums">
                          {`Staged promo: ${formatMoneyExact(promoOffer.price_cents, promoOffer.currency)}`}
                        </span>
                      ) : null}
                      {primaryOffer.returns_policy ? (
                        <span className="text-muted text-[11px]">{primaryOffer.returns_policy}</span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-muted text-xs">No catalog offers recorded.</p>
                  )}
                </div>

                {/* Session Passes Summary */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted text-xs font-semibold">Session Passes</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => setViewMode("orders")}
                    >
                      Manage
                    </Button>
                  </div>
                  <div className="border-border bg-surface-secondary/50 flex flex-col gap-1 rounded-lg border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-foreground font-mono text-xs font-medium tabular-nums">
                        {`${activePasses.length} active`}
                      </span>
                      <span className="text-muted font-mono text-[11px] tabular-nums">
                        {`${bundles.length} bundles`}
                      </span>
                    </div>
                    {buyerPasses[0] ? (
                      <span className="text-muted truncate font-mono text-[11px] tabular-nums">
                        {`${buyerPasses[0].subject} · ${buyerPasses[0].remaining_calls}/${buyerPasses[0].max_calls} calls`}
                      </span>
                    ) : (
                      <span className="text-muted text-[11px]">
                        Authorize payment or issue a buyer pass.
                      </span>
                    )}
                  </div>
                </div>

                {/* Outbound MCP Responses */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Outbound MCP Responses</span>
                  {sellerResponses.length === 0 ? (
                    <p className="text-muted text-xs">No responses recorded.</p>
                  ) : (
                    <ListBox
                      disallowEmptySelection
                      aria-label="Seller MCP responses"
                      className="gap-1 p-0"
                      selectedKeys={
                        effectiveSelectedEventId &&
                        sellerResponses.some((ev) => ev.event_id === effectiveSelectedEventId)
                          ? new Set([effectiveSelectedEventId])
                          : new Set()
                      }
                      selectionMode="single"
                      onSelectionChange={handleTraceSelectionChange}
                    >
                      {sellerResponses.map((ev) => {
                        const isHeld = ev.hold_state === "held" || ev.epistemic_kind === "held";
                        const isSelected = effectiveSelectedEventId === ev.event_id;
                        const statusReadout = isHeld
                          ? `HELD · ${formatHoldDurationSec(ev.hold_ms, extraHoldElapsedMs)}`
                          : ev.epistemic_kind === "pending"
                            ? "PENDING"
                            : String(ev.status_code ?? (ev.status_label || "200"));

                        let rowClass = "border border-border bg-surface hover:bg-surface-hover";

                        if (isHeld) {
                          rowClass = "border border-warning/50 bg-warning-soft";
                        } else if (isSelected) {
                          rowClass = "border border-accent bg-accent-soft";
                        }

                        return (
                          <ListBox.Item
                            key={ev.event_id}
                            className={`flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 normal-case ${rowClass}`}
                            id={ev.event_id}
                            textValue={`${ev.event_id} ${ev.event_name}`}
                          >
                            <div className="flex w-full items-center justify-between gap-1.5">
                              <Label className="text-foreground truncate font-mono text-xs font-semibold normal-case">
                                {`${ev.event_id} · ${ev.event_name}`}
                              </Label>
                              <span
                                className={`shrink-0 font-mono text-[10px] font-medium tabular-nums ${
                                  isHeld
                                    ? "text-warning-soft-foreground"
                                    : ev.epistemic_kind === "pending"
                                      ? "text-muted"
                                      : "text-success"
                                }`}
                              >
                                {statusReadout}
                              </span>
                            </div>
                            <span className="text-muted w-full truncate text-[11px]">
                              {ev.observation}
                            </span>
                          </ListBox.Item>
                        );
                      })}
                    </ListBox>
                  )}
                </div>

                {/* Selected Event Summary */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Selected Event</span>
                  {selectedEvent ? (
                    <div className="border-border bg-surface-secondary/50 flex flex-col gap-1 rounded-lg border p-2.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-foreground truncate font-mono text-xs font-semibold">
                          {`${selectedEvent.event_id} · ${selectedEvent.event_name}`}
                        </span>
                        <span className="text-muted shrink-0 font-mono text-[11px] tabular-nums">
                          {selectedEvent.correlation_id}
                        </span>
                      </div>
                      <span className="text-muted text-xs leading-snug">
                        {selectedEvent.observation}
                      </span>
                    </div>
                  ) : (
                    <p className="text-muted text-xs">Select any graph node or trace row.</p>
                  )}
                </div>
              </ScrollShadow>
            </Resizable.Panel>

            <Resizable.Handle aria-label="Resize intervention column" variant="secondary" />

            {/* 4. FAR-RIGHT COLUMN: Quote Approval & Intervention */}
            <Resizable.Panel className="flex min-w-0 flex-col" defaultSize={18} minSize={15}>
              <div className="border-separator flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                <span className="text-foreground text-xs font-semibold">Quote Approval</span>
                {renderInspectDrawer()}
              </div>

              <ScrollShadow className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3">
                {/* Inline Multidirectional Segment Toggle */}
                <div className="flex flex-col gap-2">
                  <Segment
                    aria-label="Interception direction"
                    className="w-full"
                    isDisabled={!activeTx}
                    selectedKey={effectiveLane}
                    size="sm"
                    onSelectionChange={(key) =>
                      void handleLaneChange(String(key) as InterceptionDirection)
                    }
                  >
                    <Segment.Item className="flex-1 text-xs" id="buyer_to_seller">
                      Buyer → Seller
                    </Segment.Item>
                    <Segment.Item className="flex-1 text-xs" id="seller_to_buyer">
                      Seller → Buyer
                    </Segment.Item>
                  </Segment>

                  <div className="border-border bg-surface-secondary/50 flex flex-col gap-1 rounded-lg border px-2.5 py-2 font-mono text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Source</span>
                      <span className="text-foreground truncate font-medium">{sourceParty}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Recipient</span>
                      <span className="text-foreground truncate font-medium">{recipientParty}</span>
                    </div>
                  </div>
                </div>

                {/* Original Summary */}
                <div className="flex flex-col gap-1">
                  <span className="text-muted text-xs font-semibold">Original</span>
                  <div className="border-border bg-surface-secondary/40 rounded-lg border px-2.5 py-2 text-xs">
                    {inspectOriginalEvent ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-foreground font-mono font-semibold">
                          {`${inspectOriginalEvent.event_id} · ${inspectOriginalEvent.event_name}`}
                        </span>
                        <span className="text-muted text-[11px]">
                          {inspectOriginalEvent.observation}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">No held packet selected.</span>
                    )}
                  </div>
                </div>

                {/* Proposed Replacement Switch (HeroUI v3 dot-notation) */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Proposed Replacement</span>
                  <div
                    className={`flex flex-col gap-1.5 rounded-lg p-2.5 ${
                      activeDraft?.enabled
                        ? "border border-warning/50 bg-warning-soft"
                        : "border border-border bg-surface-secondary/40"
                    }`}
                  >
                    <Switch
                      isDisabled={!activeDraft || activeDraft.delivery_state !== "proposed"}
                      isSelected={Boolean(activeDraft?.enabled)}
                      size="sm"
                      onChange={(enabled) => void handleToggleDraft(enabled)}
                    >
                      <Switch.Content className="font-mono text-xs font-medium">
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        {promoSwitchText}
                      </Switch.Content>
                    </Switch>
                    {activeDraft?.result_preview ? (
                      <span className="text-muted text-[11px] leading-snug">
                        {activeDraft.result_preview}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Split-State Validation Rows */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted text-xs font-semibold">Validation</span>
                  <div className="border-border bg-surface-secondary/40 flex flex-col gap-1.5 rounded-lg border px-2.5 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">MCP schema</span>
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          mcpSchemaValid ? "text-success" : "text-danger"
                        }`}
                      >
                        {mcpSchemaValid ? "Valid" : "Invalid"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Seller policy</span>
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          sellerPolicyState === "valid"
                            ? "text-success"
                            : sellerPolicyState === "rejected"
                              ? "text-danger"
                              : "text-warning-soft-foreground"
                        }`}
                      >
                        {formatSellerPolicyLabel(sellerPolicyState)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Operator approval</span>
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          operatorApprovalState === "approved"
                            ? "text-success"
                            : "text-warning-soft-foreground"
                        }`}
                      >
                        {formatOperatorApprovalLabel(operatorApprovalState)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted">Payment pass</span>
                      <span
                        className={`font-mono text-[11px] font-medium ${
                          paymentAuthState === "authorized" ? "text-success" : "text-muted"
                        }`}
                      >
                        {paymentAuthState === "authorized" ? "Authorized" : "Unverified"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Primary Action Stack */}
                <div className="mt-auto flex flex-col gap-2 pt-1">
                  <Button
                    fullWidth
                    isDisabled={!canReleaseIntercept}
                    isPending={actionBusy === "release-replacement"}
                    size="sm"
                    variant="primary"
                    onPress={() => void handleRelease("replacement")}
                  >
                    Review & Send Response
                  </Button>
                  <Button
                    fullWidth
                    isDisabled={!canReleaseIntercept}
                    isPending={actionBusy === "release-original"}
                    size="sm"
                    variant="tertiary"
                    onPress={() => void handleRelease("original")}
                  >
                    Forward Original
                  </Button>
                </div>
              </ScrollShadow>
            </Resizable.Panel>
          </Resizable>
        </div>
      )}

      {/* Compact Dual-Speed Live Stream Bar (div role="region", zero <footer> tag) */}
      <div
        aria-label="Live packet stream bar"
        className="border-separator bg-background-secondary flex shrink-0 flex-col border-t"
        role="region"
      >
        <div className="flex h-9 items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Pulse
              aria-hidden="true"
              className={`size-3.5 shrink-0 ${
                streamStats.heldCount > 0 ? "text-warning" : "text-accent"
              }`}
            />
            <span className="text-foreground truncate font-mono text-[11px] font-medium tabular-nums sm:text-xs">
              {`${streamStats.totalEvents} events · ${streamStats.heldCount} held · ${streamStats.avgMs} ms avg`}
            </span>
            {streamPackets[0] ? (
              <span className="text-muted hidden truncate font-mono text-xs lg:inline">
                {`${streamPackets[0].arrow} ${streamPackets[0].protocol} ${streamPackets[0].name} (${streamPackets[0].statusLabel})`}
              </span>
            ) : null}
          </div>

          <Button
            className="shrink-0"
            size="sm"
            variant="ghost"
            onPress={() => setStreamExpanded((prev) => !prev)}
          >
            {streamExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
            {streamExpanded ? "Collapse Stream" : "Expand Stream"}
          </Button>
        </div>

        {streamExpanded ? (
          <ScrollShadow className="border-separator max-h-36 overflow-y-auto border-t px-3 py-1.5">
            {streamPackets.length === 0 ? (
              <p className="text-muted py-2 font-mono text-xs">0 live packets recorded.</p>
            ) : (
              <ListBox
                aria-label="Live packet tail"
                className="gap-0.5 p-0"
                selectionMode="single"
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const key = Array.from(keys)[0];

                  if (typeof key !== "string") return;
                  const match = streamPackets.find((item) => item.id === key);

                  if (match?.txId && match.eventId) {
                    setSelectedTxId(match.txId);
                    setSelectedEventId(match.eventId);
                    setViewMode((prev) => (prev === "wire" || prev === "orders" ? "both" : prev));
                  } else if (match?.id.startsWith("pkt-")) {
                    const parsedId = Number(match.id.slice(4));

                    if (Number.isFinite(parsedId)) {
                      setSelectedWirePacketId(parsedId);
                      setViewMode("wire");
                    }
                  }
                }}
              >
                {streamPackets.map((pkt) => (
                  <ListBox.Item
                    key={pkt.id}
                    className="items-center justify-between gap-3 rounded-md px-2 py-1 normal-case"
                    id={pkt.id}
                    textValue={`${pkt.arrow} ${pkt.protocol} ${pkt.name}`}
                  >
                    <Label className="text-foreground min-w-0 flex-1 truncate font-mono text-xs font-normal normal-case">
                      {`${pkt.arrow} ${pkt.protocol} ${pkt.name} — ${pkt.observation}`}
                    </Label>
                    <span
                      className={`shrink-0 font-mono text-[11px] tabular-nums ${
                        pkt.isHeld ? "text-warning-soft-foreground font-semibold" : "text-muted"
                      }`}
                    >
                      {`${pkt.statusLabel} · ${pkt.latencyText}`}
                    </span>
                  </ListBox.Item>
                ))}
              </ListBox>
            )}
          </ScrollShadow>
        ) : null}
      </div>
    </div>
  );
}
