import type {
  Bundle,
  CapabilityReceiptPayload,
  CapabilityReceiptRow,
  CommerceSnapshot,
  CommerceStatus,
  InspectorConnection,
  InspectorMessage,
  InspectorState,
  IssuedReceiptResponse,
  ProbePolicy,
  TrafficBody,
  TrafficDetail,
  TrafficHead,
} from "./types";

import {toast} from "@heroui/react";

import {withWwwBasePath} from "./www-base-path";

interface LiveSessionBundle {
  binaryVersion: string;
  capturedAtIso: string;
  commerceSnapshot: CommerceSnapshot;
  harSha256: string;
  inspectorState: InspectorState;
  trafficDetailsById: Record<string, TrafficDetail>;
  traffics: TrafficHead[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Invalid numeric value");
    }

    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJcs(item === undefined ? null : item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec)
      .filter((k) => rec[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJcs(rec[k])}`).join(",")}}`;
  }

  throw new TypeError("Unsupported value");
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBufferBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(input.byteLength);
  const copy = new Uint8Array(buffer);

  copy.set(input);

  return copy;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export class WwwDemoEngine {
  private traffics: TrafficHead[] = [];
  private detailsById: Record<string, TrafficDetail> = {};
  private snapshot: CommerceSnapshot | null = null;
  private status: CommerceStatus | null = null;
  private inspector: InspectorState = {connections: [], messages: [], server_requests: []};
  private keyPair: CryptoKeyPair | null = null;
  private publicKeyB64 = "";
  private loadPromise: Promise<void> | null = null;
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  async ensureLoaded(signal?: AbortSignal): Promise<void> {
    if (this.snapshot) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const res = await fetch(withWwwBasePath("/demo/live-session-bundle.json"), {
          cache: "no-store",
          signal,
        });

        if (!res.ok) {
          throw new Error(`Failed to load demo session (${res.status})`);
        }
        const parsed = (await res.json()) as LiveSessionBundle;

        this.traffics = [...parsed.traffics].sort((a, b) => b.id - a.id);
        this.detailsById = {...parsed.trafficDetailsById};
        this.snapshot = structuredClone(parsed.commerceSnapshot);
        this.publicKeyB64 = parsed.commerceSnapshot.public_key;

        const conns = parsed.inspectorState.connections.map((c, idx) =>
          idx === 0 ? {...c, live: true, status: "Connected"} : {...c},
        );

        this.inspector = {
          connections: conns,
          messages: [...parsed.inspectorState.messages],
          server_requests: [...parsed.inspectorState.server_requests],
        };

        const listenHost = conns[0]?.target
          ? conns[0].target.replace(/^https?:\/\//, "").replace(/\/mcp\/?$/, "")
          : "127.0.0.1:8080";

        this.status = {
          admin_allow_remote: false,
          clef: parsed.commerceSnapshot.clef,
          listen_addr: listenHost,
          mcp_endpoint: `http://${listenHost}/mcp`,
          probe_policy: parsed.commerceSnapshot.probe_policy,
        };
        this.onChange();
      })();
    }

