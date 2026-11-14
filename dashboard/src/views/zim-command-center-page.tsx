"use client";

import type {IssuedReceiptResponse} from "../lib/types";
import type {RpcEnvelopeResult} from "../widgets/inspector-result-view";
import type {MouseEvent as ReactMouseEvent} from "react";

import {PlanetEarth, PlugConnection, Rocket, ShieldCheck, Terminal} from "@gravity-ui/icons";
import {Button} from "@heroui/react";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {COMMERCE_API_BASE, useOutrider} from "../lib/outrider-store";
import {InspectorResultView} from "../widgets/inspector-result-view";

const DEFAULT_BUNDLE_ID = "observatory-evidence";
const DEFAULT_RIGHT_WIDTH = 380;
const MIN_RIGHT_WIDTH = 280;
const MAX_RIGHT_WIDTH = 560;

interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args?: Record<string, unknown>) => Promise<unknown>;
}

interface NavigatorModelContext {
  registerTool?: (tool: WebMcpToolDefinition) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
  provideContext?: (context: {tools: WebMcpToolDefinition[]}) => void | Promise<void>;
}

type NavigatorWithWebMcp = Navigator & {
  modelContext?: NavigatorModelContext;
  userAgentData?: {
    brands?: Array<{brand: string; version: string}>;
  };
};

type WebMcpDetectionState =
  | {kind: "active"; label: string; registeredTools: string[]}
  | {kind: "chromium-flag-off"; label: string; registeredTools: string[]}
  | {kind: "non-chromium"; label: string; registeredTools: string[]};

function detectChromiumBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithWebMcp;
  const brands = nav.userAgentData?.brands;

  if (Array.isArray(brands) && brands.length > 0) {
    return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge|Brave/i.test(b.brand));
  }
  const ua = nav.userAgent || "";

  return /(Chrome|Chromium|CriOS|Edg)\//.test(ua) && !/Firefox\//.test(ua);
}

function resolveTlsMcpTarget(mcpEndpoint?: string | null, fallbackPort?: string | null): string {
  if (mcpEndpoint) {
    try {
      const parsed = new URL(mcpEndpoint);

      if (parsed.port) {
        return `https://localhost:${parsed.port}/mcp`;
      }
    } catch {
      // Fall back to fallbackPort below.
    }
  }
  if (fallbackPort) {
    return `https://localhost:${fallbackPort}/mcp`;
  }

  return "https://localhost:8080/mcp";
}

