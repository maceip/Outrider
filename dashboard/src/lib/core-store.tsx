"use client";

import type {
  CommerceSnapshot,
  CommerceStatus,
  DashboardPeriod,
  DashboardTab,
  InspectorState,
  TimeRange,
  TrafficDetail,
  TrafficHead,
} from "./types";
import type {ReactNode} from "react";

import {toast} from "@heroui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {WwwDemoEngine} from "./www-demo-engine";

export const PROXYFOR_BASE = "/__proxyfor__";
export const COMMERCE_API_BASE = "/__proxyfor__/commerce";
export const TOKEN_STORAGE_KEY = "conduit_admin_token";
const IS_WWW = process.env.NEXT_PUBLIC_WWW === "1";

export interface CoreStoreValue {
  traffics: TrafficHead[];
  status: CommerceStatus | null;
  snapshot: CommerceSnapshot | null;
  connected: boolean;
  busy: boolean;
  eventsVersion: number;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  dashboardPeriod: DashboardPeriod;
  setDashboardPeriod: (period: DashboardPeriod) => void;
  dashboardTab: DashboardTab;
  setDashboardTab: (tab: DashboardTab) => void;
  refresh: () => Promise<void>;
  refreshTraffics: () => Promise<void>;
  fetchTrafficDetail: (id: number) => Promise<TrafficDetail>;
  fetchInspectorState: (connectionId?: string | null, after?: number) => Promise<InspectorState>;
  mutate: <T = unknown>(path: string, body: unknown) => Promise<T>;
  exportHar: () => void;
  downloadTrafficHar: (id: number) => Promise<void>;
  copyTrafficCurl: (id: number) => Promise<void>;
}

const CoreStoreContext = createContext<CoreStoreValue | null>(null);

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener("abort", onAbort, {once: true});
  });
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {error?: string};

    return `${response.status}: ${json.error || response.statusText || "Request failed"}`;
  } catch {
    return `${response.status}: ${response.statusText || "Request failed"}`;
  }
}

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeStoredToken(token: string): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted contexts.
  }
}