    return this.loadPromise;
  }

  getState(): {
    snapshot: CommerceSnapshot | null;
    status: CommerceStatus | null;
    traffics: TrafficHead[];
  } {
    return {
      snapshot: this.snapshot,
      status: this.status,
      traffics: this.traffics,
    };
  }

  async fetchTrafficDetail(id: number): Promise<TrafficDetail> {
    await this.ensureLoaded();
    const detail = this.detailsById[String(id)];

    if (!detail) {
      const msg = `Traffic #${id} not found`;

      toast.danger(msg);
      throw new Error(msg);
    }

    return detail;
  }

  async fetchInspectorState(
    _connectionId?: string | null,
    after = 0,
  ): Promise<InspectorState> {
    await this.ensureLoaded();
    const filteredMessages = this.inspector.messages.filter((msg) => msg.message_id > after);

    return {
      connections: [...this.inspector.connections],
      messages: filteredMessages,
      server_requests: [...this.inspector.server_requests],
    };
  }

  private async ensureSigningKey(): Promise<{pair: CryptoKeyPair; pubB64: string}> {
    if (this.keyPair && this.publicKeyB64) {
      return {pair: this.keyPair, pubB64: this.publicKeyB64};
    }
    const generated = (await window.crypto.subtle.generateKey(
      {name: "Ed25519"},
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const rawPub = new Uint8Array(await window.crypto.subtle.exportKey("raw", generated.publicKey));
    const pubB64 = encodeBase64Url(rawPub);

    this.keyPair = generated;
    this.publicKeyB64 = pubB64;

    return {pair: generated, pubB64};
  }

  private recordSyntheticMcpExchange(method: string, reqObj: unknown, resObj: unknown): void {
    const nextId = this.traffics.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const nowMs = Date.now();
    const targetUri = this.status?.mcp_endpoint ?? "http://127.0.0.1:8080/mcp";
    const reqJson = JSON.stringify(reqObj);
    const resJson = JSON.stringify(resObj);
    const reqBytes = new TextEncoder().encode(reqJson).byteLength;
    const resBytes = new TextEncoder().encode(resJson).byteLength;

    const head: TrafficHead = {
      id: nextId,
      method: "POST",
      mime: "application/json",
      size: resBytes,
      start_time_unix_ms: nowMs,
      status: 200,
      time: 1,
      uri: targetUri,
    };

    const reqBody: TrafficBody = {encode: "utf8", size: reqBytes, value: reqJson};
    const resBody: TrafficBody = {encode: "utf8", size: resBytes, value: resJson};

    this.detailsById[String(nextId)] = {
      end_time: new Date(nowMs + 1).toISOString(),
      error: null,
      gid: nextId,
      http_version: "HTTP/1.1",
      method: "POST",
      req_body: reqBody,
      req_body_file: null,
      req_headers: {
        items: [
          {name: "content-type", value: "application/json"},
          {name: "mcp-protocol-version", value: "2026-07-28"},
          {name: "mcp-method", value: method},
        ],
        size: 3,
      },
      res_body: resBody,
      res_body_file: null,
      res_body_size: resBytes,
      res_headers: {
        items: [{name: "content-type", value: "application/json"}],
        size: 1,
      },
      start_time: new Date(nowMs).toISOString(),
      status: 200,
      uri: targetUri,
      websocket_id: null,
    };

    this.traffics = [head, ...this.traffics];
  }

  async mutate<T = unknown>(path: string, body: unknown): Promise<T> {
    await this.ensureLoaded();
    if (!this.snapshot || !this.status) {
      throw new Error("Demo session not initialized");
    }

    const normalized = path.startsWith("/") ? path : `/${path}`;
    const payload = isRecord(body) ? body : {};
    const nowUnix = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();

    if (normalized === "/bundles/put") {
      const bundleId = String(payload.bundle_id ?? "").trim();
      const title = String(payload.title ?? bundleId).trim();
      const items = Array.isArray(payload.items) ? payload.items.map(String) : [bundleId];
      const existingIdx = this.snapshot.bundles.findIndex((b) => b.bundle_id === bundleId);
      const nextBundle: Bundle = {
        bundle_id: bundleId,
        items,
        rules: isRecord(payload.rules) ? payload.rules : {},
        title,
      };
      const nextBundles = [...this.snapshot.bundles];

      if (existingIdx >= 0) {
        nextBundles[existingIdx] = nextBundle;
      } else {
        nextBundles.unshift(nextBundle);
      }
      this.snapshot = {...this.snapshot, bundles: nextBundles};
      this.onChange();

      return {ok: true} as T;
    }

    if (normalized === "/receipts/issue") {
      const subject = String(payload.subject ?? "").trim();
      const bundleId = String(payload.bundle_id ?? "").trim();
      const maxCalls = Math.max(1, Number(payload.max_calls ?? 10));
      const expiresAtUnix = Number(payload.expires_at_unix ?? nowUnix + 86_400);
      const receiptId =
        typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `receipt-${Date.now()}`;

      const receiptPayload: CapabilityReceiptPayload = {
        bundle_id: bundleId,
        expires_at_unix: expiresAtUnix,
        item_digests: [],
        max_calls: maxCalls,
        receipt_id: receiptId,
        subject,
      };

      const {pair} = await this.ensureSigningKey();
      const jcs = canonicalizeJcs(receiptPayload);
      const sigBuf = await window.crypto.subtle.sign(
        {name: "Ed25519"},
        pair.privateKey,
        toArrayBufferBytes(new TextEncoder().encode(jcs)),
      );
      const sigB64 = encodeBase64Url(new Uint8Array(sigBuf));
      const token = `${encodeBase64Url(new TextEncoder().encode(jcs))}.${sigB64}`;

      const nextRow: CapabilityReceiptRow = {
        bundle_id: bundleId,
        created_at: nowUnix,
        expires_at_unix: expiresAtUnix,
        max_calls: maxCalls,
        payload: receiptPayload,
        receipt_id: receiptId,
        remaining_calls: maxCalls,
        revoked: 0,
        signature: sigB64,
        signature_verified: true,
        subject,
      };

      this.snapshot = {
        ...this.snapshot,
        capability_receipts: [nextRow, ...this.snapshot.capability_receipts],
      };
      this.onChange();

      const issued: IssuedReceiptResponse = {
        signature_verified: true,
        signed_receipt: {
          receipt: receiptPayload,
          signature: sigB64,
        },
        token,
      };

      return issued as T;
    }

    if (normalized === "/receipts/revoke") {
      const receiptId = String(payload.receipt_id ?? "");

      this.snapshot = {
        ...this.snapshot,
        capability_receipts: this.snapshot.capability_receipts.map((row) =>
          row.receipt_id === receiptId ? {...row, revoked: 1} : row,
        ),
      };
      this.onChange();

      return {ok: true} as T;
    }

    if (normalized === "/probe-policy") {
      const nextPolicy = (payload.probe_policy as ProbePolicy) ?? "auto";

      this.status = {...this.status, probe_policy: nextPolicy};
      this.snapshot = {...this.snapshot, probe_policy: nextPolicy};
      this.onChange();

      return {probe_policy: nextPolicy} as T;
    }

    if (normalized === "/skills/load" || normalized === "/upstreams/connect") {
      const msg = "Download the desktop app to connect local folders or external servers";

      toast.info(msg);
      throw new Error(msg);
    }

    if (normalized === "/inspector/connect") {
      const target = String(payload.target ?? this.status.mcp_endpoint);
      const transport = String(payload.transport ?? "http");
      const existing = this.inspector.connections[0];
      const connId =
        existing?.connection_id ??
        (typeof window.crypto?.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `conn-${Date.now()}`);
      const serverInfo = existing?.server_info ?? {
        capabilities: {prompts: {}, resources: {}, tools: {listChanged: true}},
        protocolVersion: "2026-07-28",
        serverInfo: {name: "outrider", version: "0.5.13"},
      };

      const updatedConn: InspectorConnection = {
        connection_id: connId,
        created_at: existing?.created_at ?? nowUnix,
        env_names: [],
        error: null,
        header_names: [],
        label: target,
        lifecycle: "auto",
        live: true,
        server_info: serverInfo,
        status: "Connected",
        target,
        transport,
        updated_at: nowUnix,
      };

      this.inspector = {
        ...this.inspector,
        connections: [
          updatedConn,
          ...this.inspector.connections.filter((c) => c.connection_id !== connId),
        ],
      };
      this.onChange();

      return {
        connection_id: connId,
        handshake_ms: 1,
        server_info: serverInfo,
        status: "Connected",
      } as T;
    }

    if (normalized === "/inspector/disconnect") {
      const connId = String(payload.connection_id ?? "");

      this.inspector = {
        ...this.inspector,
        connections: this.inspector.connections.map((c) =>
          c.connection_id === connId ? {...c, live: false, status: "Disconnected"} : c,
        ),
      };
      this.onChange();

      return {ok: true} as T;
    }

    if (normalized === "/inspector/request") {
      const method = String(payload.method ?? "tools/list");
      const params = isRecord(payload.params) ? payload.params : {};
      const nextMsgBase =
        this.inspector.messages.reduce((max, m) => Math.max(max, m.message_id), 0) + 1;

      let resultBody: Record<string, unknown> = {ok: true};

      if (method === "tools/list") {
        const recordedToolsMsg = this.inspector.messages.find(
          (m) => m.kind === "response" && m.method === "tools/list" && isRecord(m.body),
        );

        resultBody = recordedToolsMsg && isRecord(recordedToolsMsg.body)
          ? (recordedToolsMsg.body as Record<string, unknown>)
          : {tools: []};
      } else if (method === "tools/call") {
        const toolName = String(params.name ?? "outrider_catalog");
        const args = isRecord(params.arguments) ? params.arguments : {};

        if (toolName === "outrider_catalog") {
          resultBody = {
            content: [
              {
                text: JSON.stringify(
                  {
                    bundles: this.snapshot.bundles,
                    items: this.snapshot.catalog_items,
                    receipt_subject:
                      this.snapshot.agent_sessions[0]?.session_id ?? "demo-session",
                  },
                  null,
                  2,
                ),
                type: "text",
              },
            ],
            isError: false,
            resultType: "complete",
          };
        } else if (toolName === "outrider_checkout_bundle") {
          const bundleId = String(args.bundle_id ?? "outrider_session_evidence");
          const activeReceipt = this.snapshot.capability_receipts.find(
            (r) =>
              r.bundle_id === bundleId &&
              r.revoked === 0 &&
              r.signature_verified &&
              r.remaining_calls > 0,
          );

          resultBody = activeReceipt
            ? {
                content: [
                  {
                    text: JSON.stringify(
                      {
                        bundle_id: bundleId,
                        remaining_calls: Math.max(0, activeReceipt.remaining_calls - 1),
                        status: "entitled",
                      },
                      null,
                      2,
                    ),
                    type: "text",
                  },
                ],
                isError: false,
                resultType: "complete",
              }
            : {
                inputRequests: {
                  capability_receipt: {
                    method: "elicitation/create",
                    params: {
                      message: `Present an active access pass for bundle ${bundleId}`,
                      mode: "form",
                    },
                  },
                },
                resultType: "input_required",
              };
        } else {
          resultBody = {
            content: [
              {
                text: JSON.stringify(
                  {
                    clef_evaluations: this.snapshot.clef_evaluations,
                    sessions: this.snapshot.agent_sessions,
                  },
                  null,
                  2,
                ),
                type: "text",
              },
            ],
            isError: false,
            resultType: "complete",
          };
        }
      } else if (method === "resources/list") {
        resultBody = {resources: []};
      } else if (method === "resources/templates/list") {
        resultBody = {resourceTemplates: []};
      } else if (method === "prompts/list") {
        resultBody = {prompts: []};
      }

      const reqFrame: InspectorMessage = {
        body: {method, params},
        created_at_ms: nowMs,
        direction: "client_to_server",
        kind: "request",
        latency_ms: null,
        message_id: nextMsgBase,
        method,
        reply_to: null,
      };
      const resFrame: InspectorMessage = {
        body: resultBody,
        created_at_ms: nowMs + 1,
        direction: "server_to_client",
        kind: "response",
        latency_ms: 1,
        message_id: nextMsgBase + 1,
        method,
        reply_to: nextMsgBase,
      };

      this.inspector = {
        ...this.inspector,
        messages: [...this.inspector.messages, reqFrame, resFrame],
      };
      this.recordSyntheticMcpExchange(
        method,
        {id: nextMsgBase, jsonrpc: "2.0", method, params},
        {id: nextMsgBase, jsonrpc: "2.0", result: resultBody},
      );
      this.onChange();

      return {
        kind: "response",
        latency_ms: 1,
        message_id: resFrame.message_id,
        result: resultBody,
      } as T;
    }

    return {ok: true} as T;
  }

  async exportHarAll(): Promise<void> {
    const response = await fetch(withWwwBasePath("/demo/live-capture.har"), {cache: "no-store"});

    if (!response.ok) {
      throw new Error(`Failed to export HAR (${response.status})`);
    }
    const harText = await response.text();
    const blob = new Blob([harText], {type: "application/json; charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "outrider-capture.har";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Exported HAR archive");
  }

  async downloadTrafficHar(id: number): Promise<void> {
    const detail = await this.fetchTrafficDetail(id);
    const harObj = {
      log: {
        creator: {name: "Outrider", version: "0.5.13"},
        entries: [
          {
            request: {
              bodySize: detail.req_body?.size ?? 0,
              headers: detail.req_headers?.items ?? [],
              httpVersion: detail.http_version,
              method: detail.method,
              postData: detail.req_body
                ? {mimeType: "application/json", text: detail.req_body.value}
                : undefined,
              url: detail.uri,
            },
            response: {
              bodySize: detail.res_body_size ?? 0,
              content: {
                mimeType: "application/json",
                size: detail.res_body_size ?? 0,
                text: detail.res_body?.value ?? "",
              },
              headers: detail.res_headers?.items ?? [],
              httpVersion: detail.http_version,
              status: detail.status ?? 200,
              statusText: "OK",
            },
            startedDateTime: detail.start_time ?? new Date().toISOString(),
            time: 1,
          },
        ],
        version: "1.2",
      },
    };
    const blob = new Blob([JSON.stringify(harObj, null, 2)], {
      type: "application/json; charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `traffic-${id}.har`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success("Downloaded packet HAR");
  }

  async copyTrafficCurl(id: number): Promise<void> {
    const detail = await this.fetchTrafficDetail(id);
    let cmd = `curl '${escapeSingleQuotes(detail.uri)}'`;

    if (detail.method.toUpperCase() !== "GET") {
      cmd += ` \\\n  -X ${detail.method}`;
    }
    for (const header of detail.req_headers?.items ?? []) {
      const lower = header.name.toLowerCase();

      if (lower === "content-length" || lower === "host") continue;
      cmd += ` \\\n  -H '${escapeSingleQuotes(header.name)}: ${escapeSingleQuotes(header.value)}'`;
    }
    if (detail.req_body && detail.req_body.value.length > 0 && detail.req_body.encode !== "base64") {
      cmd += ` \\\n  --data-raw '${escapeSingleQuotes(detail.req_body.value)}'`;
    }
    await navigator.clipboard.writeText(cmd);
    toast.success("Copied cURL command");
  }
}
