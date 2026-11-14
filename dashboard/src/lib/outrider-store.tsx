"use client";

import type {
  AgentSession,
  CapabilityReceiptRow,
  ClefEngineStatus,
  CommerceSnapshot,
  CommerceStatus,
  InspectorState,
  IssuedReceiptResponse,
  OperatorDialogKind,
  OverviewFilterTab,
  ProbePolicy,
  SelectedEvidence,
} from "./types";
import type {ReactNode} from "react";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const COMMERCE_API_BASE = "/__proxyfor__/commerce";
export const TOKEN_STORAGE_KEY = "outrider_admin_token";

export interface OutriderContextValue {
  publicStatus: CommerceStatus | null;
  snapshot: CommerceSnapshot | null;
  unlocked: boolean;
  liveConnected: boolean;
  busy: boolean;
  token: string;
  statusMessage: string;
  statusError: boolean;
  lastUpdatedAt: number | null;
  clefStatus: ClefEngineStatus | null;
  probePolicy: ProbePolicy;
  selectedSessionId: string | null;
  setSelectedSessionId: (sessionId: string | null) => void;
  selectedSession: AgentSession | null;
  selectedReceiptId: string | null;
  setSelectedReceiptId: (receiptId: string | null) => void;
  selectedReceipt: CapabilityReceiptRow | null;
  selectedEvidence: SelectedEvidence | null;
  setSelectedEvidence: (evidence: SelectedEvidence | null) => void;
  overviewTab: OverviewFilterTab;
  setOverviewTab: (tab: OverviewFilterTab) => void;
  activeDialog: OperatorDialogKind | null;
  dialogOpenedAtUnix: number;
  openDialog: (kind: OperatorDialogKind) => void;
  closeDialog: () => void;
  unlock: (candidateToken: string) => Promise<boolean>;
  lock: () => void;
  refresh: () => Promise<boolean>;
  mutate: <T = unknown>(path: string, body: unknown) => Promise<T>;
  fetchInspectorState: (connectionId?: string | null, after?: number) => Promise<InspectorState>;
  exportSnapshot: () => void;
}

const OutriderContext = createContext<OutriderContextValue | null>(null);

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {error?: string};

    return `${response.status}: ${json.error || response.statusText || "Request failed"}`;
  } catch {
    return `${response.status}: ${response.statusText || "Request failed"}`;
  }
}