function consumeBootstrapHashNonce(): string | null {
  if (typeof window === "undefined" || !window.location.hash.includes("bootstrap=")) {
    return null;
  }
  const rawHash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(rawHash);
  const nonce = params.get("bootstrap")?.trim() ?? null;

  params.delete("bootstrap");
  const remainingHash = params.toString();
  const cleanUrl = `${window.location.pathname}${window.location.search}${
    remainingHash ? `#${remainingHash}` : ""
  }`;

  window.history.replaceState(null, "", cleanUrl);

  return nonce && nonce.length > 0 ? nonce : null;
}

export function CoreProvider({children}: {children: ReactNode}) {
  const [traffics, setTraffics] = useState<TrafficHead[]>([]);
  const [status, setStatus] = useState<CommerceStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CommerceSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventsVersion, setEventsVersion] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>("monthly");
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>("overview");

  const trafficsMapRef = useRef<Map<number, TrafficHead>>(new Map());
  const trafficsRef = useRef<TrafficHead[]>([]);
  const statusRef = useRef<CommerceStatus | null>(null);
  const snapshotRef = useRef<CommerceSnapshot | null>(null);
  const connectedRef = useRef(false);
  const tokenRef = useRef("");
  const disconnectToastShownRef = useRef(false);
  const authInFlightRef = useRef<Promise<string | null> | null>(null);
  const wwwEngineRef = useRef<WwwDemoEngine | null>(null);

  const syncWwwEngineState = useCallback(() => {
    const engine = wwwEngineRef.current;

    if (!engine) return;
    const next = engine.getState();

    trafficsRef.current = next.traffics;
    statusRef.current = next.status;
    snapshotRef.current = next.snapshot;
    connectedRef.current = true;
    setTraffics(next.traffics);
    setStatus(next.status);
    setSnapshot(next.snapshot);
    setConnected(true);
    setEventsVersion((v) => v + 1);
  }, []);

  const getWwwEngine = useCallback((): WwwDemoEngine => {
    if (!wwwEngineRef.current) {
      wwwEngineRef.current = new WwwDemoEngine(syncWwwEngineState);
    }

    return wwwEngineRef.current;
  }, [syncWwwEngineState]);

  const markConnected = useCallback(() => {
    disconnectToastShownRef.current = false;
    if (!connectedRef.current) {
      connectedRef.current = true;
      setConnected(true);
    }
  }, []);

  const markDisconnected = useCallback((message?: string) => {
    connectedRef.current = false;
    setConnected(false);
    if (message && !disconnectToastShownRef.current) {
      disconnectToastShownRef.current = true;
      toast.danger(message);
    }
  }, []);

  const upsertTrafficHeads = useCallback((incoming: TrafficHead[]) => {
    if (incoming.length === 0) return;
    const map = trafficsMapRef.current;
    let changed = false;

    for (const head of incoming) {
      if (!head || typeof head.id !== "number") continue;
      const existing = map.get(head.id);

      map.set(head.id, existing ? {...existing, ...head} : head);
      changed = true;
    }

    if (changed) {
      const sorted = Array.from(map.values()).sort((a, b) => b.id - a.id);

      trafficsRef.current = sorted;
      setTraffics(sorted);
    }
  }, []);

  const ingestNdjsonLines = useCallback(
    (lines: string[]) => {
      const parsed: TrafficHead[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) continue;
        try {
          const head = JSON.parse(trimmed) as TrafficHead;

          if (head && typeof head.id === "number") {
            parsed.push(head);
          }
        } catch {
          // Ignore malformed frame fragments.
        }
      }

      if (parsed.length > 0) {
        upsertTrafficHeads(parsed);
      }
    },
    [upsertTrafficHeads],
  );

  const fetchStatus = useCallback(
    async (signal?: AbortSignal): Promise<CommerceStatus | null> => {
      try {
        const response = await fetch(`${COMMERCE_API_BASE}/status`, {
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          return null;
        }
        const nextStatus = (await response.json()) as CommerceStatus;

        statusRef.current = nextStatus;
        setStatus(nextStatus);
        markConnected();

        return nextStatus;
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return null;
        }
        markDisconnected("Unable to reach local gateway");

        return null;
      }
    },
    [markConnected, markDisconnected],
  );

  const fetchSnapshotWithToken = useCallback(
    async (bearer: string, signal?: AbortSignal): Promise<"ok" | "unauthorized" | "error"> => {
      if (!bearer) return "unauthorized";
      try {
        const response = await fetch(`${COMMERCE_API_BASE}/snapshot`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${bearer}`,
          },
          signal,
        });

        if (response.status === 401 || response.status === 403) {
          return "unauthorized";
        }
        if (!response.ok) {
          return "error";
        }
        const nextSnapshot = (await response.json()) as CommerceSnapshot;

        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
        markConnected();

        return "ok";
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return "error";
        }
        markDisconnected("Unable to reach local gateway");

        return "error";
      }
    },
    [markConnected, markDisconnected],
  );

  const ensureAuthenticated = useCallback(
    async (signal?: AbortSignal): Promise<string | null> => {
      if (tokenRef.current) {
        return tokenRef.current;
      }
      if (authInFlightRef.current) {
        return authInFlightRef.current;
      }

      const promise = (async (): Promise<string | null> => {
        // 1. Desktop launch `#bootstrap=<nonce>` hash exchange
        const nonce = consumeBootstrapHashNonce();

        if (nonce) {
          try {
            const exRes = await fetch(`${COMMERCE_API_BASE}/bootstrap/exchange`, {
              body: JSON.stringify({nonce}),
              headers: {"Content-Type": "application/json"},
              method: "POST",
              signal,
            });

            if (exRes.ok) {
              const data = (await exRes.json()) as {token?: string};

              if (data.token) {
                const statusResult = await fetchSnapshotWithToken(data.token, signal);

                if (statusResult === "ok") {
                  tokenRef.current = data.token;
                  writeStoredToken(data.token);

                  return data.token;
                }
              }
            }
          } catch (error) {
            if (signal?.aborted || isAbortError(error)) {
              return null;
            }
          }
        }

        // 2. Saved sessionStorage bearer token
        const savedToken = readStoredToken();

        if (savedToken) {
          const savedResult = await fetchSnapshotWithToken(savedToken, signal);

          if (savedResult === "ok") {
            tokenRef.current = savedToken;

            return savedToken;
          }
          if (savedResult === "unauthorized") {
            writeStoredToken("");
          }
        }

        // 3. Loopback local bootstrap (`POST /__proxyfor__/commerce/bootstrap/local`)
        try {
          const localRes = await fetch(`${COMMERCE_API_BASE}/bootstrap/local`, {
            body: "{}",
            headers: {
              "Content-Type": "application/json",
              "x-conduit-client": "dashboard",
            },
            method: "POST",
            signal,
          });

          if (localRes.ok) {
            const data = (await localRes.json()) as {token?: string};

            if (data.token) {
              const localResult = await fetchSnapshotWithToken(data.token, signal);

              if (localResult === "ok") {
                tokenRef.current = data.token;
                writeStoredToken(data.token);

                return data.token;
              }
            }
          }
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) {
            return null;
          }
          markDisconnected("Unable to reach local gateway");
        }

        return null;
      })();

      authInFlightRef.current = promise;
      try {
        return await promise;
      } finally {
        authInFlightRef.current = null;
      }
    },
    [fetchSnapshotWithToken, markDisconnected],
  );

  const refreshTraffics = useCallback(async (): Promise<void> => {
    if (IS_WWW) {
      await getWwwEngine().ensureLoaded();
      syncWwwEngineState();

      return;
    }
    try {
      const response = await fetch(`${PROXYFOR_BASE}/traffics`, {cache: "no-store"});

      if (!response.ok) {
        throw new Error(`Failed to fetch traffic (${response.status})`);
      }
      const list = (await response.json()) as TrafficHead[];

      markConnected();
      const nextMap = new Map<number, TrafficHead>();

      for (const item of list) {
        if (!item || typeof item.id !== "number") continue;
        const existing = trafficsMapRef.current.get(item.id);

        nextMap.set(item.id, existing ? {...existing, ...item} : item);
      }
      trafficsMapRef.current = nextMap;
      const sorted = Array.from(nextMap.values()).sort((a, b) => b.id - a.id);

      trafficsRef.current = sorted;
      setTraffics(sorted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to refresh traffic";

      markDisconnected(message);
    }
  }, [getWwwEngine, markConnected, markDisconnected, syncWwwEngineState]);

  const refresh = useCallback(async (): Promise<void> => {
    if (IS_WWW) {
      await getWwwEngine().ensureLoaded();
      syncWwwEngineState();

      return;
    }
    await Promise.all([
      fetchStatus(),
      refreshTraffics(),
      (async () => {
        const activeToken = tokenRef.current || (await ensureAuthenticated());

        if (!activeToken) return;
        const result = await fetchSnapshotWithToken(activeToken);

        if (result === "unauthorized") {
          tokenRef.current = "";
          writeStoredToken("");
          await ensureAuthenticated();
        }
      })(),
    ]);
  }, [
    ensureAuthenticated,
    fetchSnapshotWithToken,
    fetchStatus,
    getWwwEngine,
    refreshTraffics,
    syncWwwEngineState,
  ]);

  const fetchTrafficDetail = useCallback(
    async (id: number): Promise<TrafficDetail> => {
      if (IS_WWW) {
        return getWwwEngine().fetchTrafficDetail(id);
      }
      const response = await fetch(`${PROXYFOR_BASE}/traffic/${id}`, {cache: "no-store"});

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const message = text || `Failed to load traffic #${id} (${response.status})`;

      toast.danger(message);
      throw new Error(message);
    }

      return (await response.json()) as TrafficDetail;
    },
    [getWwwEngine],
  );

  const fetchInspectorState = useCallback(
    async (connectionId?: string | null, after?: number): Promise<InspectorState> => {
      if (IS_WWW) {
        return getWwwEngine().fetchInspectorState(connectionId, after);
      }
      const params = new URLSearchParams();

      if (connectionId) {
        params.set("connection_id", connectionId);
      }
      if (typeof after === "number" && Number.isFinite(after)) {
        params.set("after", String(Math.trunc(after)));
      }
      const query = params.toString();
      const url = `${COMMERCE_API_BASE}/inspector/state${query ? `?${query}` : ""}`;

      try {
        let bearer = tokenRef.current || (await ensureAuthenticated());

        if (!bearer) {
          const message = "401: Admin session unavailable";

          toast.danger(message);
          throw new Error(message);
        }

        let response = await fetch(url, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${bearer}`,
          },
        });

        if (response.status === 401 || response.status === 403) {
          tokenRef.current = "";
          writeStoredToken("");
          bearer = await ensureAuthenticated();
          if (bearer) {
            response = await fetch(url, {
              cache: "no-store",
              headers: {
                Authorization: `Bearer ${bearer}`,
              },
            });
          }
        }

        if (!response.ok) {
          const message = await parseErrorMessage(response);

          toast.danger(message);
          throw new Error(message);
        }

        const state = (await response.json()) as InspectorState;

        markConnected();

        return state;
      } catch (error) {
        if (error instanceof TypeError) {
          markDisconnected("Unable to reach local gateway");
        }
        throw error;
      }
    },
    [ensureAuthenticated, getWwwEngine, markConnected, markDisconnected],
  );

  const mutate = useCallback(
    async <T = unknown>(path: string, body: unknown): Promise<T> => {
      if (IS_WWW) {
        setBusy(true);
        try {
          return await getWwwEngine().mutate<T>(path, body);
        } finally {
          setBusy(false);
        }
      }
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;

      setBusy(true);
      try {
        let bearer = tokenRef.current || (await ensureAuthenticated());

        if (!bearer) {
          const message = "401: Admin session unavailable";

          toast.danger(message);
          throw new Error(message);
        }

        let response = await fetch(`${COMMERCE_API_BASE}${normalizedPath}`, {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });

        if (response.status === 401 || response.status === 403) {
          tokenRef.current = "";
          writeStoredToken("");
          bearer = await ensureAuthenticated();
          if (bearer) {
            response = await fetch(`${COMMERCE_API_BASE}${normalizedPath}`, {
              body: JSON.stringify(body),
              headers: {
                Authorization: `Bearer ${bearer}`,
                "Content-Type": "application/json",
              },
              method: "POST",
            });
          }
        }

        if (!response.ok) {
          const message = await parseErrorMessage(response);

          toast.danger(message);
          throw new Error(message);
        }

        const result = (await response.json()) as T;

        markConnected();
        if (bearer) {
          await fetchSnapshotWithToken(bearer);
        }

        return result;
      } catch (error) {
        if (error instanceof TypeError) {
          markDisconnected("Unable to reach local gateway");
        }
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [ensureAuthenticated, fetchSnapshotWithToken, getWwwEngine, markConnected, markDisconnected],
  );

  const exportHar = useCallback(() => {
    if (IS_WWW) {
      void getWwwEngine().exportHarAll().catch((error: unknown) => {
        toast.danger(error instanceof Error ? error.message : "Failed to export HAR");
      });

      return;
    }
    void (async () => {
      try {
        const response = await fetch(`${PROXYFOR_BASE}/traffics?har`, {cache: "no-store"});

        if (!response.ok) {
          const text = await response.text().catch(() => "");

          throw new Error(text || `Failed to export HAR (${response.status})`);
        }
        const harContent = await response.text();
        const blob = new Blob([harContent], {type: "application/json; charset=utf-8"});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

        link.href = url;
        link.download = `conduit-${stamp}.har`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast.success("Exported HAR archive");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to export HAR";

        toast.danger(message);
      }
    })();
  }, [getWwwEngine]);

  const downloadTrafficHar = useCallback(
    async (id: number): Promise<void> => {
      if (IS_WWW) {
        try {
          await getWwwEngine().downloadTrafficHar(id);
        } catch (error) {
          toast.danger(error instanceof Error ? error.message : "Failed to download packet HAR");
        }

        return;
      }
      try {
      const response = await fetch(`${PROXYFOR_BASE}/traffic/${id}?har`, {cache: "no-store"});

      if (!response.ok) {
        const text = await response.text().catch(() => "");

        throw new Error(text || `Failed to download packet HAR (${response.status})`);
      }
      const harContent = await response.text();
      const blob = new Blob([harContent], {type: "application/json; charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `traffic-${id}.har`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Downloaded packet HAR");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download packet HAR";

      toast.danger(message);
    }
  }, [getWwwEngine]);

  const copyTrafficCurl = useCallback(
    async (id: number): Promise<void> => {
      if (IS_WWW) {
        try {
          await getWwwEngine().copyTrafficCurl(id);
        } catch (error) {
          toast.danger(error instanceof Error ? error.message : "Failed to copy cURL command");
        }

        return;
      }
      try {
      const response = await fetch(`${PROXYFOR_BASE}/traffic/${id}?curl`, {cache: "no-store"});

      if (!response.ok) {
        const text = await response.text().catch(() => "");

        throw new Error(text || `Failed to export cURL (${response.status})`);
      }
      const curlCommand = await response.text();

      await navigator.clipboard.writeText(curlCommand);
      toast.success("Copied cURL command");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to copy cURL command";

      toast.danger(message);
    }
  }, [getWwwEngine]);

  // Unified live NDJSON traffic stream (`GET /__proxyfor__/subscribe/traffics`)
  useEffect(() => {
    if (IS_WWW) {
      const controller = new AbortController();

      void getWwwEngine()
        .ensureLoaded(controller.signal)
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !isAbortError(error)) {
            toast.danger(error instanceof Error ? error.message : "Failed to load demo session");
          }
        });

      return () => {
        controller.abort();
      };
    }
    const controller = new AbortController();

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`${PROXYFOR_BASE}/subscribe/traffics`, {
            cache: "no-store",
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            markDisconnected(`Traffic stream unavailable (${response.status})`);
          } else {
            markConnected();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (!controller.signal.aborted) {
              const {done, value} = await reader.read();

              if (done) {
                buffer += decoder.decode();
                if (buffer.trim()) {
                  ingestNdjsonLines(buffer.split("\n"));
                }
                break;
              }
              buffer += decoder.decode(value, {stream: true});
              const lines = buffer.split("\n");

              buffer = lines.pop() ?? "";
              if (lines.length > 0) {
                ingestNdjsonLines(lines);
              }
            }

            if (!controller.signal.aborted) {
              markDisconnected("Gateway connection lost");
            }
          }
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
          markDisconnected("Unable to reach local gateway");
        }

        await sleepWithAbort(2000, controller.signal);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [getWwwEngine, ingestNdjsonLines, markConnected, markDisconnected]);

  // Commerce status, seamless auth, snapshot hydration, and live SSE (`GET /__proxyfor__/commerce/events`)
  useEffect(() => {
    if (IS_WWW) {
      return;
    }
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSnapshotRefresh = () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        if (!controller.signal.aborted && tokenRef.current) {
          void fetchSnapshotWithToken(tokenRef.current, controller.signal);
        }
      }, 65);
    };

    void fetchStatus(controller.signal);
    const statusInterval = setInterval(() => {
      void fetchStatus(controller.signal);
    }, 10_000);

    void (async () => {
      while (!controller.signal.aborted) {
        const bearer = tokenRef.current || (await ensureAuthenticated(controller.signal));

        if (!bearer) {
          await sleepWithAbort(2500, controller.signal);
          continue;
        }

        try {
          const response = await fetch(`${COMMERCE_API_BASE}/events`, {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${bearer}`,
            },
            signal: controller.signal,
          });

          if (response.status === 401 || response.status === 403) {
            tokenRef.current = "";
            writeStoredToken("");
            await sleepWithAbort(500, controller.signal);
            continue;
          }

          if (!response.ok || !response.body) {
            await sleepWithAbort(2500, controller.signal);
            continue;
          }

          markConnected();
          const reader = response.body.getReader();

          while (!controller.signal.aborted) {
            const {done} = await reader.read();

            if (done) break;
            setEventsVersion((v) => v + 1);
            scheduleSnapshotRefresh();
          }
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) {
            return;
          }
          markDisconnected("Unable to reach local gateway");
        }

        await sleepWithAbort(2000, controller.signal);
      }
    })();

    return () => {
      controller.abort();
      clearInterval(statusInterval);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    };
  }, [ensureAuthenticated, fetchSnapshotWithToken, fetchStatus, markConnected, markDisconnected]);

  // Silent WebMCP tool registration
  useEffect(() => {
    if (typeof navigator === "undefined" || !("modelContext" in navigator)) {
      return;
    }
    type ModelContextLike = {
      registerTool?: (tool: {
        description: string;
        execute: () => Promise<unknown>;
        inputSchema: Record<string, unknown>;
        name: string;
      }) => void;
      unregisterTool?: (name: string) => void;
    };
    const modelContext = (navigator as Navigator & {modelContext?: ModelContextLike}).modelContext;

    try {
      modelContext?.registerTool?.({
        description: "Return live Conduit local HTTP and MCP gateway status and counters.",
        execute: async () => ({
          active_sessions: snapshotRef.current?.agent_sessions.length ?? 0,
          clef: statusRef.current?.clef ?? snapshotRef.current?.clef ?? null,
          connected: connectedRef.current,
          listen_addr: statusRef.current?.listen_addr ?? null,
          mcp_endpoint: statusRef.current?.mcp_endpoint ?? null,
          probe_policy: statusRef.current?.probe_policy ?? snapshotRef.current?.probe_policy ?? null,
          traffic_count: trafficsRef.current.length,
        }),
        inputSchema: {
          properties: {},
          type: "object",
        },
        name: "conduit_gateway_status",
      });
    } catch {
      // Silent WebMCP registration.
    }

    return () => {
      try {
        modelContext?.unregisterTool?.("conduit_gateway_status");
      } catch {
        // Silent cleanup.
      }
    };
  }, []);

  const value = useMemo<CoreStoreValue>(
    () => ({
      busy,
      connected,
      copyTrafficCurl,
      dashboardPeriod,
      dashboardTab,
      downloadTrafficHar,
      eventsVersion,
      exportHar,
      fetchInspectorState,
      fetchTrafficDetail,
      mutate,
      refresh,
      refreshTraffics,
      setDashboardPeriod,
      setDashboardTab,
      setTimeRange,
      snapshot,
      status,
      timeRange,
      traffics,
    }),
    [
      busy,
      connected,
      copyTrafficCurl,
      dashboardPeriod,
      dashboardTab,
      downloadTrafficHar,
      eventsVersion,
      exportHar,
      fetchInspectorState,
      fetchTrafficDetail,
      mutate,
      refresh,
      refreshTraffics,
      snapshot,
      status,
      timeRange,
      traffics,
    ],
  );

  return <CoreStoreContext.Provider value={value}>{children}</CoreStoreContext.Provider>;
}

export function useCoreStore(): CoreStoreValue {
  const ctx = useContext(CoreStoreContext);

  if (!ctx) {
    throw new Error("useCoreStore must be used inside <CoreProvider>");
  }

  return ctx;
}
