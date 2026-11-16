import type {
  CommercialOffer,
  InterceptionDirection,
  InterceptionDraft,
  InterceptionWorkspaceState,
  McpSchemaValidationState,
  SellerPolicyValidationState,
} from "./interceptor-types";

import {
  EMPTY_INTERCEPTION_STATE,
  formatMoneyCompact,
  formatMoneyExact,
  isPlainRecord,
  parseInterceptionWorkspaceState,
} from "./interceptor-types";
import {withWwwBasePath} from "./www-base-path";

const DEFAULT_SELLER_FLOOR_CENTS = 19_900;

interface VerifiedBrowserPass {
  bundleId: string;
  publicKeyB64: string;
  receiptId: string;
  signatureB64: string;
  subject: string;
  verified: boolean;
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

  throw new TypeError("Unsupported JSON value");
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

function extractOffersArray(payload: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(payload.offers)) {
    return payload.offers;
  }
  if (isPlainRecord(payload.result) && Array.isArray(payload.result.offers)) {
    return payload.result.offers;
  }
  if (isPlainRecord(payload.structuredContent) && Array.isArray(payload.structuredContent.offers)) {
    return payload.structuredContent.offers;
  }
  if (isPlainRecord(payload.params) && Array.isArray(payload.params.offers)) {
    return payload.params.offers;
  }

  return null;
}

function updateOfferPriceInPayload(
  payload: Record<string, unknown>,
  promoOfferId: string,
  nextPriceCents: number,
): Record<string, unknown> {
  const cloned = structuredClone(payload);
  const patchList = (list: unknown[]) => {
    for (const entry of list) {
      if (isPlainRecord(entry) && String(entry.offer_id ?? "") === promoOfferId) {
        entry.price_cents = nextPriceCents;
      }
    }
  };

  if (Array.isArray(cloned.offers)) {
    patchList(cloned.offers);
  }
  if (isPlainRecord(cloned.result) && Array.isArray(cloned.result.offers)) {
    patchList(cloned.result.offers);
  }
  if (isPlainRecord(cloned.structuredContent) && Array.isArray(cloned.structuredContent.offers)) {
    patchList(cloned.structuredContent.offers);
  }

  return cloned;
}

export function validateMcpOffersPayload(payload: Record<string, unknown>): {
  detail: string;
  status: McpSchemaValidationState;
} {
  const offers = extractOffersArray(payload);

  if (!Array.isArray(offers) || offers.length === 0) {
    return {
      detail: "Missing non-empty offers array in return_offers payload",
      status: "invalid",
    };
  }

  for (let idx = 0; idx < offers.length; idx += 1) {
    const item = offers[idx];

    if (!isPlainRecord(item)) {
      return {
        detail: `Offer at index ${idx} is not an object`,
        status: "invalid",
      };
    }
    const offerId = typeof item.offer_id === "string" ? item.offer_id.trim() : "";
    const skuTitle = typeof item.sku_title === "string" ? item.sku_title.trim() : "";
    const priceCents = typeof item.price_cents === "number" ? item.price_cents : Number.NaN;
    const currencyOk =
      item.currency === undefined ||
      (typeof item.currency === "string" && item.currency.trim().length > 0);

    if (!offerId || !skuTitle || !currencyOk || !Number.isFinite(priceCents) || priceCents <= 0) {
      return {
        detail: `Offer ${offerId || `#${idx + 1}`} violates required return_offers fields`,
        status: "invalid",
      };
    }
  }

  return {
    detail: "Conforms to MCP 2026-07-28 return_offers schema",
    status: "valid",
  };
}

export function validateSellerFloorPolicy(
  draftPriceCents: number,
  floorCents = DEFAULT_SELLER_FLOOR_CENTS,
  ceilingCents = 100_000,
  currency = "USD",
): {
  detail: string;
  status: SellerPolicyValidationState;
} {
  if (!Number.isFinite(draftPriceCents) || draftPriceCents < floorCents) {
    return {
      detail: `Below merchant floor (${formatMoneyExact(floorCents, currency)})`,
      status: "rejected",
    };
  }
  if (draftPriceCents > ceilingCents) {
    return {
      detail: `Exceeds merchant list ceiling (${formatMoneyExact(ceilingCents, currency)})`,
      status: "rejected",
    };
  }

  return {
    detail: `Within merchant floor (>= ${formatMoneyExact(floorCents, currency)})`,
    status: "valid",
  };
}

