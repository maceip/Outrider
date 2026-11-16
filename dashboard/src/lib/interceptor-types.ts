export type CommercePhase = "discover" | "negotiate" | "cart" | "payment" | "fulfill";

export type CommerceTxStatus = "live" | "held" | "complete" | "error";

export type InterceptionDirection = "buyer_to_seller" | "seller_to_buyer";

export type InterceptionProtocol = "MCP" | "HTTP";

export type EpistemicKind = "observed" | "held" | "pending";

export type HoldState = "none" | "held" | "forwarded" | "replaced";

export interface CommerceTransaction {
  tx_id: string;
  title: string;
  short_title: string;
  category_label: string;
  buyer_agent: string;
  seller_host: string;
  protocol: string;
  phase: CommercePhase;
  status: CommerceTxStatus;
  status_detail: string;
  sub_status: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface InterceptionEvent {
  event_id: string;
  tx_id: string;
  seq: number;
  timestamp_ms: number;
  actor: string;
  direction: InterceptionDirection;
  protocol: InterceptionProtocol;
  event_name: string;
  epistemic_kind: EpistemicKind;
  hold_state: HoldState;
  status_code: number | null;
  status_label: string;
  correlation_id: string;
  latency_ms: number | null;
  hold_ms?: number | null;
  observation: string;
  payload: Record<string, unknown>;
}

export interface CommercialOffer {
  offer_id: string;
  tx_id: string;
  parent_event_id: string;
  label: string;
  sku_title: string;
  price_cents: number;
  currency: string;
  in_stock: boolean;
  warranty: string;
  returns_policy: string;
  is_draft: boolean;
  committed: boolean;
}

export type McpSchemaValidationState = "valid" | "invalid";

export type SellerPolicyValidationState = "pending_validation" | "valid" | "rejected";

export type OperatorApprovalState = "awaiting_operator" | "approved" | "rejected";

export type PaymentAuthState = "unverified" | "authorized";

export type DraftDeliveryState = "proposed" | "committed" | "discarded";

export interface InterceptionValidation {
  mcp_schema: McpSchemaValidationState;
  mcp_schema_detail: string;
  seller_policy: SellerPolicyValidationState;
  seller_policy_detail: string;
  operator_approval: OperatorApprovalState;
  payment_auth: PaymentAuthState;
}

export interface InterceptionDraft {
  draft_id: string;
  tx_id: string;
  target_event_id: string;
  lane: InterceptionDirection;
  enabled: boolean;
  promo_offer_id: string;
  summary: string;
  result_preview: string;
  delivery_state: DraftDeliveryState;
  proposed_payload: Record<string, unknown>;
  validation: InterceptionValidation;
}

export interface InterceptionWorkspaceState {
  active_intercepting: boolean;
  held_count: number;
  transactions: CommerceTransaction[];
  events: InterceptionEvent[];
  offers: CommercialOffer[];
  drafts: InterceptionDraft[];
}

export const EMPTY_INTERCEPTION_STATE: InterceptionWorkspaceState = {
  active_intercepting: false,
  drafts: [],
  events: [],
  held_count: 0,
  offers: [],
  transactions: [],
};

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  return fallback;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
}

function normalizePhase(value: unknown): CommercePhase {
  if (
    value === "discover" ||
    value === "negotiate" ||
    value === "cart" ||
    value === "payment" ||
    value === "fulfill"
  ) {
    return value;
  }

  return "discover";
}

function normalizeTxStatus(value: unknown): CommerceTxStatus {
  if (value === "live" || value === "held" || value === "complete" || value === "error") {
    return value;
  }

  return "live";
}

function normalizeDirection(value: unknown): InterceptionDirection {
  return value === "seller_to_buyer" ? "seller_to_buyer" : "buyer_to_seller";
}

function normalizeProtocol(value: unknown): InterceptionProtocol {
  return value === "HTTP" ? "HTTP" : "MCP";
}

function normalizeEpistemicKind(value: unknown): EpistemicKind {
  if (value === "held" || value === "pending" || value === "observed") {
    return value;
  }

  return "observed";
}

function normalizeHoldState(value: unknown): HoldState {
  if (value === "held" || value === "forwarded" || value === "replaced" || value === "none") {
    return value;
  }

  return "none";
}

function parseRecordPayload(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);

      if (isPlainRecord(parsed)) return parsed;
    } catch {
      return {raw: value};
    }
  }

  return {};
}

