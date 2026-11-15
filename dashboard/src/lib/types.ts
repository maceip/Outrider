export interface TrafficHead {
  id: number;
  method: string;
  uri: string;
  status: number | null;
  size: number | null;
  time: number | null;
  mime: string;
  websocket_id?: number;
  start_time_unix_ms?: number;
}

export interface TrafficHeader {
  name: string;
  value: string;
}

export interface TrafficHeaders {
  items: TrafficHeader[];
  size: number;
}

export interface TrafficBody {
  encode: string;
  value: string;
  size: number;
}

export interface TrafficDetail {
  gid: number;
  uri: string;
  method: string;
  req_headers: TrafficHeaders | null;
  req_body_file: string | null;
  req_body: TrafficBody | null;
  status: number | null;
  http_version: string | null;
  res_headers: TrafficHeaders | null;
  res_body_file: string | null;
  res_body_size: number | null;
  res_body: TrafficBody | null;
  websocket_id: number | null;
  start_time: string | null;
  end_time: string | null;
  error: string | null;
}

export interface WebsocketFrameData {
  create: string;
  server_to_client: boolean;
  body: TrafficBody;
}

export type WebsocketFrameMessage =
  | {data: {create: string; server_to_client: boolean; body: TrafficBody}}
  | {error: string};

export type TimeRange = "5M" | "1H" | "24H" | "ALL";

export type DashboardPeriod = "daily" | "weekly" | "monthly" | "yearly";

export type DashboardTab = "overview" | "traffic" | "mcp";

export type ProbePolicy = "off" | "on-request" | "auto";

export type ClefEngineStatus =
  | {status: "Unconfigured"}
  | {status: "Ready"; model_path: string; backend: string}
  | {status: "ModelError"; model_path: string; error: string};

export interface CommerceStatus {
  clef: ClefEngineStatus;
  admin_allow_remote: boolean;
  probe_policy: ProbePolicy;
  listen_addr?: string | null;
  mcp_endpoint?: string | null;
}

export interface ActivePeer {
  session_id: string;
  connected: boolean;
  sampling: boolean;
}