function parseTextContentJson(envelope: RpcEnvelopeResult | null): Record<string, unknown> | null {
  const res = envelope?.result;

  if (!res || !Array.isArray(res.content)) return null;
  const first = res.content[0] as {type?: string; text?: string} | undefined;

  if (!first || typeof first.text !== "string") return null;
  try {
    const parsed = JSON.parse(first.text) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function ZimCommandCenterPage() {
  const router = useRouter();
  const {
    busy,
    mutate,
    openDialog,
    probePolicy,
    publicStatus,
    refresh,
    runLoopbackSortie,
    setSelectedSessionId,
    setStatusMessage,
    snapshot,
    token,
    unlocked,
  } = useOutrider();

  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [webMcpState, setWebMcpState] = useState<WebMcpDetectionState>({
    kind: "non-chromium",
    label: "Detecting Browser...",
    registeredTools: [],
  });

  // Live Human-as-Agent MCP 2026-07-28 connection state
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [agentSubject, setAgentSubject] = useState<string | null>(null);
  const [handshakeLatencyMs, setHandshakeLatencyMs] = useState<number | null>(null);
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [activeToolArgs, setActiveToolArgs] = useState<Record<string, unknown>>({});
  const [lastEnvelope, setLastEnvelope] = useState<RpcEnvelopeResult | null>(null);
  const [pendingQuoteState, setPendingQuoteState] = useState<string | null>(null);
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState<string | null>(null);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [clientPort, setClientPort] = useState<string | null>(null);

  const tlsTarget = useMemo(
    () => resolveTlsMcpTarget(publicStatus?.mcp_endpoint, clientPort),
    [clientPort, publicStatus?.mcp_endpoint],
  );

  const connectionIdRef = useRef<string | null>(null);

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  const inspectorPost = useCallback(
    async <T = unknown>(path: string, body: unknown): Promise<T> => {
      if (!unlocked || !token) {
        throw new Error("401: Unlock the gateway first to issue MCP wire frames.");
      }
      const response = await fetch(`${COMMERCE_API_BASE}${path}`, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        let message = `${response.status}: ${response.statusText || "Request failed"}`;

        try {
          const parsed = (await response.json()) as {error?: string};

          if (parsed.error) message = `${response.status}: ${parsed.error}`;
        } catch {
          // Keep status message fallback.
        }
        throw new Error(message);
      }

      return (await response.json()) as T;
    },
    [token, unlocked],
  );

  const handleHandshake = useCallback(async () => {
    setConsoleError(null);
    setStepBusy("handshake");
    try {
      if (connectionIdRef.current) {
        try {
          await inspectorPost("/inspector/disconnect", {
            connection_id: connectionIdRef.current,
          });
        } catch {
          // Previous connection may already be closed.
        }
      }

      const sessionSecret = crypto.randomUUID();
      const connected = await inspectorPost<{
        connection_id: string;
        handshake_ms: number;
      }>("/inspector/connect", {
        headers: {"outrider-session-id": sessionSecret},
        label: "Zim Earth Study Agent",
        lifecycle: "2026-07-28",
        target: tlsTarget,
        transport: "http",
      });

      setConnectionId(connected.connection_id);
      setHandshakeLatencyMs(connected.handshake_ms);
      setPendingQuoteState(null);
      setLastIssuedToken(null);

      // Query `outrider_fingerprint_me` (or receive auto-probe MRTR challenge if policy == "auto").
      const fpArgs: Record<string, unknown> = {};
      const fpEnv = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
        connection_id: connected.connection_id,
        method: "tools/call",
        params: {arguments: fpArgs, name: "outrider_fingerprint_me"},
      });

      setActiveToolName("outrider_fingerprint_me");
      setActiveToolArgs(fpArgs);
      setLastEnvelope(fpEnv);

      const parsedText = parseTextContentJson(fpEnv);
      const discoveredSession =
        typeof parsedText?.session_id === "string" ? parsedText.session_id : null;

      await refresh();
      if (discoveredSession) {
        setAgentSubject(discoveredSession);
        setSelectedSessionId(discoveredSession);
      }
      setStatusMessage(`Connected Earth Study Agent over ${tlsTarget}.`);

      return {
        connection_id: connected.connection_id,
        handshake_ms: connected.handshake_ms,
        session_id: discoveredSession,
        tls_target: tlsTarget,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Agent TLS handshake failed.";

      setConsoleError(msg);
      setStatusMessage(msg, true);
      throw error;
    } finally {
      setStepBusy(null);
    }
  }, [inspectorPost, refresh, setSelectedSessionId, setStatusMessage, tlsTarget]);

  const handleTriggerProbe = useCallback(async () => {
    if (!connectionId) {
      setConsoleError("Complete Step 1 (Agent Handshake) first.");

      return;
    }
    setConsoleError(null);
    setStepBusy("probe");
    try {
      const args: Record<string, unknown> = {};
      const env = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
        connection_id: connectionId,
        method: "tools/call",
        params: {arguments: args, name: "outrider_run_probe"},
      });

      setActiveToolName("outrider_run_probe");
      setActiveToolArgs(args);
      setLastEnvelope(env);
      await refresh();
      setStatusMessage("Gateway capability probe frame received.");

      return env;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Capability probe request failed.";

      setConsoleError(msg);
      setStatusMessage(msg, true);
      throw error;
    } finally {
      setStepBusy(null);
    }
  }, [connectionId, inspectorPost, refresh, setStatusMessage]);

  const handleResumeMrtr = useCallback(
    async (extraParams: Record<string, unknown>) => {
      if (!connectionId || !activeToolName) return;
      setConsoleError(null);
      setStepBusy("resume");
      try {
        const env = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
          connection_id: connectionId,
          method: "tools/call",
          params: {
            arguments: activeToolArgs,
            name: activeToolName,
            ...extraParams,
          },
        });

        setLastEnvelope(env);
        const parsed = parseTextContentJson(env);

        if (typeof parsed?.session_id === "string") {
          setAgentSubject(parsed.session_id);
          setSelectedSessionId(parsed.session_id);
        }
        if (
          env.result?.resultType !== "input_required" &&
          activeToolName === "outrider_checkout_bundle"
        ) {
          setPendingQuoteState(null);
        }
        await refresh();
        setStatusMessage(`Completed MRTR round-trip for ${activeToolName}.`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "MRTR resume failed.";

        setConsoleError(msg);
        setStatusMessage(msg, true);
        throw error;
      } finally {
        setStepBusy(null);
      }
    },
    [activeToolArgs, activeToolName, connectionId, inspectorPost, refresh, setSelectedSessionId, setStatusMessage],
  );

  const handleQuickCompliantProbeReply = useCallback(async () => {
    const res = lastEnvelope?.result;
    const reqState = res?.requestState;
    const inputReqs = (res?.inputRequests ?? {}) as Record<string, unknown>;

    if (!reqState || !("capability_probe" in inputReqs)) {
      setConsoleError("No pending capability_probe MRTR challenge in the current envelope.");

      return;
    }

    const inputResponses: Record<string, unknown> = {
      capability_probe: {
        content: {text: '{"ack":"outrider"}', type: "text"},
        model: "zim-earth-agent-1.0",
        role: "assistant",
        stopReason: "endTurn",
      },
    };

    if ("preferences" in inputReqs) {
      inputResponses.preferences = {
        action: "accept",
        content: {
          bundle_preference: DEFAULT_BUNDLE_ID,
          sla_tier: "irken-priority",
        },
      };
    }

    await handleResumeMrtr({
      inputResponses,
      requestState: reqState,
    });
  }, [handleResumeMrtr, lastEnvelope]);

  const handleRequestQuote = useCallback(async () => {
    if (!connectionId) {
      setConsoleError("Complete Step 1 (Agent Handshake) first.");

      return;
    }
    setConsoleError(null);
    setStepBusy("quote");
    try {
      const hasStarterBundle = (snapshot?.bundles ?? []).some(
        (b) => b.bundle_id === DEFAULT_BUNDLE_ID,
      );

      if (!hasStarterBundle) {
        await mutate("/bundles/put", {
          bundle_id: DEFAULT_BUNDLE_ID,
          items: ["outrider_session_evidence"],
          rules: {},
          title: "Observatory Session Evidence",
        });
      }

      const checkoutArgs = {bundle_id: DEFAULT_BUNDLE_ID, execute: true};
      const env = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
        connection_id: connectionId,
        method: "tools/call",
        params: {
          arguments: checkoutArgs,
          name: "outrider_checkout_bundle",
        },
      });

      setActiveToolName("outrider_checkout_bundle");
      setActiveToolArgs(checkoutArgs);
      setLastEnvelope(env);

      const reqState =
        typeof env.result?.requestState === "string" ? env.result.requestState : null;

      setPendingQuoteState(reqState);
      await refresh();
      setStatusMessage("Received sealed MRTR quote from Commerce Gateway.");

      return env;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Bundle quote request failed.";

      setConsoleError(msg);
      setStatusMessage(msg, true);
      throw error;
    } finally {
      setStepBusy(null);
    }
  }, [connectionId, inspectorPost, mutate, refresh, setStatusMessage, snapshot]);

  const handleMintAndRedeemReceipt = useCallback(async () => {
    if (!connectionId) {
      setConsoleError("Complete Step 1 (Agent Handshake) first.");

      return;
    }
    const targetSubject = agentSubject ?? snapshot?.agent_sessions[0]?.subject ?? null;

    if (!targetSubject) {
      setConsoleError("No agent session subject recorded yet.");

      return;
    }

    setConsoleError(null);
    setStepBusy("redeem");
    try {
      const issued = await mutate<IssuedReceiptResponse>("/receipts/issue", {
        bundle_id: DEFAULT_BUNDLE_ID,
        expires_at_unix: Math.floor(Date.now() / 1000) + 3600,
        max_calls: 5,
        subject: targetSubject,
      });

      setLastIssuedToken(issued.token);

      const quoteState =
        pendingQuoteState ??
        (typeof lastEnvelope?.result?.requestState === "string"
          ? lastEnvelope.result.requestState
          : null);

      const checkoutArgs = {bundle_id: DEFAULT_BUNDLE_ID, execute: true};
      const env = await inspectorPost<RpcEnvelopeResult>("/inspector/request", {
        connection_id: connectionId,
        method: "tools/call",
        params: {
          arguments: checkoutArgs,
          name: "outrider_checkout_bundle",
          ...(quoteState
            ? {
                inputResponses: {
                  capability_receipt: {
                    action: "accept",
                    content: {receipt: issued.token},
                  },
                },
                requestState: quoteState,
              }
            : {
                _meta: {"outrider/receipt": issued.token},
              }),
        },
      });

      setActiveToolName("outrider_checkout_bundle");
      setActiveToolArgs(checkoutArgs);
      setLastEnvelope(env);
      setPendingQuoteState(null);
      await refresh();
      setStatusMessage("Ed25519 receipt verified & bundle executed over MCP 2026-07-28.");

      return env;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Receipt mint/redemption failed.";

      setConsoleError(msg);
      setStatusMessage(msg, true);
      throw error;
    } finally {
      setStepBusy(null);
    }
  }, [
    agentSubject,
    connectionId,
    inspectorPost,
    lastEnvelope,
    mutate,
    pendingQuoteState,
    refresh,
    setStatusMessage,
    snapshot,
  ]);

  const handleAutomatedSortie = useCallback(async () => {
    setConsoleError(null);
    setStepBusy("sortie");
    try {
      const res = await runLoopbackSortie("Zim Automated Probe Drone");

      setAgentSubject(res.subject);
      setStatusMessage(
        `Completed TLS 1.3 + MCP 2026-07-28 sortie (${res.session_id.slice(0, 8)}).`,
      );

      return res;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Automated TLS sortie failed.";

      setConsoleError(msg);
      setStatusMessage(msg, true);
      throw error;
    } finally {
      setStepBusy(null);
    }
  }, [runLoopbackSortie, setStatusMessage]);

  // Truthfully detect Chromium + `navigator.modelContext` and register live WebMCP tools when supported
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorWithWebMcp;
    const isChromium = detectChromiumBrowser();
    const mc = nav.modelContext;

    const tools: WebMcpToolDefinition[] = [
      {
        description:
          "Establish a live Outrider TLS 1.3 + MCP 2026-07-28 buyer agent session on localhost.",
        execute: async () => handleHandshake(),
        inputSchema: {properties: {}, type: "object"},
        name: "outrider_zim_handshake",
      },
      {
        description:
          "Trigger Outrider's disclosed MCP 2026-07-28 capability probe for the active session.",
        execute: async () => handleTriggerProbe(),
        inputSchema: {properties: {}, type: "object"},
        name: "outrider_zim_probe_agent",
      },
      {
        description:
          "Request a sealed MRTR capability quote for the Observatory Session Evidence bundle.",
        execute: async () => handleRequestQuote(),
        inputSchema: {properties: {}, type: "object"},
        name: "outrider_zim_checkout_quote",
      },
      {
        description:
          "Execute an automated loopback TLS 1.3 + MCP 2026-07-28 sortie with Ed25519 receipt redemption.",
        execute: async () => handleAutomatedSortie(),
        inputSchema: {properties: {}, type: "object"},
        name: "outrider_zim_run_tls_sortie",
      },
    ];

    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (window.location.port) {
        setClientPort(window.location.port);
      }

      if (
        !mc ||
        (typeof mc.registerTool !== "function" && typeof mc.provideContext !== "function")
      ) {
        setWebMcpState(
          isChromium
            ? {
                kind: "chromium-flag-off",
                label: "Chromium (WebMCP Flag Off)",
                registeredTools: [],
              }
            : {
                kind: "non-chromium",
                label: "Non-Chromium Browser",
                registeredTools: [],
              },
        );

        return;
      }

      try {
        if (typeof mc.registerTool === "function") {
          for (const tool of tools) {
            if (typeof mc.unregisterTool === "function") {
              try {
                await mc.unregisterTool(tool.name);
              } catch {
                // Ignore if tool was not previously registered.
              }
            }
            await mc.registerTool(tool);
          }
        } else if (typeof mc.provideContext === "function") {
          await mc.provideContext({tools});
        }
        if (!cancelled) {
          setWebMcpState({
            kind: "active",
            label: "WebMCP Active (Chromium)",
            registeredTools: tools.map((t) => t.name),
          });
        }
      } catch {
        if (!cancelled) {
          setWebMcpState({
            kind: isChromium ? "chromium-flag-off" : "non-chromium",
            label: isChromium ? "Chromium (WebMCP Registration Failed)" : "Non-Chromium Browser",
            registeredTools: [],
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (mc && typeof mc.unregisterTool === "function") {
        for (const tool of tools) {
          try {
            void mc.unregisterTool(tool.name);
          } catch {
            // Ignore teardown errors.
          }
        }
      }
    };
  }, [handleAutomatedSortie, handleHandshake, handleRequestQuote, handleTriggerProbe]);

  const startResizeRight = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = rightWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const clamped = Math.min(MAX_RIGHT_WIDTH, Math.max(MIN_RIGHT_WIDTH, startW + delta));

      setRightWidth(clamped);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const activeSession = useMemo(() => {
    if (!snapshot) return null;
    if (agentSubject) {
      return (
        snapshot.agent_sessions.find(
          (s) => s.session_id === agentSubject || s.subject === agentSubject,
        ) ?? snapshot.agent_sessions[0] ?? null
      );
    }

    return snapshot.agent_sessions[0] ?? null;
  }, [agentSubject, snapshot]);

  const sessionObservations = useMemo(() => {
    if (!snapshot) return [];
    if (!activeSession) return snapshot.fingerprint_observations.slice(0, 6);

    return snapshot.fingerprint_observations.filter(
      (obs) => obs.session_id === activeSession.session_id,
    );
  }, [activeSession, snapshot]);

  const hasPendingProbeChallenge = useMemo(() => {
    const reqs = (lastEnvelope?.result?.inputRequests ?? {}) as Record<string, unknown>;

    return lastEnvelope?.result?.resultType === "input_required" && "capability_probe" in reqs;
  }, [lastEnvelope]);

  const hasPendingReceiptQuote = useMemo(() => {
    const reqs = (lastEnvelope?.result?.inputRequests ?? {}) as Record<string, unknown>;

    return lastEnvelope?.result?.resultType === "input_required" && "capability_receipt" in reqs;
  }, [lastEnvelope]);

  const isAnyBusy = busy || stepBusy !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 pb-8 pt-3">
      {/* Top Action Rail (Geometry A single-row locked bar) */}
      <div
        aria-label="Command Center action rail"
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#27272a] bg-[#0a0a0f] px-3.5 py-2.5 text-[#f4f4f5]"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <PlanetEarth aria-hidden="true" className="size-4 shrink-0 text-[#ec008c]" />
          <span className="truncate font-mono text-xs font-semibold tracking-wide text-[#f4f4f5]">
            ZIM HOME STUDY // EARTH AGENT OBSERVATORY
          </span>
          <span
            className={
              webMcpState.kind === "active"
                ? "rounded-full border border-[#a3e635]/50 bg-[#a3e635]/15 px-2 py-0.5 font-mono text-xs text-[#bef264]"
                : "rounded-full border border-[#ec008c]/50 bg-[#ec008c]/15 px-2 py-0.5 font-mono text-xs text-[#f9a8d4]"
            }
            id="webmcp-status-badge"
          >
            {webMcpState.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            isDisabled={!unlocked || isAnyBusy}
            size="sm"
            onPress={() => void handleAutomatedSortie()}
          >
            <Rocket aria-hidden="true" className="size-3.5" />
            {stepBusy === "sortie" ? "Running TLS Sortie..." : "Launch 1-Click TLS Sortie"}
          </Button>

          <Button
            isDisabled={!unlocked || isAnyBusy}
            size="sm"
            variant="secondary"
            onPress={() => openDialog("connect-local-agents")}
          >
            <PlugConnection aria-hidden="true" className="size-3.5" />
            Scan Claude &amp; Codex
          </Button>

          <Button size="sm" variant="tertiary" onPress={() => router.push("/")}>
            View Panel 1 ({snapshot?.agent_sessions.length ?? 0})
          </Button>
        </div>
      </div>

      {/* Main Split Workbench */}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:gap-0">
        {/* Left/Center Console: Human Plays the Autonomous Buyer Agent */}
        <section
          aria-label="Human-as-Agent MCP Mission Console"
          className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl border border-[#27272a] bg-[#0a0a0f] p-4 text-[#f4f4f5]"
          id="zim-mission-deck"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#27272a] pb-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-sm font-semibold text-[#f4f4f5]">
                Act as the Autonomous Buyer Agent over Live MCP 2026-07-28
              </h2>
              <p className="text-xs text-[#a1a1aa]">
                Target listener: <code className="font-mono text-[#a3e635]">{tlsTarget}</code>.
                Every action transmits real TLS 1.3 + JSON-RPC wire frames into Outrider&apos;s
                SQLite ledger.
              </p>
            </div>
            {handshakeLatencyMs !== null ? (
              <span className="rounded-md border border-[#27272a] bg-[#12121a] px-2 py-1 font-mono text-xs text-[#a3e635]">
                TLS Handshake {handshakeLatencyMs} ms
              </span>
            ) : null}
          </div>

          {/* Truthful Browser WebMCP Disclosure */}
          <div
            aria-label="Browser WebMCP capability status"
            className="flex flex-col gap-1.5 rounded-lg border border-[#27272a] bg-[#12121a] p-3 text-xs"
            id="webmcp-disclosure"
          >
            {webMcpState.kind === "active" ? (
              <>
                <div className="font-medium text-[#bef264]">
                  Chromium navigator.modelContext detected — {webMcpState.registeredTools.length}{" "}
                  WebMCP tools registered live in this tab
                </div>
                <div className="font-mono text-xs text-[#a1a1aa]">
                  {webMcpState.registeredTools.join(" · ")}
                </div>
              </>
            ) : webMcpState.kind === "chromium-flag-off" ? (
              <>
                <div className="font-medium text-[#f9a8d4]">
                  Chromium detected, but navigator.modelContext is not enabled in this browser
                </div>
                <p className="text-[#a1a1aa]">
                  Enable{" "}
                  <code className="font-mono text-[#f4f4f5]">
                    chrome://flags/#enable-experimental-web-platform-features
                  </code>{" "}
                  to expose browser-native WebMCP tools, or use the direct MCP 2026-07-28 controls
                  and 1-Click TLS Sortie below immediately.
                </p>
              </>
            ) : (
              <>
                <div className="font-medium text-[#f9a8d4]">
                  Browser-native WebMCP (navigator.modelContext) requires a Chromium browser
                </div>
                <p className="text-[#a1a1aa]">
                  Safari and Firefox do not expose{" "}
                  <code className="font-mono text-[#f4f4f5]">navigator.modelContext</code>. Use the
                  direct Human-as-Agent MCP console below or{" "}
                  <strong className="text-[#a3e635]">Launch 1-Click TLS Sortie</strong> to generate
                  full TLS JA4 + MCP 2026-07-28 traffic in this browser.
                </p>
              </>
            )}
          </div>

          {/* 4-Step Interactive Agent Protocol Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Step 1 */}
            <div className="flex flex-col justify-between gap-2.5 rounded-lg border border-[#27272a] bg-[#12121a] p-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#f4f4f5]">
                    1. TLS + MCP 2026-07-28 Handshake
                  </span>
                  <span
                    className={
                      connectionId
                        ? "rounded-full border border-[#a3e635]/40 bg-[#a3e635]/15 px-2 py-0.5 font-mono text-xs text-[#bef264]"
                        : "rounded-full border border-[#27272a] px-2 py-0.5 font-mono text-xs text-[#a1a1aa]"
                    }
                  >
                    {connectionId ? "Connected" : "Idle"}
                  </span>
                </div>
                <p className="text-xs text-[#a1a1aa]">
                  Dial <code className="font-mono">{tlsTarget}</code> via{" "}
                  <code className="font-mono">server/discover</code>, capturing raw TLS ClientHello
                  JA4 and HTTP/1.1 header order.
                </p>
              </div>
              <div>
                <Button
                  isDisabled={!unlocked || isAnyBusy}
                  size="sm"
                  onPress={() => void handleHandshake()}
                >
                  <Terminal aria-hidden="true" className="size-3.5" />
                  {stepBusy === "handshake"
                    ? "Connecting..."
                    : connectionId
                      ? "Reconnect New Session"
                      : "1. Handshake as Agent"}
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col justify-between gap-2.5 rounded-lg border border-[#27272a] bg-[#12121a] p-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#f4f4f5]">
                    2. Gateway Capability Probe
                  </span>
                  <span className="rounded-full border border-[#27272a] px-2 py-0.5 font-mono text-xs text-[#a1a1aa]">
                    policy: {probePolicy}
                  </span>
                </div>
                <p className="text-xs text-[#a1a1aa]">
                  Request or answer Outrider&apos;s disclosed{" "}
                  <code className="font-mono">sampling/createMessage</code> +{" "}
                  <code className="font-mono">elicitation/create</code> MRTR challenge.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  isDisabled={!unlocked || !connectionId || isAnyBusy || probePolicy === "off"}
                  size="sm"
                  variant="secondary"
                  onPress={() => void handleTriggerProbe()}
                >
                  {stepBusy === "probe" ? "Requesting..." : "2. Trigger Probe"}
                </Button>
                {hasPendingProbeChallenge ? (
                  <Button
                    isDisabled={isAnyBusy}
                    size="sm"
                    onPress={() => void handleQuickCompliantProbeReply()}
                  >
                    Transmit Compliant Reply
                  </Button>
                ) : null}
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col justify-between gap-2.5 rounded-lg border border-[#27272a] bg-[#12121a] p-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#f4f4f5]">
                    3. Call Priced Bundle (No Receipt)
                  </span>
                  <span
                    className={
                      hasPendingReceiptQuote || pendingQuoteState
                        ? "rounded-full border border-[#ec008c]/50 bg-[#ec008c]/15 px-2 py-0.5 font-mono text-xs text-[#f9a8d4]"
                        : "rounded-full border border-[#27272a] px-2 py-0.5 font-mono text-xs text-[#a1a1aa]"
                    }
                  >
                    {hasPendingReceiptQuote || pendingQuoteState ? "Quote Sealed" : "Ready"}
                  </span>
                </div>
                <p className="text-xs text-[#a1a1aa]">
                  Invoke <code className="font-mono">outrider_checkout_bundle</code> without an
                  entitlement to trigger an AEAD-sealed MRTR quote.
                </p>
              </div>
              <div>
                <Button
                  isDisabled={!unlocked || !connectionId || isAnyBusy}
                  size="sm"
                  variant="secondary"
                  onPress={() => void handleRequestQuote()}
                >
                  {stepBusy === "quote" ? "Requesting Quote..." : "3. Request Bundle Quote"}
                </Button>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex flex-col justify-between gap-2.5 rounded-lg border border-[#27272a] bg-[#12121a] p-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-[#f4f4f5]">
                    4. Mint &amp; Redeem Ed25519 Receipt
                  </span>
                  <span
                    className={
                      activeSession?.state === "Entitled"
                        ? "rounded-full border border-[#a3e635]/40 bg-[#a3e635]/15 px-2 py-0.5 font-mono text-xs text-[#bef264]"
                        : "rounded-full border border-[#27272a] px-2 py-0.5 font-mono text-xs text-[#a1a1aa]"
                    }
                  >
                    {activeSession?.state ?? "Unentitled"}
                  </span>
                </div>
                <p className="text-xs text-[#a1a1aa]">
                  Sign an RFC 8785 JCS Ed25519 receipt for{" "}
                  <code className="font-mono">{DEFAULT_BUNDLE_ID}</code> and resume checkout to
                  unlock execution.
                </p>
              </div>
              <div>
                <Button
                  isDisabled={!unlocked || !connectionId || isAnyBusy}
                  size="sm"
                  onPress={() => void handleMintAndRedeemReceipt()}
                >
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                  {stepBusy === "redeem" ? "Redeeming..." : "4. Mint & Redeem Receipt"}
                </Button>
              </div>
            </div>
          </div>

          {consoleError ? (
            <div
              className="rounded-lg border border-[#f43f5e]/50 bg-[#f43f5e]/10 p-2.5 font-mono text-xs text-[#fda4af]"
              role="alert"
            >
              {consoleError}
            </div>
          ) : null}

          {/* Live Wire Envelope & Interactive MRTR Editor */}
          <div
            aria-label="Latest MCP wire envelope"
            className="flex flex-col gap-2 rounded-lg border border-[#27272a] bg-[#12121a] p-3"
            id="zim-wire-envelope"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-[#f4f4f5]">
                Active Wire Envelope {activeToolName ? `· ${activeToolName}` : ""}
              </span>
              {lastIssuedToken ? (
                <span className="truncate font-mono text-xs text-[#a3e635]">
                  Signed token: {lastIssuedToken.slice(0, 28)}...
                </span>
              ) : null}
            </div>
            {lastEnvelope ? (
              <InspectorResultView
                envelope={lastEnvelope}
                roots={[]}
                onResume={handleResumeMrtr}
                onValidationError={(msg) => setConsoleError(msg)}
              />
            ) : (
              <p className="font-mono text-xs text-[#a1a1aa]">
                No wire frame sent in this console yet. Click &ldquo;1. Handshake as Agent&rdquo; or
                &ldquo;Launch 1-Click TLS Sortie&rdquo; to transmit live MCP 2026-07-28 traffic.
              </p>
            )}
          </div>
        </section>

        {/* Draggable Split Divider */}
        <div
          aria-label="Resize command center telemetry pane"
          aria-orientation="vertical"
          className="hidden w-2.5 shrink-0 cursor-ew-resize self-stretch lg:flex lg:items-center lg:justify-center"
          role="separator"
          tabIndex={0}
          onDoubleClick={() => setRightWidth(DEFAULT_RIGHT_WIDTH)}
          onMouseDown={startResizeRight}
        >
          <span className="bg-border h-12 w-0.5 rounded-full" />
        </div>

        {/* Right Pane: Real-Time Persisted SQLite Telemetry */}
        <aside
          aria-label="Persisted observatory telemetry"
          className="border-border bg-surface flex w-full shrink-0 flex-col gap-3 rounded-xl border p-4 lg:w-[var(--zim-right-w)]"
          id="zim-live-telemetry"
          style={{"--zim-right-w": `${rightWidth}px`} as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-foreground text-sm font-semibold">SQLite Observatory Ledger</h2>
            <span className="border-border bg-background text-muted rounded-full border px-2 py-0.5 font-mono text-xs tabular-nums">
              {snapshot?.agent_sessions.length ?? 0} sessions
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="border-border bg-background rounded-lg border p-2.5">
              <dt className="text-muted">Fingerprints</dt>
              <dd
                className="text-foreground mt-0.5 font-mono text-sm font-semibold tabular-nums"
                data-testid="zim-count-fingerprints"
              >
                {snapshot?.fingerprint_observations.length ?? 0}
              </dd>
            </div>
            <div className="border-border bg-background rounded-lg border p-2.5">
              <dt className="text-muted">Probe Runs</dt>
              <dd
                className="text-foreground mt-0.5 font-mono text-sm font-semibold tabular-nums"
                data-testid="zim-count-probes"
              >
                {snapshot?.probe_runs.length ?? 0}
              </dd>
            </div>
            <div className="border-border bg-background rounded-lg border p-2.5">
              <dt className="text-muted">MRTR Quotes</dt>
              <dd
                className="text-foreground mt-0.5 font-mono text-sm font-semibold tabular-nums"
                data-testid="zim-count-quotes"
              >
                {snapshot?.mrtr_quotes.length ?? 0}
              </dd>
            </div>
            <div className="border-border bg-background rounded-lg border p-2.5">
              <dt className="text-muted">Redemptions</dt>
              <dd
                className="text-foreground mt-0.5 font-mono text-sm font-semibold tabular-nums"
                data-testid="zim-count-redemptions"
              >
                {snapshot?.receipt_redemptions.length ?? 0}
              </dd>
            </div>
          </dl>

          {activeSession ? (
            <div className="border-border bg-background flex flex-col gap-1.5 rounded-lg border p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground truncate font-medium">
                  {activeSession.client_config.clientInfo?.name ?? "MCP Client"}
                </span>
                <span className="border-border bg-surface text-foreground shrink-0 rounded-full border px-2 py-0.5 font-mono text-xs">
                  {activeSession.state}
                </span>
              </div>
              <div className="text-muted truncate font-mono text-xs">
                {activeSession.session_id}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <h3 className="text-foreground text-xs font-semibold">
              Captured Wire Observations ({sessionObservations.length})
            </h3>
            {sessionObservations.length === 0 ? (
              <p className="text-muted text-xs">
                No passive TLS/HTTP/MCP observations persisted yet.
              </p>
            ) : (
              <ul
                aria-label="Captured fingerprint observations"
                className="flex max-h-72 flex-col gap-1.5 overflow-auto"
              >
                {sessionObservations.slice(0, 8).map((obs) => {
                  const ev =
                    obs.evidence && typeof obs.evidence === "object"
                      ? (obs.evidence as Record<string, unknown>)
                      : {};
                  const detail =
                    typeof ev.ja4 === "string"
                      ? ev.ja4
                      : typeof ev.cipher_suite === "string"
                        ? ev.cipher_suite
                        : Array.isArray(ev.names)
                          ? `${ev.names.length} HTTP headers`
                          : typeof ev.user_agent === "string"
                            ? ev.user_agent
                            : "captured";

                  return (
                    <li
                      key={obs.observation_id}
                      className="border-border bg-background flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-xs"
                    >
                      <span className="text-foreground shrink-0 font-medium">{obs.kind}</span>
                      <span className="text-muted min-w-0 truncate">{detail}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