export function parseInterceptionWorkspaceState(raw: unknown): InterceptionWorkspaceState | null {
  const candidate = isPlainRecord(raw) && isPlainRecord(raw.state) ? raw.state : raw;

  if (!isPlainRecord(candidate)) {
    return null;
  }

  if (
    !Array.isArray(candidate.transactions) &&
    !Array.isArray(candidate.events) &&
    typeof candidate.active_intercepting !== "boolean"
  ) {
    return null;
  }

  const transactions: CommerceTransaction[] = Array.isArray(candidate.transactions)
    ? candidate.transactions.filter(isPlainRecord).map((row) => ({
        buyer_agent: String(row.buyer_agent ?? ""),
        category_label: String(row.category_label ?? ""),
        created_at_ms: toFiniteNumber(row.created_at_ms, 0),
        phase: normalizePhase(row.phase),
        protocol: String(row.protocol ?? "MCP"),
        seller_host: String(row.seller_host ?? ""),
        short_title: String(row.short_title ?? row.title ?? row.tx_id ?? ""),
        status: normalizeTxStatus(row.status),
        status_detail: String(row.status_detail ?? ""),
        sub_status: String(row.sub_status ?? ""),
        title: String(row.title ?? row.short_title ?? row.tx_id ?? ""),
        tx_id: String(row.tx_id ?? ""),
        updated_at_ms: toFiniteNumber(row.updated_at_ms, 0),
      }))
    : [];

  const events: InterceptionEvent[] = Array.isArray(candidate.events)
    ? candidate.events.filter(isPlainRecord).map((row) => ({
        actor: String(row.actor ?? ""),
        correlation_id: String(row.correlation_id ?? ""),
        direction: normalizeDirection(row.direction),
        epistemic_kind: normalizeEpistemicKind(row.epistemic_kind),
        event_id: String(row.event_id ?? ""),
        event_name: String(row.event_name ?? ""),
        hold_ms: toNullableNumber(row.hold_ms),
        hold_state: normalizeHoldState(row.hold_state),
        latency_ms: toNullableNumber(row.latency_ms),
        observation: String(row.observation ?? ""),
        payload: parseRecordPayload(row.payload),
        protocol: normalizeProtocol(row.protocol),
        seq: toFiniteNumber(row.seq, 0),
        status_code: toNullableNumber(row.status_code),
        status_label: String(row.status_label ?? ""),
        timestamp_ms: toFiniteNumber(row.timestamp_ms, 0),
        tx_id: String(row.tx_id ?? ""),
      }))
    : [];

  const offers: CommercialOffer[] = Array.isArray(candidate.offers)
    ? candidate.offers.filter(isPlainRecord).map((row) => ({
        committed: toBoolean(row.committed, false),
        currency: String(row.currency ?? "USD") || "USD",
        in_stock: toBoolean(row.in_stock, true),
        is_draft: toBoolean(row.is_draft, false),
        label: String(row.label ?? ""),
        offer_id: String(row.offer_id ?? ""),
        parent_event_id: String(row.parent_event_id ?? ""),
        price_cents: toFiniteNumber(row.price_cents, 0),
        returns_policy: String(row.returns_policy ?? ""),
        sku_title: String(row.sku_title ?? ""),
        tx_id: String(row.tx_id ?? ""),
        warranty: String(row.warranty ?? ""),
      }))
    : [];

  const drafts: InterceptionDraft[] = Array.isArray(candidate.drafts)
    ? candidate.drafts.filter(isPlainRecord).map((row) => {
        const val = isPlainRecord(row.validation) ? row.validation : row;
        const mcpSchema: McpSchemaValidationState =
          val.mcp_schema === "invalid" ? "invalid" : "valid";
        const sellerPolicy: SellerPolicyValidationState =
          val.seller_policy === "valid" || val.seller_policy === "rejected"
            ? val.seller_policy
            : "pending_validation";
        const operatorApproval: OperatorApprovalState =
          val.operator_approval === "approved" || val.operator_approval === "rejected"
            ? val.operator_approval
            : "awaiting_operator";
        const paymentAuth: PaymentAuthState =
          val.payment_auth === "authorized" ? "authorized" : "unverified";
        const deliveryState: DraftDeliveryState =
          row.delivery_state === "committed" || row.delivery_state === "discarded"
            ? row.delivery_state
            : "proposed";

        return {
          delivery_state: deliveryState,
          draft_id: String(row.draft_id ?? ""),
          enabled: toBoolean(row.enabled, true),
          lane: normalizeDirection(row.lane),
          promo_offer_id: String(row.promo_offer_id ?? ""),
          proposed_payload: parseRecordPayload(row.proposed_payload),
          result_preview: String(row.result_preview ?? ""),
          summary: String(row.summary ?? ""),
          target_event_id: String(row.target_event_id ?? ""),
          tx_id: String(row.tx_id ?? ""),
          validation: {
            mcp_schema: mcpSchema,
            mcp_schema_detail: String(val.mcp_schema_detail ?? ""),
            operator_approval: operatorApproval,
            payment_auth: paymentAuth,
            seller_policy: sellerPolicy,
            seller_policy_detail: String(val.seller_policy_detail ?? ""),
          },
        };
      })
    : [];

  const computedHeldCount = events.filter((e) => e.hold_state === "held").length;

  return {
    active_intercepting: toBoolean(candidate.active_intercepting, computedHeldCount > 0),
    drafts,
    events,
    held_count:
      typeof candidate.held_count === "number" && Number.isFinite(candidate.held_count)
        ? candidate.held_count
        : computedHeldCount,
    offers,
    transactions,
  };
}

export function formatMoneyCompact(priceCents: number, currency = "USD"): string {
  const safeCents = Number.isFinite(priceCents) ? priceCents : 0;
  const normalizedCurrency = currency.trim().toUpperCase() || "USD";
  const hasSubunits = Math.abs(safeCents) % 100 !== 0;

  try {
    return new Intl.NumberFormat("en-US", {
      currency: normalizedCurrency,
      maximumFractionDigits: hasSubunits ? 2 : 0,
      minimumFractionDigits: hasSubunits ? 2 : 0,
      style: "currency",
    }).format(safeCents / 100);
  } catch {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: hasSubunits ? 2 : 0,
      minimumFractionDigits: hasSubunits ? 2 : 0,
      style: "currency",
    }).format(safeCents / 100);
  }
}

export function formatMoneyExact(priceCents: number, currency = "USD"): string {
  const safeCents = Number.isFinite(priceCents) ? priceCents : 0;
  const normalizedCurrency = currency.trim().toUpperCase() || "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: "currency",
    }).format(safeCents / 100);
  } catch {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: "currency",
    }).format(safeCents / 100);
  }
}
