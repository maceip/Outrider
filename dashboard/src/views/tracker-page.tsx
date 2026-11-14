"use client";

import type {
  AgentSession,
  FingerprintObservation,
  McpFrame,
  ProbeRun,
  ProxyTrafficRow,
} from "../lib/types";
import type {DataGridColumn, DataGridSelection} from "@heroui-pro/react";
import type {
  CSSProperties,
  Key,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import {ArrowsRotateLeft, CircleCheck, Code, Copy, Funnel} from "@gravity-ui/icons";
import {Button, Chip, Dropdown, Label, SearchField} from "@heroui/react";
import {DataGrid, KPIGroup, Segment} from "@heroui-pro/react";
import {KPI} from "@heroui-pro/react/kpi";
import {Fragment, useCallback, useMemo, useRef, useState} from "react";

import {IconButton} from "../components/icon-button";
import {useOutrider} from "../lib/outrider-store";

const SESSION_STATES = ["Unprobed", "Probed", "CLEF Evaluated", "Entitled"] as const;

const STANDARD_OBSERVATION_KINDS = [
  "client_hello",
  "negotiated_tls",
  "http_header_order",
  "mcp_request",
] as const;

type EvidenceSegment = "sessions" | "observations" | "probes" | "frames" | "traffic";

interface FilterOption {
  id: string;
  label: string;
}

interface InspectedEvidenceItem {
  rowKey: string;
  id: string;
  label: string;
  sessionId: string | null;
  record: unknown;
  websocketMessages?: unknown[];
}

const DEFAULT_INSPECTOR_WIDTH = 400;
const MIN_INSPECTOR_WIDTH = 300;
const MAX_INSPECTOR_WIDTH = 600;

function formatUtcTimestamp(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "—";

  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function summarizeObservationEvidence(evidence: unknown): string {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return typeof evidence === "string" ? evidence : "—";
  }
  const keys = Object.keys(evidence as Record<string, unknown>);

  return keys.length > 0 ? keys.slice(0, 4).join(", ") : "{}";
}

function sessionStateColor(
  state: string,
): "success" | "accent" | "warning" | "default" {
  if (state === "Entitled") return "success";
  if (state === "CLEF Evaluated") return "accent";
  if (state === "Probed") return "warning";

  return "default";
}

export function TrackerPage() {
  const {
    busy,
    clefStatus,
    mutate,
    openDialog,
    publicStatus,
    refresh,
    selectedSession,
    selectedSessionId,
    setSelectedEvidence,
    setSelectedSessionId,
    snapshot,
    unlocked,
  } = useOutrider();

  const [segment, setSegment] = useState<EvidenceSegment>("sessions");
  const [search, setSearch] = useState("");
  const [filterKey, setFilterKey] = useState("all");
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const allSessions = useMemo(() => snapshot?.agent_sessions ?? [], [snapshot?.agent_sessions]);
  const allObservations = useMemo(
    () => snapshot?.fingerprint_observations ?? [],
    [snapshot?.fingerprint_observations],
  );
  const allProbes = useMemo(() => snapshot?.probe_runs ?? [], [snapshot?.probe_runs]);
  const allFrames = useMemo(() => snapshot?.mcp_frames ?? [], [snapshot?.mcp_frames]);
  const allTraffic = useMemo(() => snapshot?.proxy_traffic ?? [], [snapshot?.proxy_traffic]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {
      "CLEF Evaluated": 0,
      Entitled: 0,
      Probed: 0,
      Unprobed: 0,
    };

    for (const s of allSessions) {
      map[s.state] = (map[s.state] ?? 0) + 1;
    }

    return map;
  }, [allSessions]);

  // Dynamic real filter options per segment
  const filterOptions = useMemo<FilterOption[]>(() => {
    if (segment === "sessions") {
      return [
        {id: "all", label: "All states"},
        ...SESSION_STATES.map((st) => ({id: st, label: st})),
      ];
    }

    if (segment === "observations") {
      const seen = new Set<string>(STANDARD_OBSERVATION_KINDS);

      for (const obs of allObservations) {
        if (obs.kind) seen.add(obs.kind);
      }
      const base: FilterOption[] = [{id: "all", label: "All kinds"}];

      if (selectedSessionId) {
        base.push({id: "__session__", label: "Selected session"});
      }
      for (const kind of seen) {
        base.push({id: kind, label: kind});
      }

      return base;
    }

    if (segment === "probes") {
      const seen = new Set<string>(["Completed", "Failed"]);

      for (const probe of allProbes) {
        if (probe.status) seen.add(probe.status);
      }
      const base: FilterOption[] = [{id: "all", label: "All statuses"}];

      if (selectedSessionId) {
        base.push({id: "__session__", label: "Selected session"});
      }
      for (const st of seen) {
        base.push({id: st, label: st});
      }

      return base;
    }

    if (segment === "frames") {
      const seen = new Set<string>(["request", "response", "error"]);

      for (const frame of allFrames) {
        if (frame.direction) seen.add(frame.direction);
      }
      const base: FilterOption[] = [{id: "all", label: "All directions"}];

      if (selectedSessionId) {
        base.push({id: "__session__", label: "Selected session"});
      }
      for (const dir of seen) {
        base.push({id: dir, label: dir});
      }

      return base;
    }

    return [
      {id: "all", label: "All traffic"},
      {id: "2xx", label: "HTTP 2xx"},
      {id: "4xx_5xx", label: "HTTP 4xx / 5xx"},
      {id: "ws", label: "WebSocket"},
    ];
  }, [allFrames, allObservations, allProbes, segment, selectedSessionId]);

  const effectiveFilter = useMemo(
    () => (filterOptions.some((opt) => opt.id === filterKey) ? filterKey : "all"),
    [filterKey, filterOptions],
  );

  const activeFilterLabel = useMemo(
    () => filterOptions.find((opt) => opt.id === effectiveFilter)?.label ?? "All",
    [effectiveFilter, filterOptions],
  );

  // Filtered datasets per segment
  const filteredSessions = useMemo<AgentSession[]>(() => {
    const q = search.trim().toLowerCase();

    return allSessions.filter((s) => {
      if (effectiveFilter !== "all" && s.state !== effectiveFilter) return false;
      if (!q) return true;
      const clientName = s.client_config?.clientInfo?.name ?? "";
      const proto = s.client_config?.protocolVersion ?? "";

      return (
        s.session_id.toLowerCase().includes(q) ||
        s.subject.toLowerCase().includes(q) ||
        s.transport.toLowerCase().includes(q) ||
        s.state.toLowerCase().includes(q) ||
        clientName.toLowerCase().includes(q) ||
        proto.toLowerCase().includes(q)
      );
    });
  }, [allSessions, effectiveFilter, search]);

  const filteredObservations = useMemo<FingerprintObservation[]>(() => {
    const q = search.trim().toLowerCase();

    return allObservations.filter((obs) => {
      if (effectiveFilter === "__session__") {
        if (!selectedSessionId || obs.session_id !== selectedSessionId) return false;
      } else if (effectiveFilter !== "all" && obs.kind !== effectiveFilter) {
        return false;
      }
      if (!q) return true;

      return (
        obs.observation_id.toLowerCase().includes(q) ||
        obs.kind.toLowerCase().includes(q) ||
        (obs.session_id ?? "").toLowerCase().includes(q) ||
        (obs.connection_id ?? "").toLowerCase().includes(q) ||
        JSON.stringify(obs.evidence).toLowerCase().includes(q)
      );
    });
  }, [allObservations, effectiveFilter, search, selectedSessionId]);

  const filteredProbes = useMemo<ProbeRun[]>(() => {
    const q = search.trim().toLowerCase();

    return allProbes.filter((probe) => {
      if (effectiveFilter === "__session__") {
        if (!selectedSessionId || probe.session_id !== selectedSessionId) return false;
      } else if (effectiveFilter !== "all" && probe.status !== effectiveFilter) {
        return false;
      }
      if (!q) return true;

      return (
        probe.probe_id.toLowerCase().includes(q) ||
        probe.session_id.toLowerCase().includes(q) ||
        probe.purpose.toLowerCase().includes(q) ||
        probe.status.toLowerCase().includes(q) ||
        (probe.error ?? "").toLowerCase().includes(q)
      );
    });
  }, [allProbes, effectiveFilter, search, selectedSessionId]);

  const filteredFrames = useMemo<McpFrame[]>(() => {
    const q = search.trim().toLowerCase();

    return allFrames.filter((frame) => {
      if (effectiveFilter === "__session__") {
        if (!selectedSessionId || frame.session_id !== selectedSessionId) return false;
      } else if (effectiveFilter !== "all" && frame.direction !== effectiveFilter) {
        return false;
      }
      if (!q) return true;

      return (
        String(frame.frame_id).includes(q) ||
        frame.direction.toLowerCase().includes(q) ||
        frame.method.toLowerCase().includes(q) ||
        (frame.session_id ?? "").toLowerCase().includes(q) ||
        (frame.upstream_name ?? "").toLowerCase().includes(q) ||
        JSON.stringify(frame.body).toLowerCase().includes(q)
      );
    });
  }, [allFrames, effectiveFilter, search, selectedSessionId]);

  const filteredTraffic = useMemo<ProxyTrafficRow[]>(() => {
    const q = search.trim().toLowerCase();

    return allTraffic.filter((row) => {
      const status = row.head.status ?? 0;

      if (effectiveFilter === "2xx" && (status < 200 || status >= 300)) return false;
      if (effectiveFilter === "4xx_5xx" && status < 400) return false;
      if (effectiveFilter === "ws" && !row.head.websocket_id) return false;
      if (!q) return true;

      return (
        String(row.id).includes(q) ||
        String(row.traffic_id).includes(q) ||
        (row.head.method ?? "").toLowerCase().includes(q) ||
        (row.head.uri ?? "").toLowerCase().includes(q) ||
        String(row.head.status ?? "").includes(q) ||
        (row.head.mime ?? "").toLowerCase().includes(q)
      );
    });
  }, [allTraffic, effectiveFilter, search]);

  // Derive active inspected item directly from live snapshot state
  const activeInspected = useMemo<InspectedEvidenceItem | null>(() => {
    if (segment === "sessions") {
      const targetId = selectedRowKey ?? selectedSessionId;
      const found =
        (targetId ? filteredSessions.find((s) => s.session_id === targetId) : undefined) ??
        filteredSessions[0];

      if (!found) return null;

      return {
        id: found.session_id,
        label: `S-${found.session_id.slice(0, 8)}`,
        record: found,
        rowKey: found.session_id,
        sessionId: found.session_id,
      };
    }

    if (segment === "observations") {
      const found =
        (selectedRowKey
          ? filteredObservations.find((o) => o.observation_id === selectedRowKey)
          : undefined) ?? filteredObservations[0];

      if (!found) return null;

      return {
        id: found.observation_id,
        label: `F-${found.observation_id.slice(0, 8)}`,
        record: found,
        rowKey: found.observation_id,
        sessionId: found.session_id,
      };
    }

    if (segment === "probes") {
      const found =
        (selectedRowKey ? filteredProbes.find((p) => p.probe_id === selectedRowKey) : undefined) ??
        filteredProbes[0];

      if (!found) return null;

      return {
        id: found.probe_id,
        label: `P-${found.probe_id.slice(0, 8)}`,
        record: found,
        rowKey: found.probe_id,
        sessionId: found.session_id,
      };
    }

    if (segment === "frames") {
      const found =
        (selectedRowKey
          ? filteredFrames.find((f) => String(f.frame_id) === selectedRowKey)
          : undefined) ?? filteredFrames[0];

      if (!found) return null;

      return {
        id: String(found.frame_id),
        label: `M-${found.frame_id}`,
        record: found,
        rowKey: String(found.frame_id),
        sessionId: found.session_id,
      };
    }

    const found =
      (selectedRowKey ? filteredTraffic.find((t) => String(t.id) === selectedRowKey) : undefined) ??
      filteredTraffic[0];

    if (!found) return null;
    const wsMessages =
      found.head.websocket_id !== null && found.head.websocket_id !== undefined
        ? (snapshot?.proxy_websocket_messages ?? []).filter(
            (m) => m.run_id === found.run_id && m.websocket_id === found.head.websocket_id,
          )
        : [];

    return {
      id: String(found.id),
      label: `T-${found.id}`,
      record: found,
      rowKey: String(found.id),
      sessionId: null,
      websocketMessages: wsMessages.length > 0 ? wsMessages : undefined,
    };
  }, [
    filteredFrames,
    filteredObservations,
    filteredProbes,
    filteredSessions,
    filteredTraffic,
    segment,
    selectedRowKey,
    selectedSessionId,
    snapshot?.proxy_websocket_messages,
  ]);

  // Operator session action preconditions (mirrors backend rules in proxyfor/src/commerce/http.rs)
  const actionReasons = useMemo(() => {
    const base = !unlocked
      ? "Admin token required"
      : busy
        ? "Backend action in progress"
        : "";

    const next = {
      evaluate: base,
      issue: base,
      probe: base,
      synthesize: base,
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

        const observedProbePolicy = snapshot?.probe_policy ?? publicStatus?.probe_policy ?? null;

        if (observedProbePolicy === "off") {
          next.probe = "Probes disabled by operator (policy: off)";
        } else if (selectedSession.client_config?.protocolVersion === "2026-07-28") {
          next.probe =
            "MCP 2026: agent must invoke outrider_run_probe to carry input-required round trip";
        } else if (!peer?.sampling) {
          next.probe =
            "MCP 2026 sampling required: no connected sampling-capable client on this session";
        }
      }

      if (clefStatus?.status !== "Ready") {
        next.evaluate =
          clefStatus?.status === "ModelError"
            ? `CLEF ModelError: ${clefStatus.error}`
            : clefStatus?.status === "Unconfigured"
              ? "CLEF Unconfigured: no model loaded"
              : "CLEF engine status not yet loaded";
      }

      if ((snapshot?.bundles.length ?? 0) === 0) {
        next.synthesize = "Configure at least one bundle first";
        next.issue = "Configure at least one bundle first";
      }
    }

    return next;
  }, [busy, clefStatus, publicStatus?.probe_policy, selectedSession, snapshot, unlocked]);

  const unmetReasons = useMemo(
    () => Object.entries(actionReasons).filter(([, reason]) => Boolean(reason)),
    [actionReasons],
  );

  const selectEvidenceRow = useCallback(
    (item: InspectedEvidenceItem) => {
      if (item.sessionId && allSessions.some((s) => s.session_id === item.sessionId)) {
        setSelectedSessionId(item.sessionId);
      }
      setSelectedRowKey(item.rowKey);
      setSelectedEvidence({
        label: item.label,
        record: item.record,
      });
    },
    [allSessions, setSelectedEvidence, setSelectedSessionId],
  );

  const handleGridSelectionChange = useCallback(
    (keys: DataGridSelection) => {
      if (keys === "all") return;
      const firstKey = keys.values().next().value;

      if (firstKey === undefined) return;
      const keyStr = String(firstKey);

      if (segment === "sessions") {
        const found = filteredSessions.find((s) => s.session_id === keyStr);

        if (found) {
          selectEvidenceRow({
            id: found.session_id,
            label: `S-${found.session_id.slice(0, 8)}`,
            record: found,
            rowKey: found.session_id,
            sessionId: found.session_id,
          });
        }
      } else if (segment === "observations") {
        const found = filteredObservations.find((o) => o.observation_id === keyStr);

        if (found) {
          selectEvidenceRow({
            id: found.observation_id,
            label: `F-${found.observation_id.slice(0, 8)}`,
            record: found,
            rowKey: found.observation_id,
            sessionId: found.session_id,
          });
        }
      } else if (segment === "probes") {
        const found = filteredProbes.find((p) => p.probe_id === keyStr);

        if (found) {
          selectEvidenceRow({
            id: found.probe_id,
            label: `P-${found.probe_id.slice(0, 8)}`,
            record: found,
            rowKey: found.probe_id,
            sessionId: found.session_id,
          });
        }
      } else if (segment === "frames") {
        const found = filteredFrames.find((f) => String(f.frame_id) === keyStr);

        if (found) {
          selectEvidenceRow({
            id: String(found.frame_id),
            label: `M-${found.frame_id}`,
            record: found,
            rowKey: String(found.frame_id),
            sessionId: found.session_id,
          });
        }
      } else {
        const found = filteredTraffic.find((t) => String(t.id) === keyStr);

        if (found) {
          selectEvidenceRow({
            id: String(found.id),
            label: `T-${found.id}`,
            record: found,
            rowKey: String(found.id),
            sessionId: null,
          });
        }
      }
    },
    [
      filteredFrames,
      filteredObservations,
      filteredProbes,
      filteredSessions,
      filteredTraffic,
      segment,
      selectEvidenceRow,
    ],
  );

  const copyText = useCallback(async (key: string, text: string) => {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      setActionError("Clipboard write blocked by browser permissions.");
    }
  }, []);

  const handleResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth =
      inspectorRef.current?.getBoundingClientRect().width ?? DEFAULT_INSPECTOR_WIDTH;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const clamped = Math.max(
        MIN_INSPECTOR_WIDTH,
        Math.min(MAX_INSPECTOR_WIDTH, Math.round(startWidth + delta)),
      );

      setInspectorWidth(clamped);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setInspectorWidth((w) => Math.min(MAX_INSPECTOR_WIDTH, w + 16));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setInspectorWidth((w) => Math.max(MIN_INSPECTOR_WIDTH, w - 16));
    } else if (event.key === "Home") {
      event.preventDefault();
      setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
    }
  }, []);

  // Columns: 1. Agent Sessions
  const sessionColumns = useMemo<DataGridColumn<AgentSession>[]>(
    () => [
      {
        accessorKey: "session_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            {row.session_id.slice(0, 14)}
          </span>
        ),
        header: "Session ID",
        id: "session_id",
        isRowHeader: true,
        minWidth: 140,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="block max-w-[200px] truncate text-xs font-medium">
            {row.client_config?.clientInfo?.name || "Unreported MCP client"}
          </span>
        ),
        header: "Client",
        id: "client",
        minWidth: 175,
        sortFn: (a, b) =>
          (a.client_config?.clientInfo?.name ?? "").localeCompare(
            b.client_config?.clientInfo?.name ?? "",
          ),
      },
      {
        accessorKey: "subject",
        allowsSorting: true,
        cell: (row) => (
          <span className="block max-w-[180px] truncate font-mono text-xs">{row.subject}</span>
        ),
        header: "Subject",
        id: "subject",
        minWidth: 160,
      },
      {
        accessorKey: "transport",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs">
            {row.transport}
            {row.client_config?.protocolVersion ? ` · ${row.client_config.protocolVersion}` : ""}
          </span>
        ),
        header: "Transport",
        id: "transport",
        minWidth: 135,
      },
      {
        accessorKey: "state",
        allowsSorting: true,
        cell: (row) => (
          <Chip color={sessionStateColor(row.state)} size="sm" variant="soft">
            {row.state}
          </Chip>
        ),
        header: "State",
        id: "state",
        minWidth: 135,
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.created_at)}
          </span>
        ),
        header: "Created (UTC)",
        id: "created_at",
        minWidth: 150,
      },
      {
        align: "end",
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              label={`Inspect session ${row.session_id.slice(0, 8)}`}
              size="sm"
              tooltip="Inspect session JSON"
              variant={activeInspected?.rowKey === row.session_id ? "secondary" : "tertiary"}
              onPress={() =>
                selectEvidenceRow({
                  id: row.session_id,
                  label: `S-${row.session_id.slice(0, 8)}`,
                  record: row,
                  rowKey: row.session_id,
                  sessionId: row.session_id,
                })
              }
            >
              <Code aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ),
        header: "Inspect",
        id: "inspect",
        minWidth: 72,
      },
    ],
    [activeInspected?.rowKey, selectEvidenceRow],
  );

  // Columns: 2. Fingerprint Observations
  const observationColumns = useMemo<DataGridColumn<FingerprintObservation>[]>(
    () => [
      {
        accessorKey: "observation_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            F-{row.observation_id.slice(0, 10)}
          </span>
        ),
        header: "Observation",
        id: "observation_id",
        isRowHeader: true,
        minWidth: 130,
      },
      {
        accessorKey: "kind",
        allowsSorting: true,
        cell: (row) => (
          <Chip color="default" size="sm" variant="soft">
            {row.kind}
          </Chip>
        ),
        header: "Kind",
        id: "kind",
        minWidth: 155,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">
            {row.session_id
              ? row.session_id.slice(0, 12)
              : row.connection_id
                ? `conn:${row.connection_id.slice(0, 8)}`
                : "—"}
          </span>
        ),
        header: "Session / Conn",
        id: "scope",
        minWidth: 135,
        sortFn: (a, b) =>
          (a.session_id ?? a.connection_id ?? "").localeCompare(
            b.session_id ?? b.connection_id ?? "",
          ),
      },
      {
        cell: (row) => (
          <span className="text-muted block max-w-[220px] truncate font-mono text-xs">
            {summarizeObservationEvidence(row.evidence)}
          </span>
        ),
        header: "Evidence Keys",
        id: "evidence",
        minWidth: 180,
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.created_at)}
          </span>
        ),
        header: "Captured (UTC)",
        id: "created_at",
        minWidth: 150,
      },
      {
        align: "end",
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              label={`Inspect observation ${row.observation_id.slice(0, 8)}`}
              size="sm"
              tooltip="Inspect observation JSON"
              variant={activeInspected?.rowKey === row.observation_id ? "secondary" : "tertiary"}
              onPress={() =>
                selectEvidenceRow({
                  id: row.observation_id,
                  label: `F-${row.observation_id.slice(0, 8)}`,
                  record: row,
                  rowKey: row.observation_id,
                  sessionId: row.session_id,
                })
              }
            >
              <Code aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ),
        header: "Inspect",
        id: "inspect",
        minWidth: 72,
      },
    ],
    [activeInspected?.rowKey, selectEvidenceRow],
  );

  // Columns: 3. Probe Runs
  const probeColumns = useMemo<DataGridColumn<ProbeRun>[]>(
    () => [
      {
        accessorKey: "probe_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">
            P-{row.probe_id.slice(0, 10)}
          </span>
        ),
        header: "Probe ID",
        id: "probe_id",
        isRowHeader: true,
        minWidth: 130,
      },
      {
        accessorKey: "session_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">{row.session_id.slice(0, 12)}</span>
        ),
        header: "Session",
        id: "session_id",
        minWidth: 125,
      },
      {
        accessorKey: "purpose",
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs">{row.purpose}</span>,
        header: "Purpose",
        id: "purpose",
        minWidth: 140,
      },
      {
        accessorKey: "status",
        allowsSorting: true,
        cell: (row) => (
          <Chip
            color={
              row.status === "Completed"
                ? "success"
                : row.status === "Failed"
                  ? "danger"
                  : "default"
            }
            size="sm"
            variant="soft"
          >
            {row.status}
          </Chip>
        ),
        header: "Status",
        id: "status",
        minWidth: 115,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">
            {row.latency_ms === null ? "—" : `${row.latency_ms} ms`}
          </span>
        ),
        header: "Latency",
        id: "latency_ms",
        minWidth: 95,
        sortFn: (a, b) => (a.latency_ms ?? -1) - (b.latency_ms ?? -1),
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs tabular-nums">
            {row.input_tokens ?? 0} / {row.output_tokens ?? 0}
          </span>
        ),
        header: "Tokens (in/out)",
        id: "tokens",
        minWidth: 125,
        sortFn: (a, b) =>
          (a.input_tokens ?? 0) +
          (a.output_tokens ?? 0) -
          ((b.input_tokens ?? 0) + (b.output_tokens ?? 0)),
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.created_at)}
          </span>
        ),
        header: "Created (UTC)",
        id: "created_at",
        minWidth: 150,
      },
      {
        align: "end",
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              label={`Inspect probe ${row.probe_id.slice(0, 8)}`}
              size="sm"
              tooltip="Inspect probe JSON"
              variant={activeInspected?.rowKey === row.probe_id ? "secondary" : "tertiary"}
              onPress={() =>
                selectEvidenceRow({
                  id: row.probe_id,
                  label: `P-${row.probe_id.slice(0, 8)}`,
                  record: row,
                  rowKey: row.probe_id,
                  sessionId: row.session_id,
                })
              }
            >
              <Code aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ),
        header: "Inspect",
        id: "inspect",
        minWidth: 72,
      },
    ],
    [activeInspected?.rowKey, selectEvidenceRow],
  );

  // Columns: 4. MCP Frames
  const frameColumns = useMemo<DataGridColumn<McpFrame>[]>(
    () => [
      {
        accessorKey: "frame_id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">M-{row.frame_id}</span>
        ),
        header: "Frame",
        id: "frame_id",
        isRowHeader: true,
        minWidth: 95,
      },
      {
        accessorKey: "direction",
        allowsSorting: true,
        cell: (row) => (
          <Chip
            color={
              row.direction === "error"
                ? "danger"
                : row.direction === "response"
                  ? "success"
                  : "default"
            }
            size="sm"
            variant="soft"
          >
            {row.direction}
          </Chip>
        ),
        header: "Direction",
        id: "direction",
        minWidth: 115,
      },
      {
        accessorKey: "method",
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs font-medium">{row.method}</span>,
        header: "Method",
        id: "method",
        minWidth: 175,
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {row.upstream_name || (row.session_id ? row.session_id.slice(0, 12) : "—")}
          </span>
        ),
        header: "Session / Upstream",
        id: "scope",
        minWidth: 150,
        sortFn: (a, b) =>
          (a.upstream_name ?? a.session_id ?? "").localeCompare(
            b.upstream_name ?? b.session_id ?? "",
          ),
      },
      {
        accessorKey: "created_at",
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {formatUtcTimestamp(row.created_at)}
          </span>
        ),
        header: "Captured (UTC)",
        id: "created_at",
        minWidth: 150,
      },
      {
        align: "end",
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              label={`Inspect frame M-${row.frame_id}`}
              size="sm"
              tooltip="Inspect MCP frame JSON"
              variant={activeInspected?.rowKey === String(row.frame_id) ? "secondary" : "tertiary"}
              onPress={() =>
                selectEvidenceRow({
                  id: String(row.frame_id),
                  label: `M-${row.frame_id}`,
                  record: row,
                  rowKey: String(row.frame_id),
                  sessionId: row.session_id,
                })
              }
            >
              <Code aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ),
        header: "Inspect",
        id: "inspect",
        minWidth: 72,
      },
    ],
    [activeInspected?.rowKey, selectEvidenceRow],
  );

  // Columns: 5. Proxy HTTP / WS Traffic
  const trafficColumns = useMemo<DataGridColumn<ProxyTrafficRow>[]>(
    () => [
      {
        accessorKey: "id",
        allowsSorting: true,
        cell: (row) => (
          <span className="font-mono text-xs font-medium tabular-nums">T-{row.id}</span>
        ),
        header: "Traffic",
        id: "id",
        isRowHeader: true,
        minWidth: 95,
      },
      {
        allowsSorting: true,
        cell: (row) => <span className="font-mono text-xs">{row.head.method ?? "—"}</span>,
        header: "Method",
        id: "method",
        minWidth: 95,
        sortFn: (a, b) => (a.head.method ?? "").localeCompare(b.head.method ?? ""),
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="block max-w-[260px] truncate font-mono text-xs">
            {row.head.uri ?? "—"}
          </span>
        ),
        header: "Target URI",
        id: "uri",
        minWidth: 220,
        sortFn: (a, b) => (a.head.uri ?? "").localeCompare(b.head.uri ?? ""),
      },
      {
        allowsSorting: true,
        cell: (row) => {
          const status = row.head.status;

          if (status === undefined) {
            return <span className="text-muted font-mono text-xs">—</span>;
          }
          const color =
            row.head.websocket_id || status === 101
              ? "accent"
              : status >= 200 && status < 300
                ? "success"
                : status >= 400
                  ? "danger"
                  : "default";

          return (
            <Chip color={color} size="sm" variant="soft">
              <span className="tabular-nums">{status}</span>
            </Chip>
          );
        },
        header: "Status",
        id: "status",
        minWidth: 100,
        sortFn: (a, b) => (a.head.status ?? 0) - (b.head.status ?? 0),
      },
      {
        allowsSorting: true,
        cell: (row) => (
          <span className="text-muted font-mono text-xs tabular-nums">
            {row.head.size === undefined ? "—" : `${row.head.size} B`}
          </span>
        ),
        header: "Bytes",
        id: "size",
        minWidth: 95,
        sortFn: (a, b) => (a.head.size ?? -1) - (b.head.size ?? -1),
      },
      {
        align: "end",
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              label={`Inspect traffic T-${row.id}`}
              size="sm"
              tooltip="Inspect traffic payload JSON"
              variant={activeInspected?.rowKey === String(row.id) ? "secondary" : "tertiary"}
              onPress={() =>
                selectEvidenceRow({
                  id: String(row.id),
                  label: `T-${row.id}`,
                  record: row,
                  rowKey: String(row.id),
                  sessionId: null,
                })
              }
            >
              <Code aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ),
        header: "Inspect",
        id: "inspect",
        minWidth: 72,
      },
    ],
    [activeInspected?.rowKey, selectEvidenceRow],
  );

  const renderSegmentEmptyState = (emptyLabel: string) => (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span className="text-muted text-xs text-pretty">
        {!unlocked
          ? "Unlock with the admin token in the top bar to inspect persisted session evidence."
          : search.trim() || effectiveFilter !== "all"
            ? "No records match the active search or filter."
            : emptyLabel}
      </span>
      {unlocked ? (
        search.trim() || effectiveFilter !== "all" ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setSearch("");
              setFilterKey("all");
            }}
          >
            Clear Filters
          </Button>
        ) : (
          <Button isDisabled={busy} size="sm" variant="secondary" onPress={() => void refresh()}>
            <ArrowsRotateLeft aria-hidden="true" className="size-4" />
            Refresh Snapshot
          </Button>
        )
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm text-pretty">
        Persisted MCP agent sessions, TLS/HTTP/MCP fingerprint observations, active capability
        probes, MCP protocol frames, and proxy HTTP/WebSocket traffic.
      </p>

      {/* Real Session State KPIs */}
      <KPIGroup>
        {SESSION_STATES.map((stateName, index) => (
          <Fragment key={stateName}>
            {index > 0 ? <KPIGroup.Separator /> : null}
            <KPI>
              <KPI.Header>
                <KPI.Title>{stateName}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <KPI.Value
                  className="tabular-nums"
                  maximumFractionDigits={0}
                  value={counts[stateName] ?? 0}
                />
              </KPI.Content>
            </KPI>
          </Fragment>
        ))}
      </KPIGroup>

      {actionError ? (
        <div
          aria-live="assertive"
          className="border-danger/40 bg-danger/10 text-danger flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
          role="alert"
        >
          <span>{actionError}</span>
          <Button size="sm" variant="tertiary" onPress={() => setActionError(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* Unified Evidence Substrate + Session Action Inspector Workbench */}
      <section
        aria-label="Sessions and evidence workbench"
        className="border-border bg-surface flex flex-col overflow-hidden rounded-2xl border"
      >
        {/* Fixed-Coordinate Segment, Search, and Filter Rail */}
        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="max-w-full overflow-x-auto">
            <Segment
              aria-label="Evidence substrate segment"
              selectedKey={segment}
              size="sm"
              onSelectionChange={(key: Key) => {
                setSegment(String(key) as EvidenceSegment);
                setFilterKey("all");
                setSelectedRowKey(null);
              }}
            >
              <Segment.Item id="sessions">Agent Sessions</Segment.Item>
              <Segment.Item id="observations">Fingerprint Observations</Segment.Item>
              <Segment.Item id="probes">Probe Runs</Segment.Item>
              <Segment.Item id="frames">MCP Frames</Segment.Item>
              <Segment.Item id="traffic">Proxy HTTP / WS Traffic</Segment.Item>
            </Segment>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              aria-label="Search session and evidence records"
              className="w-full sm:w-[240px]"
              name="evidence-search"
              value={search}
              variant="secondary"
              onChange={setSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search session, method, URI..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <Dropdown>
              <Button aria-label="Filter evidence substrate" size="sm" variant="secondary">
                <Funnel aria-hidden="true" className="size-4" />
                {activeFilterLabel}
              </Button>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="Evidence filter options"
                  onAction={(key: Key) => setFilterKey(String(key))}
                >
                  {filterOptions.map((opt) => (
                    <Dropdown.Item key={opt.id} id={opt.id} textValue={opt.label}>
                      <Label>{opt.label}</Label>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>

        {/* Master-Detail Split Body */}
        <div className="flex min-w-0 flex-col lg:flex-row">
          <div className="min-w-0 flex-1 p-3">
            {segment === "sessions" ? (
              <DataGrid
                aria-label="Recorded agent sessions"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={sessionColumns}
                contentClassName="min-w-[760px]"
                data={filteredSessions}
                getRowId={(item) => item.session_id}
                selectedKeys={activeInspected ? new Set([activeInspected.rowKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() =>
                  renderSegmentEmptyState("No MCP agent sessions recorded in this runtime yet.")
                }
              />
            ) : null}

            {segment === "observations" ? (
              <DataGrid
                aria-label="Fingerprint observations"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={observationColumns}
                contentClassName="min-w-[740px]"
                data={filteredObservations}
                getRowId={(item) => item.observation_id}
                selectedKeys={activeInspected ? new Set([activeInspected.rowKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() =>
                  renderSegmentEmptyState("No TLS/HTTP/MCP fingerprint observations captured yet.")
                }
              />
            ) : null}

            {segment === "probes" ? (
              <DataGrid
                aria-label="Active capability probe runs"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={probeColumns}
                contentClassName="min-w-[760px]"
                data={filteredProbes}
                getRowId={(item) => item.probe_id}
                selectedKeys={activeInspected ? new Set([activeInspected.rowKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() =>
                  renderSegmentEmptyState("No active capability probe runs recorded yet.")
                }
              />
            ) : null}

            {segment === "frames" ? (
              <DataGrid
                aria-label="Persisted MCP protocol frames"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={frameColumns}
                contentClassName="min-w-[720px]"
                data={filteredFrames}
                getRowId={(item) => String(item.frame_id)}
                selectedKeys={activeInspected ? new Set([activeInspected.rowKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() =>
                  renderSegmentEmptyState("No MCP protocol frames persisted yet.")
                }
              />
            ) : null}

            {segment === "traffic" ? (
              <DataGrid
                aria-label="Proxy HTTP and WebSocket traffic"
                className="[&_[aria-selected=true]]:shadow-none [&_[data-selected=true]]:shadow-none"
                columns={trafficColumns}
                contentClassName="min-w-[680px]"
                data={filteredTraffic}
                getRowId={(item) => String(item.id)}
                selectedKeys={activeInspected ? new Set([activeInspected.rowKey]) : new Set()}
                selectionBehavior="replace"
                selectionMode="single"
                onSelectionChange={handleGridSelectionChange}
                renderEmptyState={() =>
                  renderSegmentEmptyState("No proxy HTTP or WebSocket traffic rows persisted yet.")
                }
              />
            ) : null}
          </div>

          {/* Draggable Split-Pane Resize Handle */}
          <div
            aria-label="Resize session inspector"
            aria-orientation="vertical"
            aria-valuemax={MAX_INSPECTOR_WIDTH}
            aria-valuemin={MIN_INSPECTOR_WIDTH}
            aria-valuenow={inspectorWidth}
            className="bg-border/60 hover:bg-accent/50 hidden min-h-[420px] w-1.5 shrink-0 select-none lg:block"
            role="separator"
            style={{cursor: "ew-resize", touchAction: "none"}}
            tabIndex={0}
            onDoubleClick={() => setInspectorWidth(DEFAULT_INSPECTOR_WIDTH)}
            onKeyDown={handleResizeKeyDown}
            onMouseDown={handleResizeMouseDown}
          />

          {/* Right Session Action & Raw JSON Inspector */}
          <aside
            ref={inspectorRef}
            aria-label="Session action and JSON inspector"
            className="border-border flex w-full shrink-0 flex-col border-t lg:w-[var(--inspector-w)] lg:border-t-0"
            style={{"--inspector-w": `${inspectorWidth}px`} as CSSProperties}
          >
            {/* Top Pane: Selected Session Operator Controls */}
            <div className="border-border flex flex-col gap-2.5 border-b p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-foreground text-sm font-semibold text-balance">
                  Session Actions
                </h2>
                {selectedSession ? (
                  <Chip color={sessionStateColor(selectedSession.state)} size="sm" variant="soft">
                    {selectedSession.state}
                  </Chip>
                ) : null}
              </div>

              {allSessions.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <label className="text-muted text-xs" htmlFor="tracker-target-session">
                    Target session
                  </label>
                  <select
                    className="border-border bg-background text-foreground h-8 w-full rounded-lg border px-2.5 font-mono text-xs"
                    id="tracker-target-session"
                    value={selectedSessionId ?? ""}
                    onChange={(e) => setSelectedSessionId(e.target.value || null)}
                  >
                    {allSessions.map((s) => (
                      <option key={s.session_id} value={s.session_id}>
                        {s.session_id.slice(0, 12)} —{" "}
                        {s.client_config?.clientInfo?.name || "Unreported MCP client"} ({s.state})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-muted text-xs text-pretty">
                  {unlocked
                    ? "No active or historical MCP sessions recorded yet."
                    : "Unlock with the admin token to run session actions."}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex"
                  title={actionReasons.probe || "Run active capability probe on selected session"}
                >
                  <Button
                    isDisabled={Boolean(actionReasons.probe)}
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      if (!selectedSession) return;
                      setActionError(null);
                      void mutate("/probe", {session_id: selectedSession.session_id}).catch(
                        (err: unknown) =>
                          setActionError(
                            err instanceof Error ? err.message : "Probe request failed.",
                          ),
                      );
                    }}
                  >
                    Probe Session
                  </Button>
                </span>

                <span
                  className="inline-flex"
                  title={actionReasons.evaluate || "Evaluate selected session with CLEF"}
                >
                  <Button
                    isDisabled={Boolean(actionReasons.evaluate)}
                    size="sm"
                    variant="secondary"
                    onPress={() => openDialog("evaluate-clef")}
                  >
                    Run CLEF Eval
                  </Button>
                </span>

                <span
                  className="inline-flex"
                  title={
                    actionReasons.synthesize || "Synthesize bundle offers for selected session"
                  }
                >
                  <Button
                    isDisabled={Boolean(actionReasons.synthesize)}
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      if (!selectedSession) return;
                      setActionError(null);
                      void mutate("/offers/synthesize", {
                        session_id: selectedSession.session_id,
                      }).catch((err: unknown) =>
                        setActionError(
                          err instanceof Error ? err.message : "Offer synthesis failed.",
                        ),
                      );
                    }}
                  >
                    Synthesize Offer
                  </Button>
                </span>

                <span
                  className="inline-flex"
                  title={
                    actionReasons.issue || "Issue Ed25519 capability receipt for selected session"
                  }
                >
                  <Button
                    isDisabled={Boolean(actionReasons.issue)}
                    size="sm"
                    variant="primary"
                    onPress={() => openDialog("issue-receipt")}
                  >
                    Issue Receipt
                  </Button>
                </span>
              </div>

              {unmetReasons.length > 0 ? (
                <div className="text-muted flex flex-col gap-0.5 text-xs">
                  {unmetReasons.map(([action, reason]) => (
                    <span key={action}>
                      <strong className="font-medium">{action}:</strong> {reason}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Bottom Pane: Raw Persisted JSON Inspector */}
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-foreground text-xs font-semibold text-balance">
                  Persisted JSON Payload
                </h3>
                {activeInspected ? (
                  <div className="flex items-center gap-1">
                    <IconButton
                      label={`Copy record ID ${activeInspected.id.slice(0, 8)}`}
                      size="sm"
                      tooltip={copiedKey === "id" ? "Copied ID" : "Copy record ID"}
                      variant="tertiary"
                      onPress={() => void copyText("id", activeInspected.id)}
                    >
                      {copiedKey === "id" ? (
                        <CircleCheck aria-hidden="true" className="text-success size-4" />
                      ) : (
                        <Copy aria-hidden="true" className="size-4" />
                      )}
                    </IconButton>

                    <IconButton
                      label={`Copy JSON for ${activeInspected.label}`}
                      size="sm"
                      tooltip={copiedKey === "json" ? "Copied JSON" : "Copy persisted JSON"}
                      variant="tertiary"
                      onPress={() =>
                        void copyText("json", JSON.stringify(activeInspected.record, null, 2))
                      }
                    >
                      {copiedKey === "json" ? (
                        <CircleCheck aria-hidden="true" className="text-success size-4" />
                      ) : (
                        <Code aria-hidden="true" className="size-4" />
                      )}
                    </IconButton>
                  </div>
                ) : null}
              </div>

              {activeInspected ? (
                <>
                  <span className="text-accent font-mono text-xs font-medium tabular-nums">
                    {activeInspected.label}
                  </span>
                  <pre className="border-border bg-background max-h-[380px] flex-1 overflow-auto rounded-lg border p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                    {JSON.stringify(activeInspected.record, null, 2)}
                  </pre>

                  {activeInspected.websocketMessages ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-muted text-xs font-medium tabular-nums">
                        WebSocket Frames ({activeInspected.websocketMessages.length})
                      </span>
                      <pre className="border-border bg-background max-h-[180px] overflow-auto rounded-lg border p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                        {JSON.stringify(activeInspected.websocketMessages, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-muted text-xs text-pretty">
                  {unlocked
                    ? "Select any session, observation, probe, MCP frame, or proxy traffic row to inspect its persisted SQLite JSON."
                    : "Unlock with the admin token to inspect persisted session evidence."}
                </p>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