export interface McpClientConfig {
  protocolVersion?: string;
  capabilities?: {
    sampling?: Record<string, unknown> | null;
    elicitation?: Record<string, unknown> | null;
    roots?: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  clientInfo?: {
    name?: string;
    version?: string;
    title?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type AgentSessionState =
  | "Unprobed"
  | "Probed"
  | "CLEF Evaluated"
  | "Entitled"
  | (string & {});

export interface AgentSession {
  session_id: string;
  subject: string;
  client_config: McpClientConfig;
  transport: string;
  state: AgentSessionState;
  created_at: number;
}

export interface FingerprintObservation {
  observation_id: string;
  session_id: string | null;
  connection_id: string | null;
  kind: string;
  evidence: Record<string, unknown> | unknown;
  created_at: number;
}

export interface ProbeRun {
  probe_id: string;
  session_id: string;
  purpose: string;
  status: string;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  structural_compliance: number | null;
  response: Record<string, unknown> | string | null;
  error: string | null;
  created_at: number;
}

export type ClefQuestionKind = "choice" | "noul" | "score";

export type ClefQuestion =
  | {type: "noul"; question: string}
  | {type: "choice"; question: string; options: string[]}
  | {type: "score"; question: string; min: number; max: number};

export interface ClefEvaluation {
  evaluation_id: string;
  session_id: string;
  question: ClefQuestion | Record<string, unknown>;
  status: string;
  model_path: string | null;
  backend: string | null;
  prompt: string | null;
  rendered_input: string | null;
  raw_output: string | null;
  pick: boolean | string | number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  option_scores: null;
  error: string | null;
  created_at: number;
}

export interface UpstreamServer {
  name: string;
  endpoint: string;
  status: string;
  error: string | null;
  updated_at: number;
}

export interface CatalogItem {
  item_id: string;
  kind: string;
  digest: string;
  descriptor: Record<string, unknown>;
  upstream_name: string | null;
}

export interface Bundle {
  bundle_id: string;
  title: string;
  items: string[];
  rules: {
    required_pick?: boolean | string | number;
    [key: string]: unknown;
  };
}

export interface SessionOffer {
  offer_id: string;
  session_id: string;
  bundle_id: string;
  source: string;
  evaluation_id: string | null;
  created_at: number;
}

export interface MrtrQuote {
  quote_id: string;
  session_id: string;
  subject: string;
  bundle_id: string;
  request: Record<string, unknown>;
  item_digests: string[];
  expires_at_unix: number;
  consumed: number;
}

export interface CapabilityReceiptPayload {
  receipt_id: string;
  subject: string;
  bundle_id: string;
  item_digests: string[];
  max_calls: number;
  expires_at_unix: number;
}

export interface CapabilityReceiptRow {
  receipt_id: string;
  subject: string;
  bundle_id: string;
  payload: CapabilityReceiptPayload;
  signature: string;
  max_calls: number;
  remaining_calls: number;
  expires_at_unix: number;
  revoked: number;
  created_at: number;
  signature_verified: boolean;
}

export interface IssuedReceiptResponse {
  token: string;
  signed_receipt: {
    receipt: CapabilityReceiptPayload;
    signature: string;
  };
  signature_verified: boolean;
}

export interface ReceiptRedemption {
  redemption_id: string;
  receipt_id: string;
  session_id: string;
  tool_name: string;
  quote_id: string | null;
  created_at: number;
}

export interface AdminAuditEntry {
  audit_id: string;
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  created_at: number;
}

export interface McpFrame {
  frame_id: number;
  session_id: string | null;
  upstream_name: string | null;
  direction: string;
  method: string;
  body: Record<string, unknown> | unknown;
  created_at: number;
}

export interface ProxyTrafficHead {
  id?: number;
  method?: string;
  uri?: string;
  status?: number | null;
  time?: number | null;
  websocket_id?: number | null;
  mime?: string;
  size?: number | null;
  start_time_unix_ms?: number;
  [key: string]: unknown;
}

export interface ProxyTrafficRow {
  id: number;
  run_id: string;
  traffic_id: number;
  head: ProxyTrafficHead;
  detail: Record<string, unknown>;
}

export interface ProxyWebsocketMessage {
  id: number;
  run_id: string;
  websocket_id: number;
  message: WebsocketFrameMessage | Record<string, unknown>;
  created_at: number;
}

export interface CommerceSnapshot {
  run_id: string;
  clef: ClefEngineStatus;
  active_peers: ActivePeer[];
  probe_policy: ProbePolicy;
  public_key: string;
  errors: string[];
  agent_sessions: AgentSession[];
  fingerprint_observations: FingerprintObservation[];
  probe_runs: ProbeRun[];
  clef_evaluations: ClefEvaluation[];
  upstream_servers: UpstreamServer[];
  catalog_items: CatalogItem[];
  bundles: Bundle[];
  session_offers: SessionOffer[];
  mrtr_quotes: MrtrQuote[];
  capability_receipts: CapabilityReceiptRow[];
  receipt_redemptions: ReceiptRedemption[];
  admin_audit_log: AdminAuditEntry[];
  mcp_frames: McpFrame[];
  proxy_traffic: ProxyTrafficRow[];
  proxy_websocket_messages: ProxyWebsocketMessage[];
}

export interface InspectorConnection {
  connection_id: string;
  label: string;
  transport: "http" | "stdio" | (string & {});
  target: string;
  lifecycle: string;
  header_names: string[] | null;
  env_names: string[] | null;
  status: "Connecting" | "Connected" | "Disconnected" | "Failed" | (string & {});
  server_info: {
    protocolVersion?: string;
    capabilities?: Record<string, unknown>;
    serverInfo?: {
      name?: string;
      version?: string;
      title?: string;
    };
    instructions?: string | null;
    [key: string]: unknown;
  } | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  live: boolean;
}

export interface InspectorMessage {
  message_id: number;
  direction: "client_to_server" | "server_to_client" | (string & {});
  kind:
    | "request"
    | "response"
    | "notification"
    | "error"
    | "handshake"
    | "stderr"
    | (string & {});
  method: string;
  body: unknown;
  reply_to: number | null;
  latency_ms: number | null;
  created_at_ms: number;
}

export interface InspectorServerRequest {
  request_id: string;
  method: string;
  params: Record<string, unknown> | null;
  status: "Pending" | "Answered" | "Rejected" | "Abandoned" | "Timed out" | (string & {});
  response: unknown;
  created_at: number;
  answered_at: number | null;
}

export interface InspectorState {
  connections: InspectorConnection[];
  messages: InspectorMessage[];
  server_requests: InspectorServerRequest[];
}

export interface DetectedLocalAgent {
  id: "claude-desktop" | "claude-code" | "codex" | (string & {});
  name: string;
  transport: "stdio" | "http" | (string & {});
  detected: boolean;
  config_path: string;
  config_exists: boolean;
  already_configured: boolean;
  running: boolean;
  running_pids: number[];
}

export interface OnboardingScanResponse {
  mcp_http_url: string;
  executable_path: string;
  config_dir: string;
  db_path: string;
  deep_links: {
    cursor: string;
    vscode: string;
  };
  agents: DetectedLocalAgent[];
}

export interface ConfigureAgentResponse {
  agent_id: string;
  name: string;
  config_path: string;
  backup_path: string | null;
  configured: boolean;
  restart_confirmed: boolean;
  restarted: boolean;
  note: string;
}

export interface RunSortieResponse {
  session_id: string;
  subject: string;
  bundle_id: string;
  receipt_id: string;
  tls_mcp_uri: string;
  probe_ran: boolean;
  proxy_traffic_recorded: boolean;
  fingerprint_observations: unknown;
  redeemed_output: unknown;
}

export function formatClefState(clef: ClefEngineStatus | null | undefined): string {
  if (!clef) return "Unconfigured";
  if (clef.status === "Ready") return `Ready (${clef.backend})`;
  if (clef.status === "ModelError") return "ModelError";

  return "Unconfigured";
}