export class WwwInterceptorEngine {
  private seedSnapshot: InterceptionWorkspaceState | null = null;
  private state: InterceptionWorkspaceState = structuredClone(EMPTY_INTERCEPTION_STATE);
  private holdStartedAtMs = Date.now();
  private loadPromise: Promise<void> | null = null;
  private signingKeyPair: CryptoKeyPair | null = null;
  private publicKeyB64 = "";
  private verifiedPassesByTx = new Map<string, VerifiedBrowserPass>();
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  async ensureLoaded(signal?: AbortSignal): Promise<void> {
    if (this.seedSnapshot) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const res = await fetch(withWwwBasePath("/demo/interceptor-seed.json"), {
            cache: "no-store",
            signal,
          });

          if (!res.ok) {
            throw new Error(`Failed to load interceptor seed (${res.status})`);
          }
          const raw: unknown = await res.json();
          const parsed = parseInterceptionWorkspaceState(raw);

          if (!parsed) {
            throw new Error("Invalid interceptor seed format");
          }
          this.seedSnapshot = structuredClone(parsed);
          this.state = structuredClone(parsed);
          this.holdStartedAtMs = Date.now();
          this.onChange();
        } catch (error) {
          this.loadPromise = null;
          throw error;
        }
      })();
    }

    return this.loadPromise;
  }

  getState(): InterceptionWorkspaceState {
    const elapsedMs = Math.max(0, Date.now() - this.holdStartedAtMs);
    const events = this.state.events.map((ev) =>
      ev.hold_state === "held"
        ? {
            ...ev,
            hold_ms: Math.max(0, (ev.hold_ms ?? 0) + elapsedMs),
          }
        : ev,
    );
    const heldCount = events.filter((ev) => ev.hold_state === "held").length;

    return {
      ...this.state,
      active_intercepting: heldCount > 0 || this.state.active_intercepting,
      events,
      held_count: heldCount,
    };
  }

  private recomputeCounts(): void {
    const heldCount = this.state.events.filter((ev) => ev.hold_state === "held").length;

    this.state.held_count = heldCount;
    this.state.active_intercepting = heldCount > 0 || this.state.transactions.length > 0;
  }

  private findDraft(txId: string, targetEventId?: string): InterceptionDraft | undefined {
    return (
      this.state.drafts.find(
        (d) => d.tx_id === txId && (!targetEventId || d.target_event_id === targetEventId),
      ) ?? this.state.drafts.find((d) => d.tx_id === txId)
    );
  }

  private findPromoOffer(txId: string, draft: InterceptionDraft | undefined): CommercialOffer | undefined {
    if (!draft) return undefined;

    return (
      this.state.offers.find(
        (o) => o.tx_id === txId && o.offer_id === draft.promo_offer_id,
      ) ?? this.state.offers.find((o) => o.tx_id === txId && o.is_draft)
    );
  }

  private computeMaxRegularCents(txId: string): number {
    const regularPrices = this.state.offers
      .filter((o) => o.tx_id === txId && !o.is_draft)
      .map((o) => o.price_cents);

    return regularPrices.length > 0 ? Math.max(...regularPrices) : 100_000;
  }

  private async ensureSigningKey(): Promise<{pair: CryptoKeyPair; pubB64: string}> {
    if (this.signingKeyPair && this.publicKeyB64) {
      return {pair: this.signingKeyPair, pubB64: this.publicKeyB64};
    }
    const generated = (await window.crypto.subtle.generateKey(
      {name: "Ed25519"},
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const rawPub = new Uint8Array(await window.crypto.subtle.exportKey("raw", generated.publicKey));
    const pubB64 = encodeBase64Url(rawPub);

    this.signingKeyPair = generated;
    this.publicKeyB64 = pubB64;

    return {pair: generated, pubB64};
  }

  async mutate(path: string, body: unknown): Promise<InterceptionWorkspaceState> {
    await this.ensureLoaded();
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const payload = isPlainRecord(body) ? body : {};

    if (normalized === "/interception/run-scenario") {
      const includePeers = payload.include_peers !== false;

      if (this.seedSnapshot) {
        const cloned = structuredClone(this.seedSnapshot);

        if (!includePeers) {
          const primaryTxId = cloned.transactions[0]?.tx_id ?? "audioshop";

          cloned.transactions = cloned.transactions.filter((t) => t.tx_id === primaryTxId);
          cloned.events = cloned.events.filter((e) => e.tx_id === primaryTxId);
          cloned.offers = cloned.offers.filter((o) => o.tx_id === primaryTxId);
          cloned.drafts = cloned.drafts.filter((d) => d.tx_id === primaryTxId);
        }
        this.state = cloned;
      }
      this.verifiedPassesByTx.clear();
      this.holdStartedAtMs = Date.now();
      this.recomputeCounts();
      this.onChange();

      return this.getState();
    }

    const txId = String(payload.tx_id ?? this.state.transactions[0]?.tx_id ?? "audioshop");
    const targetEventId =
      typeof payload.target_event_id === "string" && payload.target_event_id.trim().length > 0
        ? payload.target_event_id.trim()
        : undefined;

    if (normalized === "/interception/draft") {
      const draft = this.findDraft(txId, targetEventId);

      if (!draft) {
        throw new Error(`No interception draft found for ${txId}`);
      }

      if (payload.lane === "buyer_to_seller" || payload.lane === "seller_to_buyer") {
        draft.lane = payload.lane as InterceptionDirection;
      }
      if (typeof payload.enabled === "boolean") {
        draft.enabled = payload.enabled;
      }
      if (
        typeof payload.promo_price_cents === "number" &&
        Number.isFinite(payload.promo_price_cents) &&
        payload.promo_price_cents > 0
      ) {
        const nextCents = Math.round(payload.promo_price_cents);
        const promoOffer = this.findPromoOffer(txId, draft);

        if (promoOffer) {
          promoOffer.price_cents = nextCents;
          draft.summary = `Include ${promoOffer.offer_id} (${formatMoneyCompact(nextCents, promoOffer.currency)})`;
          draft.result_preview = `${promoOffer.sku_title} promotional offer at ${formatMoneyExact(nextCents, promoOffer.currency)}`;
        }
        draft.proposed_payload = updateOfferPriceInPayload(
          draft.proposed_payload,
          draft.promo_offer_id,
          nextCents,
        );
        draft.validation.seller_policy = "pending_validation";
        draft.validation.seller_policy_detail = "Awaiting floor policy verification";
      }

      const schemaCheck = validateMcpOffersPayload(draft.proposed_payload);

      draft.validation.mcp_schema = schemaCheck.status;
      draft.validation.mcp_schema_detail = schemaCheck.detail;
      this.onChange();

      return this.getState();
    }

    if (normalized === "/interception/validate") {
      const draft = this.findDraft(txId, targetEventId);

      if (!draft) {
        throw new Error(`No interception draft found for ${txId}`);
      }
      const schemaCheck = validateMcpOffersPayload(draft.proposed_payload);
      const promoOffer = this.findPromoOffer(txId, draft);
      const promoPrice = promoOffer?.price_cents ?? 0;
      const currency = promoOffer?.currency ?? "USD";
      const ceilingCents = this.computeMaxRegularCents(txId);
      const policyCheck = validateSellerFloorPolicy(
        promoPrice,
        DEFAULT_SELLER_FLOOR_CENTS,
        ceilingCents,
        currency,
      );

      draft.validation.mcp_schema = schemaCheck.status;
      draft.validation.mcp_schema_detail = schemaCheck.detail;
      draft.validation.seller_policy = policyCheck.status;
      draft.validation.seller_policy_detail = policyCheck.detail;
      this.onChange();

      return this.getState();
    }

    if (normalized === "/interception/release") {
      const tx = this.state.transactions.find((t) => t.tx_id === txId);

      if (!tx) {
        throw new Error(`Transaction ${txId} not found`);
      }
      const draft = this.findDraft(txId, targetEventId);
      const heldEvent =
        this.state.events.find(
          (e) => e.tx_id === txId && (e.event_id === (targetEventId ?? draft?.target_event_id) || e.hold_state === "held"),
        ) ?? this.state.events.find((e) => e.tx_id === txId && e.event_id === "R02");

      if (!heldEvent) {
        throw new Error(`No held event found for ${txId}`);
      }

      const requestedMode = payload.mode === "original" ? "original" : "replacement";
      const useReplacement = requestedMode === "replacement" && Boolean(draft?.enabled);
      const promoOffer = this.findPromoOffer(txId, draft);

      if (useReplacement && draft) {
        const schemaCheck = validateMcpOffersPayload(draft.proposed_payload);

        draft.validation.mcp_schema = schemaCheck.status;
        draft.validation.mcp_schema_detail = schemaCheck.detail;
        if (schemaCheck.status !== "valid") {
          throw new Error(schemaCheck.detail);
        }

        const policyCheck = validateSellerFloorPolicy(
          promoOffer?.price_cents ?? 0,
          DEFAULT_SELLER_FLOOR_CENTS,
          this.computeMaxRegularCents(txId),
          promoOffer?.currency ?? "USD",
        );

        draft.validation.seller_policy = policyCheck.status;
        draft.validation.seller_policy_detail = policyCheck.detail;
        if (policyCheck.status !== "valid") {
          throw new Error(policyCheck.detail);
        }

        draft.validation.operator_approval = "approved";
        draft.delivery_state = "committed";

        if (promoOffer) {
          promoOffer.committed = true;
          promoOffer.is_draft = false;
        }

        heldEvent.epistemic_kind = "observed";
        heldEvent.hold_state = "replaced";
        heldEvent.status_code = 200;
        heldEvent.status_label = "200";
        heldEvent.latency_ms = heldEvent.latency_ms ?? 18;
        heldEvent.hold_ms = null;
        heldEvent.payload = structuredClone(draft.proposed_payload);
        heldEvent.observation = promoOffer
          ? `Offers delivered (3, incl. ${promoOffer.offer_id} ${formatMoneyCompact(promoOffer.price_cents, promoOffer.currency)})`
          : "Replacement offers delivered";
      } else {
        if (draft) {
          draft.enabled = false;
          draft.delivery_state = "discarded";
          draft.validation.operator_approval = "approved";
        }
        heldEvent.epistemic_kind = "observed";
        heldEvent.hold_state = "forwarded";
        heldEvent.status_code = 200;
        heldEvent.status_label = "200";
        heldEvent.latency_ms = heldEvent.latency_ms ?? 14;
        heldEvent.hold_ms = null;
        heldEvent.observation = "Original offers forwarded (2)";
      }

      const regularOffers = this.state.offers
        .filter((o) => o.tx_id === txId && !o.is_draft && o.offer_id !== draft?.promo_offer_id)
        .sort((a, b) => a.price_cents - b.price_cents);
      const selectedOffer =
        (useReplacement && promoOffer ? promoOffer : regularOffers[0]) ?? this.state.offers[0];

      const nowMs = Date.now();
      const c03 = this.state.events.find(
        (e) => e.tx_id === txId && (e.event_id === "C03" || e.event_name === "select_product"),
      );
      const c04 = this.state.events.find(
        (e) =>
          e.tx_id === txId && (e.event_id === "C04" || e.event_name === "create_checkout_session"),
      );
      const c05 = this.state.events.find(
        (e) =>
          e.tx_id === txId &&
          (e.event_id === "C05" || e.event_name === "complete_checkout_session"),
      );

      if (c03 && selectedOffer) {
        c03.epistemic_kind = "observed";
        c03.hold_state = "none";
        c03.status_code = 200;
        c03.status_label = "200";
        c03.latency_ms = 11;
        c03.timestamp_ms = nowMs;
        c03.observation = `Selected ${selectedOffer.offer_id} (${formatMoneyCompact(selectedOffer.price_cents, selectedOffer.currency)})`;
        c03.payload = {
          ...c03.payload,
          method: "tools/call",
          offer_id: selectedOffer.offer_id,
          price_cents: selectedOffer.price_cents,
          sku_title: selectedOffer.sku_title,
          tool: "select_product",
        };
      }

      if (c04 && selectedOffer) {
        c04.epistemic_kind = "observed";
        c04.hold_state = "none";
        c04.status_code = 200;
        c04.status_label = "200";
        c04.latency_ms = 16;
        c04.timestamp_ms = nowMs + 12;
        c04.observation = `Checkout staged (${formatMoneyExact(selectedOffer.price_cents, selectedOffer.currency)})`;
        c04.payload = {
          ...c04.payload,
          amount_cents: selectedOffer.price_cents,
          currency: selectedOffer.currency,
          offer_id: selectedOffer.offer_id,
          session_state: "awaiting_payment_authorization",
          tool: "create_checkout_session",
        };
      }

      const verifiedPass = this.verifiedPassesByTx.get(txId);
      const isPaymentAuthorized =
        Boolean(verifiedPass?.verified) || draft?.validation.payment_auth === "authorized";

      if (isPaymentAuthorized && c05) {
        c05.epistemic_kind = "observed";
        c05.hold_state = "none";
        c05.status_code = 200;
        c05.status_label = "200";
        c05.latency_ms = 19;
        c05.timestamp_ms = nowMs + 28;
        c05.observation = selectedOffer
          ? `Order settled (${formatMoneyExact(selectedOffer.price_cents, selectedOffer.currency)})`
          : "Order settled";
        c05.payload = {
          ...c05.payload,
          bundle_id: verifiedPass?.bundleId ?? "conduit_session_evidence",
          receipt_id: verifiedPass?.receiptId ?? "verified-session-pass",
          signature_verified: true,
          status: "fulfilled",
          tool: "complete_checkout_session",
        };
        tx.phase = "fulfill";
        tx.status = "complete";
        tx.status_detail = "Fulfilled";
        tx.sub_status = "Fulfill (complete)";
      } else {
        tx.phase = "payment";
        tx.status = "live";
        tx.status_detail = "Awaiting payment pass";
        tx.sub_status = "Payment (awaiting pass)";
      }
      tx.updated_at_ms = nowMs + 28;

      this.recomputeCounts();
      this.onChange();

      return this.getState();
    }

    if (normalized === "/interception/authorize-payment") {
      const tx = this.state.transactions.find((t) => t.tx_id === txId);

      if (!tx) {
        throw new Error(`Transaction ${txId} not found`);
      }
      const bundleId = String(payload.bundle_id ?? "conduit_session_evidence").trim() || "conduit_session_evidence";
      const nowUnix = Math.floor(Date.now() / 1000);
      const receiptId =
        typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `pass-${Date.now()}`;

      const receiptPayload = {
        bundle_id: bundleId,
        expires_at_unix: nowUnix + 86_400,
        item_digests: [],
        max_calls: 10,
        receipt_id: receiptId,
        subject: tx.buyer_agent,
        tx_id: tx.tx_id,
      };

      const {pair, pubB64} = await this.ensureSigningKey();
      const canonicalBytes = toArrayBufferBytes(
        new TextEncoder().encode(canonicalizeJcs(receiptPayload)),
      );
      const signatureBuf = await window.crypto.subtle.sign(
        {name: "Ed25519"},
        pair.privateKey,
        canonicalBytes,
      );
      const verified = await window.crypto.subtle.verify(
        {name: "Ed25519"},
        pair.publicKey,
        signatureBuf,
        canonicalBytes,
      );

      if (!verified) {
        throw new Error("Cryptographic signature verification failed");
      }

      const signatureB64 = encodeBase64Url(new Uint8Array(signatureBuf));

      this.verifiedPassesByTx.set(txId, {
        bundleId,
        publicKeyB64: pubB64,
        receiptId,
        signatureB64,
        subject: tx.buyer_agent,
        verified: true,
      });

      const draft = this.findDraft(txId, targetEventId);

      if (draft) {
        draft.validation.payment_auth = "authorized";
      }

      const c04 = this.state.events.find(
        (e) =>
          e.tx_id === txId && (e.event_id === "C04" || e.event_name === "create_checkout_session"),
      );
      const c05 = this.state.events.find(
        (e) =>
          e.tx_id === txId &&
          (e.event_id === "C05" || e.event_name === "complete_checkout_session"),
      );

      if (c04?.epistemic_kind === "observed" && c05) {
        const committedOffer =
          this.state.offers.find((o) => o.tx_id === txId && o.committed) ??
          this.state.offers.find((o) => o.tx_id === txId && !o.is_draft);
        const nowMs = Date.now();

        c05.epistemic_kind = "observed";
        c05.hold_state = "none";
        c05.status_code = 200;
        c05.status_label = "200";
        c05.latency_ms = 19;
        c05.timestamp_ms = nowMs;
        c05.observation = committedOffer
          ? `Order settled (${formatMoneyExact(committedOffer.price_cents, committedOffer.currency)})`
          : "Order settled";
        c05.payload = {
          ...c05.payload,
          bundle_id: bundleId,
          public_key: pubB64,
          receipt_id: receiptId,
          signature: signatureB64,
          signature_verified: true,
          status: "fulfilled",
          tool: "complete_checkout_session",
        };

        tx.phase = "fulfill";
        tx.status = "complete";
        tx.status_detail = "Fulfilled";
        tx.sub_status = "Fulfill (complete)";
        tx.updated_at_ms = nowMs;
      }

      this.recomputeCounts();
      this.onChange();

      return this.getState();
    }

    return this.getState();
  }
}
