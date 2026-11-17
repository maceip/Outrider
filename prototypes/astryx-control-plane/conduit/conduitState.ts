// Copyright (c) Meta Platforms, Inc. and affiliates.

export type SurfaceId = 'overview' | 'graph' | 'wire' | 'passes';
export type TraceFilterId = 'all' | 'mcp' | 'http' | 'attention' | 'modified';
export type CommerceStage =
  | 'Discover'
  | 'Negotiate'
  | 'Cart'
  | 'Payment'
  | 'Fulfill';

export type DeliveryPhase =
  | 'observed_inbound'
  | 'delivered_original'
  | 'held_at_proxy'
  | 'delivered_modified'
  | 'awaiting_pass'
  | 'pass_authorized';

export interface OfferQuote {
  id: string;
  label: string;
  price: number;
  perk: string;
  source: 'upstream_seller' | 'proxy_injected';
  marginDelta: number; // relative to marginFloor
}

export interface ValidationCheck {
  id: string;
  gate: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface TraceEvent {
  id: string;
  seq: number;
  code: string; // e.g. 'C01', 'C02', 'R02', 'C03', 'C04', 'C05'
  direction: 'buyer_to_seller' | 'seller_to_buyer' | 'buyer_to_gate';
  protocol: 'MCP' | 'HTTP';
  toolOrEndpoint: string;
  timestamp: string;
  durationLabel: string;
  httpStatus: number | null;
  deliveryPhase: DeliveryPhase;
  sourceActor: string;
  targetActor: string;
  proxyRuleId?: string;
  /** Canonical 1-line summary derived from actual execution state */
  observation: string;
  /** Upstream offers observed before any proxy mutation (for offer frames) */
  upstreamOffers?: OfferQuote[];
  /** Proposed/injected offer staged by proxy rule */
  stagedOffer?: OfferQuote;
  /** Whether the operator currently has the staged mutation rule enabled */
  mutationEnabled?: boolean;
  /** Delivered offers (only populated AFTER release/delivery!) */
  deliveredOffers?: OfferQuote[];
  deliveredAt?: string;
  /** Reason Forward Original is blocked when upstream violates floor policy */
  forwardOriginalBlockedReason?: string;
  /** Validation gates evaluated for this frame */
  validations?: ValidationCheck[];
  /** Raw JSON-RPC / HTTP request or upstream frame */
  rawOriginalJson: string;
  /** Unified diff for proposed/committed wire modification */
  wireDiffJson?: string;
  /** Raw headers for Wire surface */
  headers: Record<string, string>;
  /** Associated pass request details when deliveryPhase is awaiting_pass / pass_authorized */
  passRequest?: {
    requestId: string;
    sku: string;
    requestedCap: number;
    ttl: string;
    agentFingerprint: string;
    issuedPassId?: string;
  };
}

export interface CapabilityPassRecord {
  id: string;
  sessionId: string;
  merchantHost: string;
  buyerAgent: string;
  sku: string;
  capUsd: number;
  remainingCalls: number;
  ttl: string;
  issuedAt: string;
  signature: string;
  status: 'Active' | 'Awaiting Approval' | 'Exhausted' | 'Revoked';
}

export interface MerchantSession {
  id: string;
  merchantName: string;
  merchantHost: string;
  categoryLabel: string;
  trafficProfile: string; // e.g., "Live Outbound Hold" vs "95% Browsing Traffic"
  buyerAgentId: string;
  buyerModel: string;
  agentConfidence: string;
  skuCode: string;
  skuName: string;
  msrpUsd: number;
  marginFloorUsd: number;
  selectedOfferLabel: string | null;
  events: TraceEvent[];
}

export type ScenarioPresetId =
  | 'live_hold_r02'
  | 'floor_leak_blocked'
  | 'post_release_pass'
  | 'discovery_95pct';

export interface CanonicalWorkspaceMetrics {
  stage: CommerceStage;
  stageHeadline: string;
  stageIndex: number; // 0..4
  eventCount: number;
  proxyHeldCount: number;
  awaitingPassCount: number;
  modifiedDeliveredCount: number;
  activePassCountSession: number;
  activePassCountGlobal: number;
  globalHeldCount: number;
  globalAwaitingPassCount: number;
  heldEventId: string | null;
  awaitingPassEventId: string | null;
}

export const STAGE_ORDER: readonly CommerceStage[] = [
  'Discover',
  'Negotiate',
  'Cart',
  'Payment',
  'Fulfill',
];

/**
 * Single canonical state derivation used simultaneously by:
 * 1. Left Sidebar session row subtitle & badges
 * 2. Top Commercial Context Strip & 5-Stage Progress Indicator
 * 3. Right Canonical Inspector Banner & Action Controls
 * 4. Bottom Status Bar
 */
export function deriveWorkspaceMetrics(
  session: MerchantSession,
  allSessions: MerchantSession[],
  passes: CapabilityPassRecord[],
): CanonicalWorkspaceMetrics {
  const heldEvents = session.events.filter(
    e => e.deliveryPhase === 'held_at_proxy',
  );
  const awaitingPassEvents = session.events.filter(
    e => e.deliveryPhase === 'awaiting_pass',
  );
  const modifiedEvents = session.events.filter(
    e => e.deliveryPhase === 'delivered_modified',
  );
  const hasOrderConfirmed = session.events.some(
    e => e.code === 'C05' && e.httpStatus === 200,
  );
  const hasCartSelected = session.events.some(e => e.code === 'C03');
  const hasNegotiationEvent = session.events.some(
    e => e.code === 'C02' || e.code === 'R02',
  );

  let stage: CommerceStage = 'Discover';
  let stageHeadline = 'Discover — Browsing catalog (no checkout intent)';

  if (hasOrderConfirmed) {
    stage = 'Fulfill';
    stageHeadline = 'Fulfill — Order confirmed & receipt signed';
  } else if (awaitingPassEvents.length > 0) {
    stage = 'Payment';
    stageHeadline = 'Payment — Awaiting checkout pass authorization';
  } else if (
    session.events.some(e => e.deliveryPhase === 'pass_authorized') &&
    !hasOrderConfirmed
  ) {
    stage = 'Payment';
    stageHeadline = 'Payment — Checkout pass issued';
  } else if (heldEvents.length > 0) {
    stage = 'Negotiate';
    const heldCode = heldEvents[0]?.code ?? 'R02';
    stageHeadline = `Negotiate — Outbound ${heldCode} held at proxy (undelivered)`;
  } else if (hasCartSelected) {
    stage = 'Cart';
    stageHeadline = 'Cart — Buyer selected offer';
  } else if (hasNegotiationEvent) {
    stage = 'Negotiate';
    stageHeadline = 'Negotiate — Offers delivered';
  }

  const globalHeldCount = allSessions.reduce(
    (acc, s) =>
      acc + s.events.filter(e => e.deliveryPhase === 'held_at_proxy').length,
    0,
  );
  const globalAwaitingPassCount = allSessions.reduce(
    (acc, s) =>
      acc + s.events.filter(e => e.deliveryPhase === 'awaiting_pass').length,
    0,
  );
  const activePassCountSession = passes.filter(
    p => p.sessionId === session.id && p.status === 'Active',
  ).length;
  const activePassCountGlobal = passes.filter(
    p => p.status === 'Active',
  ).length;

  return {
    stage,
    stageHeadline,
    stageIndex: STAGE_ORDER.indexOf(stage),
    eventCount: session.events.length,
    proxyHeldCount: heldEvents.length,
    awaitingPassCount: awaitingPassEvents.length,
    modifiedDeliveredCount: modifiedEvents.length,
    activePassCountSession,
    activePassCountGlobal,
    globalHeldCount,
    globalAwaitingPassCount,
    heldEventId: heldEvents[0]?.id ?? null,
    awaitingPassEventId: awaitingPassEvents[0]?.id ?? null,
  };
}

export function buildInitialPasses(): CapabilityPassRecord[] {
  return [
    {
      id: 'pass_sky_904_await',
      sessionId: 'skyport',
      merchantHost: 'mcp.skyport.aero',
      buyerAgent: 'travel-bot-44a',
      sku: 'SFO-JFK-FLEX-21A',
      capUsd: 642,
      remainingCalls: 1,
      ttl: '10m 00s',
      issuedAt: 'Pending approval',
      signature: 'unsigned (awaiting operator)',
      status: 'Awaiting Approval',
    },
    {
      id: 'pass_cld_811_act',
      sessionId: 'cloudstore',
      merchantHost: 'api.cloudstore.dev',
      buyerAgent: 'infra-buyer-09',
      sku: 'GPU-H100-SPOT-24H',
      capUsd: 480,
      remainingCalls: 0,
      ttl: 'Consumed',
      issuedAt: '13:54:09 UTC',
      signature: 'ed25519:9f81c4…31b0',
      status: 'Exhausted',
    },
    {
      id: 'pass_aud_102_act',
      sessionId: 'audioshop-prev',
      merchantHost: 'audioshop.com',
      buyerAgent: 'studio-procure-2c',
      sku: 'DAC-PRO-MK2',
      capUsd: 310,
      remainingCalls: 1,
      ttl: '11m 40s',
      issuedAt: '13:58:42 UTC',
      signature: 'ed25519:4d20ae…88f1',
      status: 'Active',
    },
  ];
}

export function buildInitialSessions(
  preset: ScenarioPresetId = 'live_hold_r02',
): MerchantSession[] {
  const isFloorLeak = preset === 'floor_leak_blocked';

  const audioUpstreamOffers: OfferQuote[] = isFloorLeak
    ? [
        {
          id: 'O01',
          label: 'Legacy Clearance Leak',
          price: 189,
          perk: 'Unbundled SKU (below $198 margin floor)',
          source: 'upstream_seller',
          marginDelta: -9,
        },
        {
          id: 'O02',
          label: 'Studio Care+ Bundle',
          price: 229,
          perk: '2-yr replacement + balanced cable',
          source: 'upstream_seller',
          marginDelta: 31,
        },
      ]
    : [
        {
          id: 'O01',
          label: 'Standard Retail Offer',
          price: 219,
          perk: 'Standard 1-yr warranty · free ground',
          source: 'upstream_seller',
          marginDelta: 21,
        },
        {
          id: 'O02',
          label: 'Studio Care+ Bundle',
          price: 229,
          perk: '2-yr replacement + balanced cable',
          source: 'upstream_seller',
          marginDelta: 31,
        },
      ];

  const stagedPromoOffer: OfferQuote = {
    id: 'O03',
    label: 'Studio Wireless X Promo + IsoCase',
    price: 209,
    perk: 'Authorized retention tier + molded IsoCase ($24 value)',
    source: 'proxy_injected',
    marginDelta: 11,
  };

  const baseAudioEvents: TraceEvent[] = [
    {
      id: 'evt-aud-c01',
      seq: 101,
      code: 'C01',
      direction: 'buyer_to_seller',
      protocol: 'MCP',
      toolOrEndpoint: 'tools/call · discover_products',
      timestamp: '14:02:08.114',
      durationLabel: '2 ms',
      httpStatus: 200,
      deliveryPhase: 'observed_inbound',
      sourceActor: 'agent-7f2',
      targetActor: 'audioshop.com/mcp',
      observation:
        'Observed query: closed-back wireless studio headphones <= $230 (12 SKUs matched)',
      rawOriginalJson: JSON.stringify(
        {
          jsonrpc: '2.0',
          id: 'req_01',
          method: 'tools/call',
          params: {
            name: 'discover_products',
            arguments: {
              category: 'studio_headphones',
              max_price_usd: 230,
              latency_profile: 'low_latency_wireless',
            },
          },
        },
        null,
        2,
      ),
      headers: {
        'content-type': 'application/json',
        'x-mcp-agent-id': 'agent-7f2',
        'x-conduit-session': 'sess_aud_7f2',
        'user-agent': 'Anthropic-MCP-Client/1.4',
      },
    },
    {
      id: 'evt-aud-c02',
      seq: 102,
      code: 'C02',
      direction: 'buyer_to_seller',
      protocol: 'MCP',
      toolOrEndpoint: 'tools/call · get_offers',
      timestamp: '14:02:09.042',
      durationLabel: '1 ms',
      httpStatus: 200,
      deliveryPhase: 'observed_inbound',
      sourceActor: 'agent-7f2',
      targetActor: 'audioshop.com/mcp',
      observation:
        'Buyer requested live commercial quotes for SWX-BLK-01 (target <= $210)',
      rawOriginalJson: JSON.stringify(
        {
          jsonrpc: '2.0',
          id: 'req_02',
          method: 'tools/call',
          params: {
            name: 'get_offers',
            arguments: {
              sku: 'SWX-BLK-01',
              quantity: 1,
              buyer_budget_hint_usd: 210,
            },
          },
        },
        null,
        2,
      ),
      headers: {
        'content-type': 'application/json',
        'x-mcp-agent-id': 'agent-7f2',
        'x-conduit-session': 'sess_aud_7f2',
      },
    },
    {
      id: 'evt-aud-r02',
      seq: 103,
      code: 'R02',
      direction: 'seller_to_buyer',
      protocol: 'MCP',
      toolOrEndpoint: 'tools/result · return_offers',
      timestamp: '14:02:09.188',
      durationLabel: 'HELD · 18s',
      httpStatus: null,
      deliveryPhase: 'held_at_proxy',
      sourceActor: 'audioshop.com/mcp',
      targetActor: 'agent-7f2',
      proxyRuleId: isFloorLeak
        ? 'rule_margin_floor_guard'
        : 'rule_high_intent_quote_gate',
      observation: isFloorLeak
        ? 'HELD AT PROXY: 2 upstream offers paused (O01 $189 violates $198 floor; 0 delivered)'
        : 'HELD AT PROXY: 2 upstream offers ($219, $229) paused — 0 offers delivered to agent-7f2',
      upstreamOffers: audioUpstreamOffers,
      stagedOffer: stagedPromoOffer,
      mutationEnabled: true,
      forwardOriginalBlockedReason: isFloorLeak
        ? 'Blocked by Margin Floor Policy: upstream O01 ($189.00) is $9.00 below the $198.00 SKU floor. Replace O01 or inject compliant O03 ($209.00).'
        : undefined,
      validations: [
        {
          id: 'val-floor',
          gate: 'SKU Margin Floor ($198.00)',
          status: 'pass',
          detail: isFloorLeak
            ? 'Proposed payload replaces $189 leak with $209 (+$11.00 above floor)'
            : 'Proposed O03 ($209.00) preserves +$11.00 net margin above $198.00 floor',
        },
        {
          id: 'val-stock',
          gate: 'ATP Inventory Check',
          status: 'pass',
          detail: '42 units SWX-BLK-01 + 118 IsoCase promo units in US-West',
        },
        {
          id: 'val-schema',
          gate: 'MCP Offer Schema v2026.1',
          status: 'pass',
          detail:
            'JSON-RPC id "req_02" preserved; 3 offer objects validate cleanly',
        },
      ],
      rawOriginalJson: JSON.stringify(
        {
          jsonrpc: '2.0',
          id: 'req_02',
          result: {
            sku: 'SWX-BLK-01',
            currency: 'USD',
            offers: audioUpstreamOffers.map(o => ({
              offer_id: o.id,
              title: o.label,
              price_usd: o.price,
              terms: o.perk,
            })),
          },
        },
        null,
        2,
      ),
      wireDiffJson: isFloorLeak
        ? [
            '@@ JSON-RPC id="req_02" · audioshop.com/mcp -> agent-7f2 @@',
            ' {',
            '   "sku": "SWX-BLK-01",',
            '   "offers": [',
            '-    { "offer_id": "O01", "title": "Legacy Clearance Leak", "price_usd": 189 },',
            '+    { "offer_id": "O03", "title": "Studio Wireless X Promo + IsoCase", "price_usd": 209, "origin": "conduit_rule" },',
            '     { "offer_id": "O02", "title": "Studio Care+ Bundle", "price_usd": 229 }',
            '   ]',
            ' }',
          ].join('\n')
        : [
            '@@ JSON-RPC id="req_02" · audioshop.com/mcp -> agent-7f2 (2 -> 3 offers) @@',
            ' {',
            '   "sku": "SWX-BLK-01",',
            '   "offers": [',
            '     { "offer_id": "O01", "title": "Standard Retail Offer", "price_usd": 219 },',
            '     { "offer_id": "O02", "title": "Studio Care+ Bundle", "price_usd": 229 },',
            '+    { "offer_id": "O03", "title": "Studio Wireless X Promo + IsoCase", "price_usd": 209, "origin": "conduit_rule" }',
            '   ]',
            ' }',
          ].join('\n'),
      headers: {
        'content-type': 'application/json',
        'x-upstream-host': 'mcp.audioshop.com',
        'x-conduit-hold-state': 'HELD_OUTBOUND',
        'x-conduit-target': 'agent-7f2',
      },
    },
  ];

  // If preset === 'post_release_pass', materialize the exact post-transmission state!
  const audioSession: MerchantSession = {
    id: 'audioshop',
    merchantName: 'AudioShop',
    merchantHost: 'audioshop.com',
    categoryLabel: 'Pro Audio MCP',
    trafficProfile: 'High-Intent Quote Gate',
    buyerAgentId: 'agent-7f2',
    buyerModel: 'Claude 3.7 Sonnet · MCP',
    agentConfidence: '98.4%',
    skuCode: 'SWX-BLK-01',
    skuName: 'Studio Wireless X',
    msrpUsd: 229,
    marginFloorUsd: 198,
    selectedOfferLabel: null,
    events: baseAudioEvents,
  };

  if (preset === 'post_release_pass') {
    const deliveredList: OfferQuote[] = [
      ...audioUpstreamOffers,
      stagedPromoOffer,
    ];
    audioSession.selectedOfferLabel = 'O03 · $209.00 (Studio Promo)';
    audioSession.events = [
      baseAudioEvents[0],
      baseAudioEvents[1],
      {
        ...baseAudioEvents[2],
        durationLabel: '412 ms',
        httpStatus: 200,
        deliveryPhase: 'delivered_modified',
        deliveredOffers: deliveredList,
        deliveredAt: '14:02:11.408',
        observation:
          'DELIVERED (MODIFIED): 3 offers sent to agent-7f2 (+O03 $209.00 promo injected)',
        headers: {
          ...baseAudioEvents[2].headers,
          'x-conduit-hold-state': 'RELEASED_MODIFIED',
          'x-conduit-delivered-at': '14:02:11.408Z',
        },
      },
      {
        id: 'evt-aud-c03',
        seq: 104,
        code: 'C03',
        direction: 'buyer_to_seller',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/call · select_product',
        timestamp: '14:02:12.019',
        durationLabel: '3 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'agent-7f2',
        targetActor: 'audioshop.com/mcp',
        observation:
          'Buyer selected delivered offer O03 ($209.00) -> cart CART-8841 locked',
        rawOriginalJson: JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'req_03',
            method: 'tools/call',
            params: {
              name: 'select_product',
              arguments: {
                sku: 'SWX-BLK-01',
                selected_offer_id: 'O03',
                agreed_price_usd: 209,
                cart_id: 'CART-8841',
              },
            },
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          'x-mcp-agent-id': 'agent-7f2',
          'x-conduit-cart': 'CART-8841',
        },
      },
      {
        id: 'evt-aud-c04',
        seq: 105,
        code: 'C04',
        direction: 'buyer_to_gate',
        protocol: 'MCP',
        toolOrEndpoint: 'conduit/request_checkout_pass',
        timestamp: '14:02:12.490',
        durationLabel: 'AWAITING PASS',
        httpStatus: 202,
        deliveryPhase: 'awaiting_pass',
        sourceActor: 'agent-7f2',
        targetActor: 'conduit.pass.authority',
        observation:
          'Checkout paused awaiting scoped capability pass ($209.00 cap · SWX-BLK-01)',
        passRequest: {
          requestId: 'req_pass_7f2',
          sku: 'SWX-BLK-01',
          requestedCap: 209,
          ttl: '15m 00s',
          agentFingerprint: 'spiffe://agents.buyer/claude-3.7/agent-7f2',
        },
        validations: [
          {
            id: 'vp-1',
            gate: 'Agreed Quote Match',
            status: 'pass',
            detail: 'Requested $209.00 matches delivered offer O03 exactly',
          },
          {
            id: 'vp-2',
            gate: 'Single-Use Replay Lock',
            status: 'pass',
            detail: 'Bound to CART-8841 · 1 call max · 15m TTL',
          },
        ],
        rawOriginalJson: JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'req_04',
            method: 'conduit/request_checkout_pass',
            params: {
              cart_id: 'CART-8841',
              sku: 'SWX-BLK-01',
              offer_id: 'O03',
              amount_cap_usd: 209,
              ttl_seconds: 900,
            },
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          'x-mcp-agent-id': 'agent-7f2',
          'x-conduit-gate': 'PASS_AUTHORITY',
        },
      },
    ];
  }

  // Session 2: DisplayCo — Pure 95% catalog discovery traffic (0 held, 0 awaiting pass, drawer closed!)
  const displayCoSession: MerchantSession = {
    id: 'displayco',
    merchantName: 'DisplayCo',
    merchantHost: 'mcp.displayco.io',
    categoryLabel: '95% Discovery Traffic',
    trafficProfile: 'Read-Only Browsing (No Hold)',
    buyerAgentId: 'research-crawler-19b',
    buyerModel: 'GPT-4.1 Mini · Spec Crawler',
    agentConfidence: '99.1%',
    skuCode: 'DSP-5K-27M',
    skuName: '27" 5K Reference Monitor',
    msrpUsd: 1499,
    marginFloorUsd: 1320,
    selectedOfferLabel: null,
    events: [
      {
        id: 'evt-dsp-01',
        seq: 201,
        code: 'D01',
        direction: 'buyer_to_seller',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/call · search_catalog',
        timestamp: '14:01:41.008',
        durationLabel: '3 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'research-crawler-19b',
        targetActor: 'mcp.displayco.io',
        observation:
          'Catalog query: 27-inch 5K DCI-P3 displays (8 models returned)',
        rawOriginalJson: JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'dsp_01',
            method: 'tools/call',
            params: {name: 'search_catalog', arguments: {panel: '5K_IPS'}},
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          'x-mcp-agent-id': 'research-crawler-19b',
        },
      },
      {
        id: 'evt-dsp-02',
        seq: 202,
        code: 'D02',
        direction: 'seller_to_buyer',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/result · catalog_page',
        timestamp: '14:01:41.019',
        durationLabel: '11 ms',
        httpStatus: 200,
        deliveryPhase: 'delivered_original',
        sourceActor: 'mcp.displayco.io',
        targetActor: 'research-crawler-19b',
        deliveredAt: '14:01:41.019',
        observation:
          'Forwarded unmodified (8 SKUs) — read-only discovery, no quote intervention needed',
        rawOriginalJson: JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'dsp_01',
            result: {count: 8, top_sku: 'DSP-5K-27M', msrp_usd: 1499},
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          'x-conduit-hold-state': 'PASSTHROUGH',
        },
      },
      {
        id: 'evt-dsp-03',
        seq: 203,
        code: 'D03',
        direction: 'buyer_to_seller',
        protocol: 'HTTP',
        toolOrEndpoint: 'GET /v2/specs/DSP-5K-27M.json',
        timestamp: '14:01:42.310',
        durationLabel: '6 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'research-crawler-19b',
        targetActor: 'mcp.displayco.io',
        observation:
          'Fetched colorimetry & Thunderbolt 4 spec sheet (no cart or checkout attempt)',
        rawOriginalJson: JSON.stringify(
          {
            sku: 'DSP-5K-27M',
            brightness_nits: 600,
            delta_e: '< 1.0',
            stock_status: 'in_stock',
          },
          null,
          2,
        ),
        headers: {
          accept: 'application/json',
          'x-mcp-agent-id': 'research-crawler-19b',
        },
      },
      {
        id: 'evt-dsp-04',
        seq: 204,
        code: 'D04',
        direction: 'buyer_to_seller',
        protocol: 'HTTP',
        toolOrEndpoint: 'GET /v2/shipping-zones?zip=94107',
        timestamp: '14:01:43.105',
        durationLabel: '4 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'research-crawler-19b',
        targetActor: 'mcp.displayco.io',
        observation:
          'Checked lead-time estimate (2-day freight); agent exited without requesting quotes',
        rawOriginalJson: JSON.stringify(
          {zip: '94107', standard_days: 2, freight_usd: 0},
          null,
          2,
        ),
        headers: {
          accept: 'application/json',
          'x-mcp-agent-id': 'research-crawler-19b',
        },
      },
    ],
  };

  // Session 3: Skyport — Demonstrates 0 proxy-held packets while Payment awaits a capability pass!
  const skyportSession: MerchantSession = {
    id: 'skyport',
    merchantName: 'Skyport Air',
    merchantHost: 'mcp.skyport.aero',
    categoryLabel: 'Flight Checkout Gate',
    trafficProfile: '0 Held · 1 Awaiting Pass',
    buyerAgentId: 'travel-bot-44a',
    buyerModel: 'Gemini 2.5 Pro · Travel MCP',
    agentConfidence: '96.8%',
    skuCode: 'SFO-JFK-FLEX-21A',
    skuName: 'SFO -> JFK Main Cabin Flex',
    msrpUsd: 642,
    marginFloorUsd: 590,
    selectedOfferLabel: 'O01 · $642.00 Published Flex',
    events: [
      {
        id: 'evt-sky-c01',
        seq: 301,
        code: 'C01',
        direction: 'buyer_to_seller',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/call · search_flights',
        timestamp: '14:00:12.044',
        durationLabel: '14 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'travel-bot-44a',
        targetActor: 'mcp.skyport.aero',
        observation: 'Searched non-stop SFO -> JFK morning departures',
        rawOriginalJson: JSON.stringify(
          {origin: 'SFO', destination: 'JFK', cabin: 'MAIN_FLEX'},
          null,
          2,
        ),
        headers: {'content-type': 'application/json'},
      },
      {
        id: 'evt-sky-r02',
        seq: 302,
        code: 'R02',
        direction: 'seller_to_buyer',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/result · return_offers',
        timestamp: '14:00:12.390',
        durationLabel: '9 ms',
        httpStatus: 200,
        deliveryPhase: 'delivered_original',
        sourceActor: 'mcp.skyport.aero',
        targetActor: 'travel-bot-44a',
        deliveredAt: '14:00:12.390',
        observation:
          'DELIVERED (ORIGINAL): 2 published fares ($642, $710) forwarded automatically',
        rawOriginalJson: JSON.stringify(
          {
            offers: [
              {offer_id: 'O01', fare_usd: 642},
              {offer_id: 'O02', fare_usd: 710},
            ],
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          'x-conduit-hold-state': 'PASSTHROUGH',
        },
      },
      {
        id: 'evt-sky-c03',
        seq: 303,
        code: 'C03',
        direction: 'buyer_to_seller',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/call · hold_itinerary',
        timestamp: '14:00:14.112',
        durationLabel: '7 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'travel-bot-44a',
        targetActor: 'mcp.skyport.aero',
        observation: 'Itinerary PNR-7K2M locked at $642.00',
        rawOriginalJson: JSON.stringify(
          {pnr: 'PNR-7K2M', offer_id: 'O01', amount_usd: 642},
          null,
          2,
        ),
        headers: {'content-type': 'application/json'},
      },
      {
        id: 'evt-sky-c04',
        seq: 304,
        code: 'C04',
        direction: 'buyer_to_gate',
        protocol: 'MCP',
        toolOrEndpoint: 'conduit/request_checkout_pass',
        timestamp: '14:00:15.004',
        durationLabel: 'AWAITING PASS',
        httpStatus: 202,
        deliveryPhase: 'awaiting_pass',
        sourceActor: 'travel-bot-44a',
        targetActor: 'conduit.pass.authority',
        observation:
          '0 frames held in proxy; checkout awaits $642.00 capability pass approval',
        passRequest: {
          requestId: 'req_pass_sky_44a',
          sku: 'SFO-JFK-FLEX-21A',
          requestedCap: 642,
          ttl: '10m 00s',
          agentFingerprint: 'spiffe://agents.corp/gemini-2.5/travel-bot-44a',
        },
        validations: [
          {
            id: 'v-sky-1',
            gate: 'Fare Policy Ceiling ($700.00)',
            status: 'pass',
            detail: '$642.00 fare within corporate domestic ceiling',
          },
          {
            id: 'v-sky-2',
            gate: 'Merchant Host Pinning',
            status: 'pass',
            detail: 'Scoped strictly to mcp.skyport.aero · PNR-7K2M',
          },
        ],
        rawOriginalJson: JSON.stringify(
          {
            method: 'conduit/request_checkout_pass',
            params: {
              pnr: 'PNR-7K2M',
              sku: 'SFO-JFK-FLEX-21A',
              amount_cap_usd: 642,
              ttl_seconds: 600,
            },
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          'x-conduit-gate': 'PASS_AUTHORITY',
        },
      },
    ],
  };

  // Session 4: Cloudstore — Completed historical execution (shows historical R02 diff locked)
  const cloudstoreSession: MerchantSession = {
    id: 'cloudstore',
    merchantName: 'Cloudstore',
    merchantHost: 'api.cloudstore.dev',
    categoryLabel: 'Completed Settlement',
    trafficProfile: 'Historical · Settled',
    buyerAgentId: 'infra-buyer-09',
    buyerModel: 'OpenAI o3 · Infra Agent',
    agentConfidence: '99.6%',
    skuCode: 'GPU-H100-SPOT-24H',
    skuName: '8x H100 Spot Reservation (24h)',
    msrpUsd: 520,
    marginFloorUsd: 440,
    selectedOfferLabel: 'O03 · $480.00 Off-Peak Commit',
    events: [
      {
        id: 'evt-cld-c02',
        seq: 401,
        code: 'C02',
        direction: 'buyer_to_seller',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/call · get_offers',
        timestamp: '13:53:58.110',
        durationLabel: '2 ms',
        httpStatus: 200,
        deliveryPhase: 'observed_inbound',
        sourceActor: 'infra-buyer-09',
        targetActor: 'api.cloudstore.dev',
        observation: 'Requested 24h 8x H100 compute reservation quotes',
        rawOriginalJson: JSON.stringify(
          {sku: 'GPU-H100-SPOT-24H', hours: 24},
          null,
          2,
        ),
        headers: {'content-type': 'application/json'},
      },
      {
        id: 'evt-cld-r02',
        seq: 402,
        code: 'R02',
        direction: 'seller_to_buyer',
        protocol: 'MCP',
        toolOrEndpoint: 'tools/result · return_offers',
        timestamp: '13:54:02.880',
        durationLabel: '310 ms',
        httpStatus: 200,
        deliveryPhase: 'delivered_modified',
        sourceActor: 'api.cloudstore.dev',
        targetActor: 'infra-buyer-09',
        proxyRuleId: 'rule_offpeak_gpu_tier',
        deliveredAt: '13:54:02.880',
        upstreamOffers: [
          {
            id: 'O01',
            label: 'On-Demand 24h Block',
            price: 520,
            perk: 'Immediate allocation',
            source: 'upstream_seller',
            marginDelta: 80,
          },
        ],
        stagedOffer: {
          id: 'O03',
          label: 'Off-Peak Preemptible Commit',
          price: 480,
          perk: 'US-East-2 idle cluster · +$40 above floor',
          source: 'proxy_injected',
          marginDelta: 40,
        },
        deliveredOffers: [
          {
            id: 'O01',
            label: 'On-Demand 24h Block',
            price: 520,
            perk: 'Immediate allocation',
            source: 'upstream_seller',
            marginDelta: 80,
          },
          {
            id: 'O03',
            label: 'Off-Peak Preemptible Commit',
            price: 480,
            perk: 'US-East-2 idle cluster · +$40 above floor',
            source: 'proxy_injected',
            marginDelta: 40,
          },
        ],
        observation:
          'HISTORICAL (MODIFIED): 2 offers delivered at 13:54:02 (+O03 $480 off-peak tier)',
        rawOriginalJson: JSON.stringify(
          {offers: [{offer_id: 'O01', price_usd: 520}]},
          null,
          2,
        ),
        wireDiffJson: [
          '@@ Historical Delivery · 13:54:02.880 UTC @@',
          '   "offers": [',
          '     { "offer_id": "O01", "price_usd": 520 },',
          '+    { "offer_id": "O03", "price_usd": 480, "origin": "conduit_rule" }',
          '   ]',
        ].join('\n'),
        headers: {
          'content-type': 'application/json',
          'x-conduit-hold-state': 'RELEASED_MODIFIED',
        },
      },
      {
        id: 'evt-cld-c05',
        seq: 403,
        code: 'C05',
        direction: 'buyer_to_seller',
        protocol: 'HTTP',
        toolOrEndpoint: 'POST /v1/orders/confirm',
        timestamp: '13:54:10.204',
        durationLabel: '19 ms',
        httpStatus: 200,
        deliveryPhase: 'pass_authorized',
        sourceActor: 'infra-buyer-09',
        targetActor: 'api.cloudstore.dev',
        observation:
          'Order ORD-44910 settled ($480.00) via pass_cld_811_act (single-use consumed)',
        rawOriginalJson: JSON.stringify(
          {
            order_id: 'ORD-44910',
            pass_id: 'pass_cld_811_act',
            settled_usd: 480,
          },
          null,
          2,
        ),
        headers: {
          'content-type': 'application/json',
          authorization: 'ConduitPass pass_cld_811_act',
        },
      },
    ],
  };

  return [audioSession, displayCoSession, skyportSession, cloudstoreSession];
}