export function OutriderProvider({children}: {children: ReactNode}) {
  const [publicStatus, setPublicStatus] = useState<CommerceStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CommerceSnapshot | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Enter the admin token to inspect persisted commerce state.",
  );
  const [statusError, setStatusError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [selectedSessionId, setSelectedSessionIdState] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<SelectedEvidence | null>(null);
  const [overviewTab, setOverviewTab] = useState<OverviewFilterTab>("overview");
  const [activeDialog, setActiveDialog] = useState<OperatorDialogKind | null>(null);
  const [dialogOpenedAtUnix, setDialogOpenedAtUnix] = useState(0);

  const tokenRef = useRef("");
  const unlockedRef = useRef(false);
  const busyRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((next: CommerceSnapshot) => {
    setSnapshot(next);
    setLastUpdatedAt(Date.now());
    setSelectedSessionIdState((prev) => {
      if (prev && next.agent_sessions.some((s) => s.session_id === prev)) {
        return prev;
      }

      return next.agent_sessions[0]?.session_id ?? null;
    });
    setSelectedReceiptId((prev) => {
      if (prev && next.capability_receipts.some((r) => r.receipt_id === prev)) {
        return prev;
      }

      const active = next.capability_receipts.find((r) => !r.revoked);

      return active?.receipt_id ?? next.capability_receipts[0]?.receipt_id ?? null;
    });
    if (next.errors.length > 0) {
      const latestErr = next.errors[next.errors.length - 1];

      if (latestErr) {
        setStatusMessage(latestErr);
        setStatusError(true);
      }
    }
  }, []);

  const stopEventsStream = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setLiveConnected(false);
  }, []);

  const lock = useCallback(() => {
    stopEventsStream();
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore storage access errors in restricted contexts.
    }
    tokenRef.current = "";
    unlockedRef.current = false;
    setToken("");
    setUnlocked(false);
    setSnapshot(null);
    setSelectedEvidence(null);
    setActiveDialog(null);
    setStatusMessage("Session locked. Enter the admin token to inspect persisted commerce state.");
    setStatusError(false);
  }, [stopEventsStream]);

  const refreshWithToken = useCallback(
    async (bearer: string): Promise<boolean> => {
      if (!bearer) return false;
      try {
        const response = await fetch(`${COMMERCE_API_BASE}/snapshot`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${bearer}`,
          },
        });

        if (!response.ok) {
          const msg = await parseErrorMessage(response);

          if (response.status === 401 || response.status === 403) {
            stopEventsStream();
            unlockedRef.current = false;
            setUnlocked(false);
            setSnapshot(null);
          }
          setStatusMessage(msg);
          setStatusError(true);

          return false;
        }

        const next = (await response.json()) as CommerceSnapshot;

        applySnapshot(next);

        return true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to refresh commerce snapshot";

        setStatusMessage(msg);
        setStatusError(true);

        return false;
      }
    },
    [applySnapshot, stopEventsStream],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!unlockedRef.current || !tokenRef.current) return false;

    return refreshWithToken(tokenRef.current);
  }, [refreshWithToken]);

  const startEventsStream = useCallback(
    (bearer: string) => {
      stopEventsStream();
      const controller = new AbortController();

      streamAbortRef.current = controller;

      const scheduleRefresh = () => {
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        refreshTimerRef.current = setTimeout(() => {
          if (unlockedRef.current && tokenRef.current) {
            void refreshWithToken(tokenRef.current);
          }
        }, 65);
      };

      void (async () => {
        try {
          const response = await fetch(`${COMMERCE_API_BASE}/events`, {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${bearer}`,
            },
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            setLiveConnected(false);

            return;
          }

          setLiveConnected(true);
          const reader = response.body.getReader();

          while (!controller.signal.aborted) {
            const {done} = await reader.read();

            if (done) break;
            scheduleRefresh();
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }
          setLiveConnected(false);
        }
      })();
    },
    [refreshWithToken, stopEventsStream],
  );

  const unlock = useCallback(
    async (candidateToken: string): Promise<boolean> => {
      const trimmed = candidateToken.trim();

      if (!trimmed) {
        setStatusMessage("401: Admin bearer token required");
        setStatusError(true);
        setUnlocked(false);
        unlockedRef.current = false;

        return false;
      }

      try {
        const response = await fetch(`${COMMERCE_API_BASE}/snapshot`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${trimmed}`,
          },
        });

        if (!response.ok) {
          const msg = await parseErrorMessage(response);

          try {
            sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          } catch {
            // Ignore storage errors.
          }
          tokenRef.current = "";
          unlockedRef.current = false;
          setToken("");
          setUnlocked(false);
          setSnapshot(null);
          setStatusMessage(msg);
          setStatusError(true);

          return false;
        }

        const next = (await response.json()) as CommerceSnapshot;

        try {
          sessionStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
        } catch {
          // Ignore storage errors.
        }
        tokenRef.current = trimmed;
        unlockedRef.current = true;
        setToken(trimmed);
        setUnlocked(true);
        applySnapshot(next);
        setStatusMessage("Authenticated. Reading persisted runtime state.");
        setStatusError(false);
        startEventsStream(trimmed);

        return true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to verify admin token";

        unlockedRef.current = false;
        setUnlocked(false);
        setStatusMessage(msg);
        setStatusError(true);

        return false;
      }
    },
    [applySnapshot, startEventsStream],
  );

  const mutate = useCallback(
    async <T = unknown>(path: string, body: unknown): Promise<T> => {
      if (!unlockedRef.current || !tokenRef.current) {
        const err = new Error("401: Admin bearer token required");

        setStatusMessage(err.message);
        setStatusError(true);
        throw err;
      }

      busyRef.current = true;
      setBusy(true);
      try {
        const response = await fetch(`${COMMERCE_API_BASE}${path}`, {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (!response.ok) {
          const msg = await parseErrorMessage(response);

          setStatusMessage(msg);
          setStatusError(true);
          throw new Error(msg);
        }

        const result = (await response.json()) as T;
        const refreshed = await refreshWithToken(tokenRef.current);

        if (!refreshed) {
          throw new Error("Mutation persisted, but refreshing stored state failed");
        }

        setStatusMessage(`Persisted backend result: ${path}`);
        setStatusError(false);

        if (
          path === "/receipts/issue" &&
          result &&
          typeof result === "object" &&
          "signed_receipt" in result
        ) {
          const issued = result as unknown as IssuedReceiptResponse;

          setSelectedReceiptId(issued.signed_receipt.receipt.receipt_id);
          setSelectedEvidence({
            label: "Issued capability receipt — retain this token for the agent",
            record: issued,
          });
        }

        return result;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refreshWithToken],
  );

  const fetchInspectorState = useCallback(
    async (connectionId?: string | null, after = 0): Promise<InspectorState> => {
      if (!unlockedRef.current || !tokenRef.current) {
        throw new Error("401: Admin bearer token required");
      }
      const params = new URLSearchParams();

      if (connectionId) {
        params.set("connection_id", connectionId);
      }
      if (after > 0) {
        params.set("after", String(after));
      }
      const qs = params.toString();
      const response = await fetch(
        `${COMMERCE_API_BASE}/inspector/state${qs ? `?${qs}` : ""}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
          },
        },
      );

      if (!response.ok) {
        const msg = await parseErrorMessage(response);

        setStatusMessage(msg);
        setStatusError(true);
        throw new Error(msg);
      }

      return (await response.json()) as InspectorState;
    },
    [],
  );

  const exportSnapshot = useCallback(() => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `outrider-snapshot-${snapshot.run_id.slice(0, 8)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported snapshot (${snapshot.run_id.slice(0, 8)}).`);
    setStatusError(false);
  }, [snapshot]);

  const setSelectedSessionId = useCallback((sessionId: string | null) => {
    setSelectedSessionIdState(sessionId);
    setSelectedEvidence(null);
  }, []);

  const openDialog = useCallback((kind: OperatorDialogKind) => {
    setDialogOpenedAtUnix(Math.floor(Date.now() / 1000));
    setActiveDialog(kind);
  }, []);

  const closeDialog = useCallback(() => {
    setActiveDialog(null);
  }, []);

  // Poll public `/__proxyfor__/commerce/status` on mount and restore saved session token if present.
  useEffect(() => {
    let cancelled = false;

    const loadPublicStatus = async () => {
      try {
        const response = await fetch(`${COMMERCE_API_BASE}/status`, {cache: "no-store"});

        if (!response.ok || cancelled) return;
        const status = (await response.json()) as CommerceStatus;

        if (!cancelled) {
          setPublicStatus(status);
        }
      } catch {
        if (!cancelled && !unlockedRef.current) {
          setStatusMessage("Gateway status endpoint unreachable.");
          setStatusError(true);
        }
      }
    };

    const restoreSavedSession = async () => {
      await Promise.resolve();
      if (cancelled) return;
      try {
        const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);

        if (saved && saved.trim()) {
          await unlock(saved);
        }
      } catch {
        // Ignore storage access errors.
      }
    };

    void loadPublicStatus();
    void restoreSavedSession();

    const statusInterval = setInterval(() => {
      void loadPublicStatus();
    }, 10_000);

    const snapshotInterval = setInterval(() => {
      if (unlockedRef.current && tokenRef.current && !busyRef.current) {
        void refreshWithToken(tokenRef.current);
      }
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(statusInterval);
      clearInterval(snapshotInterval);
      stopEventsStream();
    };
  }, [refreshWithToken, stopEventsStream, unlock]);

  const selectedSession = useMemo<AgentSession | null>(() => {
    if (!snapshot || !selectedSessionId) return null;

    return snapshot.agent_sessions.find((s) => s.session_id === selectedSessionId) ?? null;
  }, [snapshot, selectedSessionId]);

  const selectedReceipt = useMemo<CapabilityReceiptRow | null>(() => {
    if (!snapshot || !selectedReceiptId) return null;

    return snapshot.capability_receipts.find((r) => r.receipt_id === selectedReceiptId) ?? null;
  }, [snapshot, selectedReceiptId]);

  const clefStatus = snapshot?.clef ?? publicStatus?.clef ?? null;
  const probePolicy: ProbePolicy = snapshot?.probe_policy ?? publicStatus?.probe_policy ?? "on-request";

  const value = useMemo<OutriderContextValue>(
    () => ({
      activeDialog,
      busy,
      clefStatus,
      closeDialog,
      dialogOpenedAtUnix,
      exportSnapshot,
      fetchInspectorState,
      lastUpdatedAt,
      liveConnected,
      lock,
      mutate,
      openDialog,
      overviewTab,
      probePolicy,
      publicStatus,
      refresh,
      selectedEvidence,
      selectedReceipt,
      selectedReceiptId,
      selectedSession,
      selectedSessionId,
      setOverviewTab,
      setSelectedEvidence,
      setSelectedReceiptId,
      setSelectedSessionId,
      snapshot,
      statusError,
      statusMessage,
      token,
      unlock,
      unlocked,
    }),
    [
      activeDialog,
      busy,
      clefStatus,
      closeDialog,
      dialogOpenedAtUnix,
      exportSnapshot,
      fetchInspectorState,
      lastUpdatedAt,
      liveConnected,
      lock,
      mutate,
      openDialog,
      overviewTab,
      probePolicy,
      publicStatus,
      refresh,
      selectedEvidence,
      selectedReceipt,
      selectedReceiptId,
      selectedSession,
      selectedSessionId,
      setSelectedSessionId,
      snapshot,
      statusError,
      statusMessage,
      token,
      unlock,
      unlocked,
    ],
  );

  return <OutriderContext value={value}>{children}</OutriderContext>;
}

export function useOutrider(): OutriderContextValue {
  const ctx = useContext(OutriderContext);

  if (!ctx) {
    throw new Error("useOutrider must be used inside OutriderProvider");
  }

  return ctx;
}
