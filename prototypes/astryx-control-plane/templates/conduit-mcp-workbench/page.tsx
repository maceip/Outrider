// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useMemo, useState, type CSSProperties} from 'react';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  StackItem,
  VStack,
} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useMediaQuery} from '@astryxdesign/core/hooks';


type SurfaceId = 'overview' | 'graph' | 'wire' | 'passes';
type TraceFilterId = 'all' | 'mcp' | 'http' | 'attention' | 'modified';
type CommerceStage =
  | 'Discover'
  | 'Negotiate'
  | 'Cart'
  | 'Payment'
  | 'Fulfill';

type DeliveryPhase =
  | 'observed_inbound'
  | 'delivered_original'
  | 'held_at_proxy'
  | 'delivered_modified'
  | 'awaiting_pass'
  | 'pass_authorized';

interface OfferQuote {
  id: string;
  label: string;
  price: number;
  perk: string;
  source: 'upstream_seller' | 'proxy_injected';
  marginDelta: number; // relative to marginFloor
}

interface ValidationCheck {
  id: string;
  gate: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

interface TraceEvent {
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

interface CapabilityPassRecord {
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

interface MerchantSession {
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

type ScenarioPresetId =
  | 'live_hold_r02'
  | 'floor_leak_blocked'
  | 'post_release_pass'
  | 'discovery_95pct';

interface CanonicalWorkspaceMetrics {
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

const STAGE_ORDER: readonly CommerceStage[] = [
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
function deriveWorkspaceMetrics(
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

function buildInitialPasses(): CapabilityPassRecord[] {
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

function buildInitialSessions(
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

interface CausalObservatoryGraphProps {
  session: MerchantSession;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  expanded?: boolean;
}

const graphStyles: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-body)',
    overflow: 'hidden',
  },
  headerBar: {
    padding: 'var(--spacing-2) var(--spacing-3)',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  canvas: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: 'var(--spacing-3)',
  },
  selectedRing: {
    borderRadius: 'var(--radius-container)',
    outline: '1.5px solid var(--color-border-emphasized)',
    outlineOffset: -1,
  },
  unreachedNode: {
    borderRadius: 'var(--radius-container)',
    border: 'var(--border-width) dashed var(--color-border)',
    padding: 'var(--spacing-3)',
    opacity: 0.72,
  },
  summaryBar: {
    padding: 'var(--spacing-2) var(--spacing-3)',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
  },
};

function getNodeStatusText(ev: TraceEvent): string {
  switch (ev.deliveryPhase) {
    case 'held_at_proxy':
      return 'Held';
    case 'awaiting_pass':
      return 'Awaiting pass';
    case 'delivered_modified':
      return 'Modified';
    case 'pass_authorized':
      return 'Settled';
    case 'delivered_original':
    case 'observed_inbound':
    default:
      return `${ev.httpStatus ?? 200}`;
  }
}

function getActorRole(ev: TraceEvent): string {
  if (
    ev.deliveryPhase === 'held_at_proxy' ||
    ev.deliveryPhase === 'awaiting_pass' ||
    ev.deliveryPhase === 'delivered_modified'
  ) {
    return 'Proxy';
  }
  return ev.direction === 'seller_to_buyer' ? 'Seller' : 'Buyer';
}

function CausalObservatoryGraph({
  session,
  selectedEventId,
  onSelectEvent,
  expanded = false,
}: CausalObservatoryGraphProps) {
  const offerEvent = session.events.find(
    e =>
      (e.upstreamOffers && e.upstreamOffers.length > 0) ||
      (e.deliveredOffers && e.deliveredOffers.length > 0),
  );
  const heldR02 = session.events.find(
    e => e.deliveryPhase === 'held_at_proxy',
  );

  const upstreamSummary = (offerEvent?.upstreamOffers ?? [])
    .map(o => `${o.id} $${o.price}`)
    .join(', ');

  const stagedSummary = offerEvent?.stagedOffer
    ? offerEvent.deliveryPhase === 'delivered_modified'
      ? `Delivered +${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price}`
      : offerEvent.mutationEnabled !== false
        ? `Staged +${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price} (undelivered)`
        : `${offerEvent.stagedOffer.id} mutation disabled`
    : null;

  return (
    <div style={graphStyles.root}>
      <div style={graphStyles.headerBar}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="label" color="secondary">
                Causal Observatory
              </Text>
              <Text type="supporting" color="secondary">
                {session.buyerAgentId} → Conduit → {session.merchantHost}
              </Text>
            </HStack>
          </StackItem>
          <HStack gap={1.5} vAlign="center">
            <StatusDot
              variant={heldR02 ? 'warning' : 'neutral'}
              isPulsing={Boolean(heldR02)}
              label={
                heldR02
                  ? `${heldR02.code} held at proxy`
                  : 'Wire synchronized'
              }
            />
            <Text type="supporting" color="secondary">
              {heldR02 ? `${heldR02.code} held (undelivered)` : 'Synchronized'}
            </Text>
          </HStack>
        </HStack>
      </div>

      <div style={graphStyles.canvas}>
        <VStack gap={3}>
          <Grid columns={{minWidth: expanded ? 220 : 172, max: 5, repeat: 'fit'}} gap={2}>
            {session.events.map((ev, idx) => {
              const isSelected = ev.id === selectedEventId;
              const isHeld = ev.deliveryPhase === 'held_at_proxy';
              const isPassGate = ev.deliveryPhase === 'awaiting_pass';
              const statusText = getNodeStatusText(ev);

              return (
                <div
                  key={ev.id}
                  data-testid={`graph-node-${ev.code}`}
                  style={isSelected ? graphStyles.selectedRing : undefined}>
                  <ClickableCard
                    variant={isSelected ? 'muted' : 'default'}
                    padding={expanded ? 3 : 2}
                    height="100%"
                    label={`Inspect ${ev.code} ${ev.toolOrEndpoint}`}
                    onClick={() => onSelectEvent(ev.id)}>
                    <VStack gap={1.5}>
                      <HStack gap={1.5} vAlign="center">
                        <StackItem size="fill">
                          <HStack gap={1.5} vAlign="center">
                            {(isHeld || isPassGate) && (
                              <StatusDot
                                variant={isHeld ? 'warning' : 'accent'}
                                isPulsing={isHeld}
                                label={statusText}
                              />
                            )}
                            <Text
                              type="code"
                              size="2xs"
                              weight="semibold"
                              hasTabularNumbers>
                              {idx + 1}. {ev.code}
                            </Text>
                            <Text
                              type="supporting"
                              size="2xs"
                              color="secondary"
                              maxLines={1}>
                              {getActorRole(ev)}
                            </Text>
                          </HStack>
                        </StackItem>
                        <Text
                          type="code"
                          size="2xs"
                          color={isHeld ? 'primary' : 'secondary'}
                          weight={isHeld ? 'semibold' : 'normal'}
                          hasTabularNumbers>
                          {statusText}
                        </Text>
                      </HStack>

                      <VStack gap={0.5}>
                        <Text
                          type="code"
                          size="2xs"
                          weight="medium"
                          maxLines={1}>
                          {ev.toolOrEndpoint}
                        </Text>
                        <Text
                          type="supporting"
                          size="2xs"
                          color="secondary"
                          maxLines={expanded ? 3 : 2}>
                          {ev.observation}
                        </Text>
                      </VStack>

                      <Divider />

                      <HStack gap={2} vAlign="center">
                        <StackItem size="fill">
                          <Text type="supporting" size="3xs" color="secondary">
                            {ev.direction === 'buyer_to_seller'
                              ? 'Buyer → Seller'
                              : ev.direction === 'buyer_to_gate'
                                ? 'Buyer → Gate'
                                : 'Seller → Buyer'}
                          </Text>
                        </StackItem>
                        <Text
                          type="code"
                          size="3xs"
                          color="secondary"
                          hasTabularNumbers>
                          {ev.durationLabel}
                        </Text>
                      </HStack>
                    </VStack>
                  </ClickableCard>
                </div>
              );
            })}

            {heldR02 && (
              <div
                data-testid="graph-node-unreached-downstream"
                style={graphStyles.unreachedNode}>
                <VStack gap={1.5}>
                  <HStack gap={2} vAlign="center">
                    <StackItem size="fill">
                      <Text type="code" size="2xs" color="secondary">
                        Next · C03
                      </Text>
                    </StackItem>
                    <Text type="supporting" size="2xs" color="secondary">
                      Unreached
                    </Text>
                  </HStack>
                  <Text
                    type="supporting"
                    size="2xs"
                    color="secondary"
                    maxLines={3}>
                    {session.buyerAgentId} has 0 offers while {heldR02.code} is
                    held. select_product runs only after release.
                  </Text>
                </VStack>
              </div>
            )}
          </Grid>

          {offerEvent && (
            <div style={graphStyles.summaryBar}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <Text
                    type="supporting"
                    color="secondary"
                    hasTabularNumbers>
                    {offerEvent.code} quotes · Floor ${session.marginFloorUsd} ·
                    Observed: {upstreamSummary}
                    {stagedSummary ? ` · ${stagedSummary}` : ''}
                  </Text>
                </StackItem>
                <Text
                  type="supporting"
                  color="secondary"
                  hasTabularNumbers>
                  {offerEvent.deliveryPhase === 'held_at_proxy'
                    ? `${offerEvent.upstreamOffers?.length ?? 2} observed → ${
                        offerEvent.mutationEnabled !== false
                          ? (offerEvent.upstreamOffers?.length ?? 2) + 1
                          : (offerEvent.upstreamOffers?.length ?? 2)
                      } proposed`
                    : offerEvent.deliveryPhase === 'delivered_modified'
                      ? `${offerEvent.deliveredOffers?.length ?? 3} delivered`
                      : 'Delivered unmodified'}
                </Text>
              </HStack>
            </div>
          )}

          {expanded && (
            <div style={graphStyles.summaryBar}>
              <MetadataList columns="auto">
                <MetadataListItem label="Buyer agent">
                  <Text type="body">
                    {session.buyerAgentId} · {session.buyerModel} (
                    {session.agentConfidence})
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Traffic posture">
                  <Text type="body">
                    {session.trafficProfile}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Unit economics">
                  <Text type="body" hasTabularNumbers>
                    {session.skuCode} · Floor ${session.marginFloorUsd}.00 /
                    MSRP ${session.msrpUsd}.00
                  </Text>
                </MetadataListItem>
              </MetadataList>
            </div>
          )}
        </VStack>
      </div>
    </div>
  );
}

interface DenseTraceTableProps {
  events: TraceEvent[];
  activeFilter: TraceFilterId;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  onResetFilter: () => void;
}

const traceStyles: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  groupHeader: {
    padding: 'var(--spacing-2) var(--spacing-3)',
    backgroundColor: 'var(--color-background-muted)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  rows: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
};

function formatPhaseLabel(phase: DeliveryPhase, httpStatus: number | null): string {
  switch (phase) {
    case 'held_at_proxy':
      return 'Held at proxy';
    case 'awaiting_pass':
      return 'Awaiting pass';
    case 'delivered_modified':
      return `${httpStatus ?? 200} · Modified`;
    case 'pass_authorized':
      return `${httpStatus ?? 200} · Settled`;
    case 'delivered_original':
      return `${httpStatus ?? 200} · Delivered`;
    case 'observed_inbound':
    default:
      return `${httpStatus ?? 200}`;
  }
}

function filterTraceEvents(
  events: TraceEvent[],
  filter: TraceFilterId,
): TraceEvent[] {
  switch (filter) {
    case 'mcp':
      return events.filter(e => e.protocol === 'MCP');
    case 'http':
      return events.filter(e => e.protocol === 'HTTP');
    case 'attention':
      return events.filter(
        e =>
          e.deliveryPhase === 'held_at_proxy' ||
          e.deliveryPhase === 'awaiting_pass',
      );
    case 'modified':
      return events.filter(
        e =>
          e.deliveryPhase === 'delivered_modified' ||
          e.deliveryPhase === 'held_at_proxy',
      );
    case 'all':
    default:
      return events;
  }
}

function DenseTraceTable({
  events,
  activeFilter,
  selectedEventId,
  onSelectEvent,
  onResetFilter,
}: DenseTraceTableProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [isNarrow, setIsNarrow] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 800;
      setIsNarrow(w < 680);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const filtered = filterTraceEvents(events, activeFilter);

  return (
    <div ref={containerRef} style={traceStyles.root}>
      <div style={traceStyles.groupHeader}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center">
              <Text type="label" color="secondary">
                Execution Trace
              </Text>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {filtered.length}
                {filtered.length !== events.length ? ` of ${events.length}` : ''}
              </Text>
            </HStack>
          </StackItem>
          {!isNarrow && (
            <Text type="supporting" color="secondary">
              Select a row to inspect frame
            </Text>
          )}
        </HStack>
      </div>

      <div style={traceStyles.rows}>
        {filtered.length === 0 ? (
          <VStack padding={4}>
            <EmptyState
              title="No matching trace frames"
              description="Clear the active filter to see the full execution sequence."
              primaryAction={{
                label: 'Show all frames',
                onClick: onResetFilter,
              }}
              isCompact
            />
          </VStack>
        ) : (
          <List density="compact" hasDividers>
            {filtered.map(ev => {
              const isHeld = ev.deliveryPhase === 'held_at_proxy';
              const isPass = ev.deliveryPhase === 'awaiting_pass';
              const directionLabel =
                ev.direction === 'buyer_to_seller'
                  ? 'Buyer → Seller'
                  : ev.direction === 'buyer_to_gate'
                    ? 'Buyer → Gate'
                    : 'Seller → Buyer';
              const phaseLabel = formatPhaseLabel(
                ev.deliveryPhase,
                ev.httpStatus,
              );

              return (
                <div key={ev.id} data-testid={`trace-row-${ev.code}`}>
                  <ListItem
                    isSelected={ev.id === selectedEventId}
                    onClick={() => onSelectEvent(ev.id)}
                    startContent={
                      <StatusDot
                        variant={
                          isHeld
                            ? 'warning'
                            : isPass
                              ? 'accent'
                              : 'neutral'
                        }
                        isPulsing={isHeld}
                        label={phaseLabel}
                      />
                    }
                    label={`${ev.code} · ${ev.toolOrEndpoint}`}
                    description={`${ev.protocol} · ${directionLabel} · ${ev.observation}`}
                    endContent={
                      <HStack gap={3} vAlign="center">
                        {!isNarrow && (
                          <Text
                            type="code"
                            size="2xs"
                            color="secondary"
                            hasTabularNumbers>
                            {ev.durationLabel}
                          </Text>
                        )}
                        <Text
                          type="code"
                          size="2xs"
                          color={isHeld ? 'primary' : 'secondary'}
                          weight={isHeld ? 'semibold' : 'normal'}
                          hasTabularNumbers>
                          {phaseLabel}
                        </Text>
                      </HStack>
                    }
                  />
                </div>
              );
            })}
          </List>
        )}
      </div>
    </div>
  );
}

interface CanonicalInspectorPanelProps {
  session: MerchantSession;
  event: TraceEvent | null;
  inBottomSheet?: boolean;
  onToggleMutation: (eventId: string, nextEnabled: boolean) => void;
  onTransmitModified: (eventId: string) => void;
  onForwardOriginal: (eventId: string) => void;
  onAuthorizePass: (eventId: string) => void;
  onRejectPass: (eventId: string) => void;
  onClose: () => void;
}

const inspectorStyles: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  rootSheet: {
    height: '76dvh',
    maxHeight: '76dvh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  header: {
    padding: 'var(--spacing-3) var(--spacing-4)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  scrollBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 'var(--spacing-4)',
  },
  footer: {
    padding: 'var(--spacing-3) var(--spacing-4)',
    borderTop: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
    flexShrink: 0,
  },
};

function CanonicalInspectorPanel({
  session,
  event,
  inBottomSheet = false,
  onToggleMutation,
  onTransmitModified,
  onForwardOriginal,
  onAuthorizePass,
  onRejectPass,
  onClose,
}: CanonicalInspectorPanelProps) {
  const [payloadReviewed, setPayloadReviewed] = useState(true);

  if (!event) {
    return (
      <VStack padding={4}>
        <EmptyState
          title="No frame selected"
          description="Select a node in the Causal Observatory or a row in the trace to inspect its wire frame and policy gates."
          isCompact
        />
      </VStack>
    );
  }

  const isHeldQuote = event.deliveryPhase === 'held_at_proxy';
  const isHistoricalModified = event.deliveryPhase === 'delivered_modified';
  const isOfferFrame =
    Boolean(event.upstreamOffers && event.upstreamOffers.length > 0) ||
    isHeldQuote ||
    isHistoricalModified;
  const isAwaitingPass = event.deliveryPhase === 'awaiting_pass';

  const upstreamCount = event.upstreamOffers?.length ?? 0;
  const mutationOn = event.mutationEnabled !== false;
  const isFloorLeakReplacement = Boolean(event.forwardOriginalBlockedReason);
  const proposedCount = mutationOn
    ? isFloorLeakReplacement
      ? upstreamCount
      : upstreamCount + 1
    : upstreamCount;

  const panelTitle = isHeldQuote
    ? 'Quote Approval'
    : isHistoricalModified
      ? 'Historical Quote Record'
      : isAwaitingPass
        ? 'Checkout Pass Gate'
        : 'Frame Details';

  const outboundOffers = isHistoricalModified
    ? (event.deliveredOffers ?? [])
    : [
        ...(event.upstreamOffers ?? []).filter(
          o => !(o.marginDelta < 0 && mutationOn && isFloorLeakReplacement),
        ),
        ...(mutationOn && event.stagedOffer ? [event.stagedOffer] : []),
      ];

  return (
    <div
      data-testid="canonical-inspector-panel"
      style={inBottomSheet ? inspectorStyles.rootSheet : inspectorStyles.root}>
      {/* Inspector Header — matches incident-console IncidentInspector */}
      <div style={inspectorStyles.header}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <VStack gap={0.5}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot
                  variant={
                    isHeldQuote
                      ? 'warning'
                      : isAwaitingPass
                        ? 'accent'
                        : 'neutral'
                  }
                  isPulsing={isHeldQuote}
                  label={panelTitle}
                />
                <Text type="supporting" color="secondary">
                  {event.code} · {event.protocol}
                </Text>
              </HStack>
              <Heading level={4}>{panelTitle}</Heading>
            </VStack>
          </StackItem>
          <Button
            size="sm"
            variant="ghost"
            label="Close"
            onClick={onClose}
          />
        </HStack>
      </div>

      {/* Scrollable Inspector Body — flat VStack + Divider + MetadataList + List (zero Cards, zero Badges) */}
      <div style={inspectorStyles.scrollBody}>
        <VStack gap={4}>
          {isHeldQuote && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot
                  variant="warning"
                  isPulsing
                  label="Held at proxy"
                />
                <Text type="label">Held at proxy · Not delivered to buyer</Text>
              </HStack>
              <Text type="supporting" color="secondary">
                {event.sourceActor} returned {upstreamCount} offers. Conduit
                paused outbound delivery — {event.targetActor} has received 0
                offers so far.
              </Text>
            </VStack>
          )}

          {isHistoricalModified && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="success" label="Delivered" />
                <Text type="label">
                  Delivered at {event.deliveredAt ?? event.timestamp} ·
                  Historical record
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                Transmitted {event.deliveredOffers?.length ?? proposedCount}{' '}
                offers to {event.targetActor}. Wire payload is immutable and
                mutation controls are locked.
              </Text>
            </VStack>
          )}

          {event.deliveryPhase === 'delivered_original' && isOfferFrame && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="success" label="Delivered unmodified" />
                <Text type="label">
                  Delivered unmodified at {event.deliveredAt ?? event.timestamp}
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                Original seller response was forwarded directly to{' '}
                {event.targetActor} with zero proxy mutations.
              </Text>
            </VStack>
          )}

          {isAwaitingPass && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="accent" label="Checkout pass requested" />
                <Text type="label">
                  Checkout pass requested · 0 frames held in proxy
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                {event.sourceActor} selected an offer and is requesting a
                single-use capability pass ($
                {event.passRequest?.requestedCap ?? 0}.00 cap) before payment
                execution.
              </Text>
            </VStack>
          )}

          <Divider />

          <MetadataList columns="single" label={{position: 'start', width: 92}}>
            <MetadataListItem label="Direction">
              <Text type="body">
                {event.direction === 'seller_to_buyer'
                  ? 'Outbound response (Seller → Buyer)'
                  : event.direction === 'buyer_to_gate'
                    ? 'Pass gate (Buyer → Conduit)'
                    : 'Inbound request (Buyer → Seller)'}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Source">
              <Text type="code" size="2xs">
                {event.sourceActor}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Recipient">
              <Text type="code" size="2xs">
                {event.targetActor}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Tool / URI">
              <Text type="code" size="2xs">
                {event.toolOrEndpoint}
              </Text>
            </MetadataListItem>
            {event.proxyRuleId && (
              <MetadataListItem label="Rule gate">
                <Text type="code" size="2xs">
                  {event.proxyRuleId}
                </Text>
              </MetadataListItem>
            )}
          </MetadataList>

          {/* Offer Semantic Diff — Edge-to-edge List rows with Dividers */}
          {isOfferFrame && event.upstreamOffers && (
            <>
              <Divider />
              <VStack gap={3}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Heading level={5}>Offer Diff</Heading>
                  </StackItem>
                  <Text
                    type="supporting"
                    color="secondary"
                    hasTabularNumbers>
                    {isHistoricalModified
                      ? `${upstreamCount} observed → ${event.deliveredOffers?.length ?? proposedCount} delivered`
                      : `${upstreamCount} original → ${proposedCount} proposed`}
                  </Text>
                </HStack>

                <VStack gap={1}>
                  <Text type="label" color="secondary">
                    Observed from {session.merchantHost}
                  </Text>
                  <List density="compact" hasDividers>
                    {event.upstreamOffers.map(off => {
                      const violatesFloor = off.marginDelta < 0;
                      const replacedByRule =
                        violatesFloor && mutationOn && isFloorLeakReplacement;
                      return (
                        <ListItem
                          key={off.id}
                          startContent={
                            violatesFloor ? (
                              <StatusDot
                                variant="error"
                                label="Below margin floor"
                              />
                            ) : undefined
                          }
                          label={
                            <Text
                              type="body"
                              hasStrikethrough={replacedByRule}>
                              {off.id} · {off.label}
                            </Text>
                          }
                          description={
                            violatesFloor
                              ? `${off.perk} · -$${Math.abs(off.marginDelta)}.00 below $${session.marginFloorUsd} floor`
                              : off.perk
                          }
                          endContent={
                            <Text
                              type="code"
                              size="2xs"
                              hasTabularNumbers>
                              ${off.price}.00
                            </Text>
                          }
                        />
                      );
                    })}
                  </List>
                </VStack>

                {event.stagedOffer && (
                  <VStack gap={1.5}>
                    <Text type="label" color="secondary">
                      Protocol mutation (result.offers[])
                    </Text>
                    <Switch
                      width="100%"
                      labelSpacing="spread"
                      label={
                        isFloorLeakReplacement
                          ? `Replace O01 ($189.00) with ${event.stagedOffer.id} ($${event.stagedOffer.price}.00)`
                          : `Append ${event.stagedOffer.id} ($${event.stagedOffer.price}.00) to result.offers[]`
                      }
                      description={`${event.stagedOffer.label} · +$${event.stagedOffer.marginDelta}.00 above $${session.marginFloorUsd} SKU floor`}
                      value={mutationOn}
                      isDisabled={!isHeldQuote}
                      onChange={val => onToggleMutation(event.id, val)}
                      status={
                        !isHeldQuote
                          ? {
                              type: 'success',
                              message:
                                'Locked: response was already transmitted to buyer.',
                            }
                          : undefined
                      }
                    />
                  </VStack>
                )}

                <VStack gap={1}>
                  <Text type="label" color="secondary">
                    {isHistoricalModified
                      ? `Delivered to ${event.targetActor}`
                      : `Proposed outbound to ${event.targetActor}`}
                  </Text>
                  <List density="compact" hasDividers>
                    {outboundOffers.map(o => (
                      <ListItem
                        key={o.id}
                        label={`${o.id} · ${o.label}`}
                        description={
                          o.source === 'proxy_injected'
                            ? 'Added by Conduit rule'
                            : 'Upstream seller offer'
                        }
                        endContent={
                          <Text type="code" size="2xs" hasTabularNumbers>
                            ${o.price}.00
                          </Text>
                        }
                      />
                    ))}
                  </List>
                </VStack>
              </VStack>
            </>
          )}

          {/* Checkout Pass Scope */}
          {isAwaitingPass && event.passRequest && (
            <>
              <Divider />
              <VStack gap={2}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Heading level={5}>Capability Pass Scope</Heading>
                  </StackItem>
                  <Text type="supporting" color="secondary">
                    Single-use · Ed25519
                  </Text>
                </HStack>
                <MetadataList
                  columns="single"
                  label={{position: 'start', width: 92}}>
                  <MetadataListItem label="Buyer agent">
                    <Text type="code" size="2xs">
                      {event.sourceActor}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="SPIFFE ID">
                    <Text type="code" size="2xs">
                      {event.passRequest.agentFingerprint}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    <Text type="code" size="2xs">
                      {event.passRequest.sku}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Amount cap">
                    <Text type="body" hasTabularNumbers>
                      ${event.passRequest.requestedCap}.00 USD
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Pass TTL">
                    <Text type="body" hasTabularNumbers>
                      {event.passRequest.ttl}
                    </Text>
                  </MetadataListItem>
                </MetadataList>
              </VStack>
            </>
          )}

          {/* Policy & Schema Validation — List rows, zero Card */}
          {event.validations && event.validations.length > 0 && (
            <>
              <Divider />
              <VStack gap={2}>
                <Heading level={5}>Policy & Schema Validation</Heading>
                <List density="compact" hasDividers>
                  {event.validations.map(v => (
                    <ListItem
                      key={v.id}
                      align="first-line"
                      startContent={
                        <StatusDot
                          variant={
                            v.status === 'pass'
                              ? 'success'
                              : v.status === 'warn'
                                ? 'warning'
                                : 'error'
                          }
                          label={v.gate}
                        />
                      }
                      label={v.gate}
                      description={v.detail}
                    />
                  ))}
                </List>
              </VStack>
            </>
          )}

          {/* Raw / Diff Wire Payload */}
          <Divider />
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <Heading level={5}>
                  {event.wireDiffJson && (mutationOn || isHistoricalModified)
                    ? 'JSON-RPC Payload Diff'
                    : `${event.protocol} Wire Payload`}
                </Heading>
              </StackItem>
              <Text type="supporting" color="secondary">
                → {event.targetActor}
              </Text>
            </HStack>

            {event.wireDiffJson && (mutationOn || isHistoricalModified) ? (
              <CodeBlock
                code={event.wireDiffJson}
                language="json"
                isDiff
                size="sm"
                width="100%"
                isWrapped
                maxHeight={220}
                title={`${event.code} · ${event.sourceActor} -> ${event.targetActor}`}
              />
            ) : (
              <CodeBlock
                code={event.rawOriginalJson}
                language="json"
                size="sm"
                width="100%"
                isWrapped
                maxHeight={220}
                title={`${event.code} · ${event.toolOrEndpoint}`}
              />
            )}
          </VStack>
        </VStack>
      </div>

      {/* Sticky Action Footer */}
      {(isOfferFrame || isAwaitingPass) && (
        <div style={inspectorStyles.footer}>
          {isHeldQuote ? (
            <VStack gap={2}>
              <Switch
                width="100%"
                labelSpacing="spread"
                label={`Confirm target ${event.targetActor} & outbound payload`}
                value={payloadReviewed}
                onChange={setPayloadReviewed}
              />

              <HStack gap={2}>
                <Button
                  width="100%"
                  size="sm"
                  variant="primary"
                  label={
                    mutationOn
                      ? `Transmit modified (${proposedCount})`
                      : 'Enable mutation to transmit diff'
                  }
                  isDisabled={!mutationOn || !payloadReviewed}
                  tooltip={
                    !payloadReviewed
                      ? 'Confirm outbound payload and target recipient above before transmitting'
                      : !mutationOn
                        ? 'Protocol mutation rule is off — use Forward original or re-enable mutation'
                        : `Send ${proposedCount} validated offers to ${event.targetActor}`
                  }
                  onClick={() => onTransmitModified(event.id)}
                />
                <Button
                  width="100%"
                  size="sm"
                  variant="secondary"
                  label={`Forward original (${upstreamCount})`}
                  isDisabled={
                    Boolean(event.forwardOriginalBlockedReason) ||
                    !payloadReviewed
                  }
                  tooltip={
                    event.forwardOriginalBlockedReason ??
                    (!payloadReviewed
                      ? 'Confirm target recipient above before forwarding'
                      : `Forward unmodified upstream response (${upstreamCount} offers) to ${event.targetActor}`)
                  }
                  onClick={() => onForwardOriginal(event.id)}
                />
              </HStack>

              {event.forwardOriginalBlockedReason && (
                <Text type="supporting" color="secondary">
                  Forward original disabled: {event.forwardOriginalBlockedReason}
                </Text>
              )}
              {!payloadReviewed && (
                <Text type="supporting" color="secondary">
                  Confirm outbound message and recipient {event.targetActor} to
                  unlock transmission.
                </Text>
              )}
            </VStack>
          ) : isAwaitingPass ? (
            <HStack gap={2}>
              <Button
                width="100%"
                size="sm"
                variant="primary"
                label={`Issue pass ($${event.passRequest?.requestedCap ?? 0})`}
                onClick={() => onAuthorizePass(event.id)}
              />
              <Button
                width="100%"
                size="sm"
                variant="destructive"
                label="Reject checkout"
                onClick={() => onRejectPass(event.id)}
              />
            </HStack>
          ) : (
            <VStack gap={1.5}>
              <Button
                width="100%"
                size="sm"
                variant="secondary"
                isDisabled
                label="Response already delivered"
              />
              <Text type="supporting" color="secondary">
                {event.code} was delivered to {event.targetActor} at{' '}
                {event.deliveredAt ?? event.timestamp}. Use Reset scenario to
                replay live interception.
              </Text>
            </VStack>
          )}
        </div>
      )}
    </div>
  );
}

interface WireSurfaceProps {
  session: MerchantSession;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

const wireStyles: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  toolbar: {
    padding: 'var(--spacing-2) var(--spacing-4)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  splitBody: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
  },
  splitBodyVertical: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  packetList: {
    flex: 1,
    minWidth: 0,
    overflowY: 'auto',
  },
  detailPane: {
    flexShrink: 0,
    overflowY: 'auto',
    padding: 'var(--spacing-4)',
  },
  passesScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  passRow: {
    padding: 'var(--spacing-3) var(--spacing-4)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
};

function WireSurface({
  session,
  selectedEventId,
  onSelectEvent,
}: WireSurfaceProps) {
  const [protoFilter, setProtoFilter] = useState<'all' | 'MCP' | 'HTTP'>('all');
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const detailSplit = useResizable({
    defaultSize: 420,
    minSize: 280,
    maxSize: 640,
  });

  const frames = session.events.filter(e =>
    protoFilter === 'all' ? true : e.protocol === protoFilter,
  );
  const activeFrame: TraceEvent | null =
    frames.find(f => f.id === selectedEventId) ?? frames[0] ?? null;

  const detailContent = activeFrame ? (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <Heading level={5}>
            Packet #{activeFrame.seq} · {activeFrame.code}
          </Heading>
        </StackItem>
        <Text type="code" size="2xs" color="secondary" hasTabularNumbers>
          {activeFrame.durationLabel}
        </Text>
      </HStack>

      <MetadataList columns="single" label={{position: 'start', width: 140}}>
        {Object.entries(activeFrame.headers).map(([k, v]) => (
          <MetadataListItem key={k} label={k}>
            <Text type="code" size="2xs">
              {v}
            </Text>
          </MetadataListItem>
        ))}
      </MetadataList>

      <Divider />

      <CodeBlock
        code={activeFrame.rawOriginalJson}
        language="json"
        size="sm"
        width="100%"
        isWrapped
        title={`${activeFrame.code} · Upstream / Inbound Frame`}
      />

      {activeFrame.wireDiffJson && (
        <CodeBlock
          code={activeFrame.wireDiffJson}
          language="json"
          isDiff
          size="sm"
          width="100%"
          isWrapped
          title={`${activeFrame.code} · Conduit Outbound Mutation Diff`}
        />
      )}
    </VStack>
  ) : null;

  return (
    <div data-testid="wire-surface" style={wireStyles.root}>
      <div style={wireStyles.toolbar}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={5}>Wire Evidence Capture</Heading>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {session.merchantHost} · {frames.length} packets
              </Text>
            </HStack>
          </StackItem>
          <SegmentedControl
            size="sm"
            label="Filter protocol"
            value={protoFilter}
            onChange={v => setProtoFilter(v as 'all' | 'MCP' | 'HTTP')}>
            <SegmentedControlItem value="all" label="All" />
            <SegmentedControlItem value="MCP" label="MCP" />
            <SegmentedControlItem value="HTTP" label="HTTP" />
          </SegmentedControl>
        </HStack>
      </div>

      {isNarrow ? (
        <div style={wireStyles.splitBodyVertical}>
          <List density="compact" hasDividers>
            {frames.map(f => (
              <ListItem
                key={f.id}
                isSelected={activeFrame?.id === f.id}
                onClick={() => onSelectEvent(f.id)}
                startContent={
                  f.deliveryPhase === 'held_at_proxy' ? (
                    <StatusDot variant="warning" label="Held" />
                  ) : undefined
                }
                label={`${f.code} · ${f.toolOrEndpoint}`}
                description={`${f.protocol} · ${f.sourceActor} → ${f.targetActor} · ${f.timestamp}`}
                endContent={
                  <Text
                    type="code"
                    size="2xs"
                    color="secondary"
                    hasTabularNumbers>
                    {f.deliveryPhase === 'held_at_proxy'
                      ? 'Held'
                      : String(f.httpStatus ?? 200)}
                  </Text>
                }
              />
            ))}
          </List>
          <Divider />
          <div style={wireStyles.detailPane}>{detailContent}</div>
        </div>
      ) : (
        <div style={wireStyles.splitBody}>
          <div style={wireStyles.packetList}>
            <List density="compact" hasDividers>
              {frames.map(f => (
                <ListItem
                  key={f.id}
                  isSelected={activeFrame?.id === f.id}
                  onClick={() => onSelectEvent(f.id)}
                  startContent={
                    f.deliveryPhase === 'held_at_proxy' ? (
                      <StatusDot variant="warning" label="Held" />
                    ) : undefined
                  }
                  label={`#${f.seq} · ${f.code} · ${f.toolOrEndpoint}`}
                  description={`${f.protocol} · ${f.sourceActor} → ${f.targetActor} · ${f.timestamp}`}
                  endContent={
                    <Text
                      type="code"
                      size="2xs"
                      color="secondary"
                      hasTabularNumbers>
                      {f.deliveryPhase === 'held_at_proxy'
                        ? 'Held'
                        : String(f.httpStatus ?? 200)}
                    </Text>
                  }
                />
              ))}
            </List>
          </div>

          <ResizeHandle
            direction="horizontal"
            hasDivider
            resizable={detailSplit.props}
            label="Resize raw packet pane"
          />

          <div style={{...wireStyles.detailPane, width: detailSplit.size}}>
            {detailContent}
          </div>
        </div>
      )}
    </div>
  );
}

interface PassesSurfaceProps {
  passes: CapabilityPassRecord[];
  onRevokePass: (passId: string) => void;
  onApprovePendingPass: (passId: string) => void;
}

function PassesSurface({
  passes,
  onRevokePass,
  onApprovePendingPass,
}: PassesSurfaceProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const visible = passes.filter(p =>
    statusFilter === 'all' ? true : p.status === statusFilter,
  );

  return (
    <div data-testid="passes-surface" style={wireStyles.root}>
      <div style={wireStyles.toolbar}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Heading level={5}>Scoped Capability Passes</Heading>
              <Text type="supporting" color="secondary">
                Ed25519 single-use checkout capabilities bound to SKU, spend
                ceiling, and TTL
              </Text>
            </VStack>
          </StackItem>
          <SegmentedControl
            size="sm"
            label="Filter pass status"
            value={statusFilter}
            onChange={setStatusFilter}>
            <SegmentedControlItem value="all" label="All" />
            <SegmentedControlItem value="Active" label="Active" />
            <SegmentedControlItem value="Awaiting Approval" label="Awaiting" />
            <SegmentedControlItem value="Exhausted" label="Exhausted" />
            <SegmentedControlItem value="Revoked" label="Revoked" />
          </SegmentedControl>
        </HStack>
      </div>

      {/* Edge-to-edge ledger rows with dividers — zero Card grid, zero Badges */}
      <div style={wireStyles.passesScroll}>
        {visible.length === 0 ? (
          <VStack padding={4}>
            <EmptyState
              title="No capability passes match filter"
              description="Switch to All to view every issued and pending checkout pass."
              primaryAction={{
                label: 'Show all passes',
                onClick: () => setStatusFilter('all'),
              }}
              isCompact
            />
          </VStack>
        ) : (
          visible.map(pass => (
            <div key={pass.id} style={wireStyles.passRow}>
              <VStack gap={2}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <StackItem size="fill">
                    <HStack gap={2} vAlign="center">
                      <StatusDot
                        variant={
                          pass.status === 'Active'
                            ? 'success'
                            : pass.status === 'Awaiting Approval'
                              ? 'warning'
                              : pass.status === 'Revoked'
                                ? 'error'
                                : 'neutral'
                        }
                        label={pass.status}
                      />
                      <Text type="code" size="2xs" weight="semibold">
                        {pass.id}
                      </Text>
                      <Text type="supporting" color="secondary">
                        · {pass.status}
                      </Text>
                    </HStack>
                  </StackItem>

                  {pass.status === 'Awaiting Approval' && (
                    <Button
                      size="sm"
                      variant="primary"
                      label={`Sign & issue ($${pass.capUsd}.00)`}
                      onClick={() => onApprovePendingPass(pass.id)}
                    />
                  )}
                  {pass.status === 'Active' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Revoke"
                      onClick={() => onRevokePass(pass.id)}
                    />
                  )}
                </HStack>

                <MetadataList columns="auto">
                  <MetadataListItem label="Merchant">
                    <Text type="body">{pass.merchantHost}</Text>
                  </MetadataListItem>
                  <MetadataListItem label="Buyer agent">
                    <Text type="code" size="2xs">
                      {pass.buyerAgent}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    <Text type="code" size="2xs">
                      {pass.sku}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Spend ceiling">
                    <Text type="body" hasTabularNumbers>
                      ${pass.capUsd}.00 USD ({pass.remainingCalls} call left)
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="TTL / Issued">
                    <Text type="body" hasTabularNumbers>
                      {pass.ttl} · {pass.issuedAt}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Signature">
                    <Text type="code" size="2xs">
                      {pass.signature}
                    </Text>
                  </MetadataListItem>
                </MetadataList>
              </VStack>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const SCENARIO_LABELS: Record<ScenarioPresetId, string> = {
  live_hold_r02: '1. Live Quote Held (R02 Undelivered)',
  floor_leak_blocked: '2. Floor Policy Violation ($189 Leak)',
  post_release_pass: '3. Post-Release · Awaiting Pass',
  discovery_95pct: '4. 95% Traffic · Discovery Only (Full Width)',
};

const styles: Record<string, CSSProperties> = {
  viewportRoot: {
    height: '100dvh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: 'var(--color-background-surface)',
    color: 'var(--color-text-primary)',
    display: 'flex',
    flexDirection: 'column',
  },
  brandMark: {
    width: 20,
    height: 20,
    objectFit: 'contain',
    flexShrink: 0,
  },
  contextRow: {
    paddingTop: 'var(--spacing-1-5)',
    borderTop: 'var(--border-width) solid var(--color-border)',
  },
  sidebarSection: {
    padding: 'var(--spacing-3)',
  },
  workspaceSplit: {
    height: '100%',
    width: '100%',
    display: 'flex',
    overflow: 'hidden',
  },
  centerColumn: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  traceFill: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  inspectorPane: {
    flexShrink: 0,
    height: '100%',
    overflow: 'hidden',
  },
};

export default function ConduitWorkbenchPage() {
      const [scenario, setScenario] = useState<ScenarioPresetId>('live_hold_r02');

  const [sessions, setSessions] = useState<MerchantSession[]>(() =>
    buildInitialSessions('live_hold_r02'),
  );
  const [passes, setPasses] = useState<CapabilityPassRecord[]>(() =>
    buildInitialPasses(),
  );
  const [activeSessionId, setActiveSessionId] = useState<string>('audioshop');
  const [activeSurface, setActiveSurface] = useState<SurfaceId>('overview');
  const [traceFilter, setTraceFilter] = useState<TraceFilterId>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    'evt-aud-r02',
  );

  // Follow incident-console/page.tsx responsive contract: <= 1024px uses BottomSheet on tap
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [wasMobile, setWasMobile] = useState<boolean>(isMobile);
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (isMobile) {
      setIsInspectorOpen(false);
    }
  }

  const sidebarResize = useResizable({
    defaultSize: 228,
    minSize: 192,
    maxSize: 300,
  });

  const graphHeightResize = useResizable({
    direction: 'vertical',
    defaultSize: 274,
    minSize: 175,
    maxSize: 470,
  });

  const inspectorResize = useResizable({
    defaultSize: 400,
    minSize: 340,
    maxSize: 540,
  });

    const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  );

  const metrics = useMemo(
    () => deriveWorkspaceMetrics(activeSession, sessions, passes),
    [activeSession, sessions, passes],
  );

  const selectedEvent = useMemo(
    () =>
      activeSession.events.find(e => e.id === selectedEventId) ??
      activeSession.events[activeSession.events.length - 1] ??
      null,
    [activeSession, selectedEventId],
  );

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setTraceFilter('all');
    const target = sessions.find(s => s.id === sessionId);
    if (!target) return;

    const actionEvent = target.events.find(
      e =>
        e.deliveryPhase === 'held_at_proxy' ||
        e.deliveryPhase === 'awaiting_pass',
    );
    if (actionEvent) {
      setSelectedEventId(actionEvent.id);
      setIsInspectorOpen(!isMobile);
    } else {
      setSelectedEventId(target.events[target.events.length - 1]?.id ?? null);
      setIsInspectorOpen(false);
    }
  };

  const applyScenarioPreset = (preset: ScenarioPresetId) => {
    setScenario(preset);
    const freshSessions = buildInitialSessions(preset);
    const freshPasses = buildInitialPasses();
    setSessions(freshSessions);
    setPasses(freshPasses);
    setActiveSurface('overview');
    setTraceFilter('all');

    if (preset === 'discovery_95pct') {
      setActiveSessionId('displayco');
      setSelectedEventId('evt-dsp-02');
      setIsInspectorOpen(false);
    } else {
      setActiveSessionId('audioshop');
      const aud = freshSessions[0];
      const focusEvt =
        aud.events.find(
          e =>
            e.deliveryPhase === 'held_at_proxy' ||
            e.deliveryPhase === 'awaiting_pass',
        ) ?? aud.events[aud.events.length - 1];
      setSelectedEventId(focusEvt?.id ?? null);
      setIsInspectorOpen(!isMobile);
    }
  };

  const handleSelectEventFromWorkspace = (eventId: string) => {
    setSelectedEventId(eventId);
    setIsInspectorOpen(true);
  };

  const handleToggleMutation = (eventId: string, nextEnabled: boolean) => {
    setSessions(prev =>
      prev.map(sess =>
        sess.id !== activeSession.id
          ? sess
          : {
              ...sess,
              events: sess.events.map(ev =>
                ev.id === eventId ? {...ev, mutationEnabled: nextEnabled} : ev,
              ),
            },
      ),
    );
  };

  const handleTransmitModified = (eventId: string) => {
    const nowStamp = '14:02:11.408';
    let mintedCartCap = 209;

    setSessions(prev =>
      prev.map(sess => {
        if (sess.id !== activeSession.id) return sess;
        const target = sess.events.find(e => e.id === eventId);
        if (!target || target.deliveryPhase !== 'held_at_proxy') return sess;

        const isLeakFix = Boolean(target.forwardOriginalBlockedReason);
        const deliveredList = [
          ...(target.upstreamOffers ?? []).filter(
            o => !(isLeakFix && o.marginDelta < 0),
          ),
          ...(target.stagedOffer ? [target.stagedOffer] : []),
        ];
        const chosenOffer = target.stagedOffer ?? deliveredList[0];
        mintedCartCap = chosenOffer?.price ?? 209;

        const updatedEvents = sess.events.map(ev =>
          ev.id !== eventId
            ? ev
            : {
                ...ev,
                durationLabel: '412 ms',
                httpStatus: 200,
                deliveryPhase: 'delivered_modified' as const,
                deliveredOffers: deliveredList,
                deliveredAt: nowStamp,
                observation: `Delivered (modified): ${deliveredList.length} offers sent to ${ev.targetActor} (+${chosenOffer?.id ?? 'O03'} $${mintedCartCap}.00)`,
                headers: {
                  ...ev.headers,
                  'x-conduit-hold-state': 'RELEASED_MODIFIED',
                  'x-conduit-delivered-at': `${nowStamp}Z`,
                },
              },
        );

        const c03Id = `evt-${sess.id}-c03-live`;
        const c04Id = `evt-${sess.id}-c04-live`;

        return {
          ...sess,
          selectedOfferLabel: `${chosenOffer?.id ?? 'O03'} · $${mintedCartCap}.00`,
          events: [
            ...updatedEvents,
            {
              id: c03Id,
              seq: 104,
              code: 'C03',
              direction: 'buyer_to_seller' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'tools/call · select_product',
              timestamp: '14:02:12.019',
              durationLabel: '3 ms',
              httpStatus: 200,
              deliveryPhase: 'observed_inbound' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: `${sess.merchantHost}/mcp`,
              observation: `Buyer selected delivered offer ${chosenOffer?.id ?? 'O03'} ($${mintedCartCap}.00) → cart CART-8841`,
              rawOriginalJson: JSON.stringify(
                {
                  jsonrpc: '2.0',
                  id: 'req_03',
                  method: 'tools/call',
                  params: {
                    name: 'select_product',
                    arguments: {
                      sku: sess.skuCode,
                      selected_offer_id: chosenOffer?.id ?? 'O03',
                      agreed_price_usd: mintedCartCap,
                      cart_id: 'CART-8841',
                    },
                  },
                },
                null,
                2,
              ),
              headers: {
                'content-type': 'application/json',
                'x-mcp-agent-id': sess.buyerAgentId,
                'x-conduit-cart': 'CART-8841',
              },
            },
            {
              id: c04Id,
              seq: 105,
              code: 'C04',
              direction: 'buyer_to_gate' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'conduit/request_checkout_pass',
              timestamp: '14:02:12.490',
              durationLabel: 'Awaiting pass',
              httpStatus: 202,
              deliveryPhase: 'awaiting_pass' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: 'conduit.pass.authority',
              observation: `0 frames held in proxy; checkout awaits scoped pass ($${mintedCartCap}.00 cap · ${sess.skuCode})`,
              passRequest: {
                requestId: 'req_pass_7f2_live',
                sku: sess.skuCode,
                requestedCap: mintedCartCap,
                ttl: '15m 00s',
                agentFingerprint: `spiffe://agents.buyer/${sess.buyerAgentId}`,
              },
              validations: [
                {
                  id: 'vp-live-1',
                  gate: 'Agreed Quote Match',
                  status: 'pass' as const,
                  detail: `Requested $${mintedCartCap}.00 matches delivered offer ${chosenOffer?.id ?? 'O03'}`,
                },
                {
                  id: 'vp-live-2',
                  gate: 'Single-Use Replay Lock',
                  status: 'pass' as const,
                  detail: 'Pinned to CART-8841 · 1 call max · 15m TTL',
                },
              ],
              rawOriginalJson: JSON.stringify(
                {
                  jsonrpc: '2.0',
                  id: 'req_04',
                  method: 'conduit/request_checkout_pass',
                  params: {
                    cart_id: 'CART-8841',
                    sku: sess.skuCode,
                    amount_cap_usd: mintedCartCap,
                    ttl_seconds: 900,
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
      }),
    );

    setPasses(prev => [
      {
        id: 'pass_aud_7f2_await',
        sessionId: activeSession.id,
        merchantHost: activeSession.merchantHost,
        buyerAgent: activeSession.buyerAgentId,
        sku: activeSession.skuCode,
        capUsd: mintedCartCap,
        remainingCalls: 1,
        ttl: '15m 00s',
        issuedAt: 'Pending approval',
        signature: 'unsigned (awaiting operator)',
        status: 'Awaiting Approval',
      },
      ...prev.filter(p => p.id !== 'pass_aud_7f2_await'),
    ]);
  };

  const handleForwardOriginal = (eventId: string) => {
    const nowStamp = '14:02:11.512';
    setSessions(prev =>
      prev.map(sess => {
        if (sess.id !== activeSession.id) return sess;
        const target = sess.events.find(e => e.id === eventId);
        if (!target || target.deliveryPhase !== 'held_at_proxy') return sess;

        const origOffers = target.upstreamOffers ?? [];
        const picked = origOffers[0];
        const cap = picked?.price ?? 219;

        const updatedEvents = sess.events.map(ev =>
          ev.id !== eventId
            ? ev
            : {
                ...ev,
                durationLabel: '390 ms',
                httpStatus: 200,
                deliveryPhase: 'delivered_original' as const,
                deliveredOffers: origOffers,
                deliveredAt: nowStamp,
                observation: `Delivered (original): ${origOffers.length} unmodified offers forwarded to ${ev.targetActor}`,
                headers: {
                  ...ev.headers,
                  'x-conduit-hold-state': 'FORWARDED_ORIGINAL',
                },
              },
        );

        return {
          ...sess,
          selectedOfferLabel: `${picked?.id ?? 'O01'} · $${cap}.00`,
          events: [
            ...updatedEvents,
            {
              id: `evt-${sess.id}-c03-orig`,
              seq: 104,
              code: 'C03',
              direction: 'buyer_to_seller' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'tools/call · select_product',
              timestamp: '14:02:12.210',
              durationLabel: '3 ms',
              httpStatus: 200,
              deliveryPhase: 'observed_inbound' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: `${sess.merchantHost}/mcp`,
              observation: `Buyer selected original offer ${picked?.id ?? 'O01'} ($${cap}.00) → cart CART-8842`,
              rawOriginalJson: JSON.stringify(
                {
                  sku: sess.skuCode,
                  selected_offer_id: picked?.id ?? 'O01',
                  agreed_price_usd: cap,
                },
                null,
                2,
              ),
              headers: {'content-type': 'application/json'},
            },
            {
              id: `evt-${sess.id}-c04-orig`,
              seq: 105,
              code: 'C04',
              direction: 'buyer_to_gate' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'conduit/request_checkout_pass',
              timestamp: '14:02:12.680',
              durationLabel: 'Awaiting pass',
              httpStatus: 202,
              deliveryPhase: 'awaiting_pass' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: 'conduit.pass.authority',
              observation: `Checkout paused awaiting $${cap}.00 capability pass`,
              passRequest: {
                requestId: 'req_pass_orig',
                sku: sess.skuCode,
                requestedCap: cap,
                ttl: '15m 00s',
                agentFingerprint: `spiffe://agents.buyer/${sess.buyerAgentId}`,
              },
              rawOriginalJson: JSON.stringify(
                {sku: sess.skuCode, amount_cap_usd: cap},
                null,
                2,
              ),
              headers: {'content-type': 'application/json'},
            },
          ],
        };
      }),
    );
  };

  const handleAuthorizePass = (eventId: string) => {
    const newPassId = `pass_${activeSession.id}_signed`;
    let settledUsd = activeSession.msrpUsd;

    setSessions(prev =>
      prev.map(sess => {
        if (sess.id !== activeSession.id) return sess;
        const evt = sess.events.find(e => e.id === eventId);
        settledUsd = evt?.passRequest?.requestedCap ?? sess.msrpUsd;

        const updated = sess.events.map(e =>
          e.id !== eventId
            ? e
            : {
                ...e,
                httpStatus: 200,
                durationLabel: '18 ms',
                deliveryPhase: 'pass_authorized' as const,
                observation: `Authorized single-use pass ${newPassId} ($${settledUsd}.00 cap)`,
              },
        );

        const c05Id = `evt-${sess.id}-c05-settled`;
        return {
          ...sess,
          events: [
            ...updated,
            {
              id: c05Id,
              seq: 106,
              code: 'C05',
              direction: 'buyer_to_seller' as const,
              protocol: 'HTTP' as const,
              toolOrEndpoint: 'POST /v1/orders/confirm',
              timestamp: '14:02:15.044',
              durationLabel: '14 ms',
              httpStatus: 200,
              deliveryPhase: 'pass_authorized' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: sess.merchantHost,
              observation: `Order ORD-99204 confirmed ($${settledUsd}.00) with ${newPassId}`,
              rawOriginalJson: JSON.stringify(
                {
                  order_id: 'ORD-99204',
                  sku: sess.skuCode,
                  settled_usd: settledUsd,
                  capability_pass: newPassId,
                },
                null,
                2,
              ),
              headers: {
                'content-type': 'application/json',
                authorization: `ConduitPass ${newPassId}`,
              },
            },
          ],
        };
      }),
    );

    setPasses(prev => {
      const filtered = prev.filter(p => p.sessionId !== activeSession.id);
      return [
        {
          id: newPassId,
          sessionId: activeSession.id,
          merchantHost: activeSession.merchantHost,
          buyerAgent: activeSession.buyerAgentId,
          sku: activeSession.skuCode,
          capUsd: settledUsd,
          remainingCalls: 1,
          ttl: '14m 59s',
          issuedAt: '14:02:14 UTC',
          signature: 'ed25519:7c19f0…a42e',
          status: 'Active',
        },
        ...filtered,
      ];
    });
  };

  const handleRejectPass = (eventId: string) => {
    setSessions(prev =>
      prev.map(sess =>
        sess.id !== activeSession.id
          ? sess
          : {
              ...sess,
              events: sess.events.map(e =>
                e.id !== eventId
                  ? e
                  : {
                      ...e,
                      httpStatus: 403,
                      durationLabel: 'Rejected',
                      deliveryPhase: 'delivered_original' as const,
                      observation:
                        'Operator rejected checkout pass request (403 Forbidden returned to agent)',
                    },
              ),
            },
      ),
    );
    setPasses(prev =>
      prev.map(p =>
        p.sessionId === activeSession.id ? {...p, status: 'Revoked'} : p,
      ),
    );
  };

  const handleRevokePass = (passId: string) => {
    setPasses(prev =>
      prev.map(p => (p.id === passId ? {...p, status: 'Revoked'} : p)),
    );
  };

  const handleApprovePendingPassFromLedger = (passId: string) => {
    const targetPass = passes.find(p => p.id === passId);
    if (!targetPass) return;
    const sess = sessions.find(s => s.id === targetPass.sessionId);
    const awaitingEvt = sess?.events.find(
      e => e.deliveryPhase === 'awaiting_pass',
    );
    if (sess && awaitingEvt) {
      setActiveSessionId(sess.id);
      setTimeout(() => handleAuthorizePass(awaitingEvt.id), 0);
    } else {
      setPasses(prev =>
        prev.map(p =>
          p.id === passId
            ? {...p, status: 'Active', signature: 'ed25519:3a92bc…19d4'}
            : p,
        ),
      );
    }
  };

  const showDesktopRightPanel =
    !isMobile &&
    isInspectorOpen &&
    (activeSurface === 'overview' || activeSurface === 'graph');

    return (
    <>
      <div
        data-testid="conduit-astryx-workbench"
        style={styles.viewportRoot}>
        <style>{'nextjs-portal { display: none !important; }'}</style>
        <Layout
          height="fill"
          header={
            <LayoutHeader hasDivider>
              <VStack gap={2}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <StackItem size="fill">
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <HStack gap={1.5} vAlign="center">
                        <img
                          src="/conduit-mark.png"
                          alt=""
                          width={20}
                          height={20}
                          style={styles.brandMark}
                        />
                        <Heading level={4}>Conduit</Heading>
                        {!isMobile && (
                          <Text type="supporting" color="secondary">
                            MCP Control Plane
                          </Text>
                        )}
                      </HStack>

                      {isMobile && (
                        <DropdownMenu
                          presentation="adaptive"
                          button={{
                            size: 'sm',
                            variant: 'secondary',
                            label: activeSession.merchantName,
                          }}
                          items={sessions.map(s => {
                            const sm = deriveWorkspaceMetrics(
                              s,
                              sessions,
                              passes,
                            );
                            return {
                              label: `${s.merchantName} (${sm.stage})`,
                              onClick: () => handleSelectSession(s.id),
                            };
                          })}
                        />
                      )}

                      <DropdownMenu
                        presentation="adaptive"
                        button={{
                          size: 'sm',
                          variant: 'secondary',
                          label: isMobile
                            ? 'Scenarios'
                            : SCENARIO_LABELS[scenario],
                        }}
                        items={(
                          Object.keys(SCENARIO_LABELS) as ScenarioPresetId[]
                        ).map(presetKey => ({
                          label: SCENARIO_LABELS[presetKey],
                          onClick: () => applyScenarioPreset(presetKey),
                        }))}
                      />

                      {!isMobile && (
                        <Button
                          size="sm"
                          variant="ghost"
                          label="Reset scenario"
                          onClick={() => applyScenarioPreset(scenario)}
                        />
                      )}
                    </HStack>
                  </StackItem>

                  
                </HStack>

                {/* Quiet typographic context strip — zero Badges, zero Tokens */}
                <div
                  data-testid="commercial-context-strip"
                  style={styles.contextRow}>
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <StackItem size="fill">
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text type="code" size="2xs" weight="semibold">
                          {activeSession.merchantHost}
                        </Text>
                        <Text
                          type="supporting"
                          color="secondary"
                          hasTabularNumbers>
                          ← {activeSession.buyerAgentId} ·{' '}
                          {activeSession.skuName} (${activeSession.msrpUsd}{' '}
                          MSRP / ${activeSession.marginFloorUsd} floor)
                          {activeSession.selectedOfferLabel
                            ? ` · Selected ${activeSession.selectedOfferLabel}`
                            : ''}
                        </Text>
                      </HStack>
                    </StackItem>

                    <HStack gap={2} vAlign="center" wrap="wrap">
                      {!isMobile && (
                        <HStack
                          gap={1.5}
                          vAlign="center"
                          data-testid="canonical-stage-pills">
                          {STAGE_ORDER.map((st, idx) => {
                            const isCurrent = idx === metrics.stageIndex;
                            const isPast = idx < metrics.stageIndex;
                            return (
                              <React.Fragment key={st}>
                                {idx > 0 && (
                                  <Text type="supporting" color="secondary">
                                    →
                                  </Text>
                                )}
                                <Text
                                  type="supporting"
                                  color={
                                    isCurrent
                                      ? 'primary'
                                      : isPast
                                        ? 'secondary'
                                        : 'disabled'
                                  }
                                  weight={isCurrent ? 'semibold' : 'normal'}>
                                  {st}
                                </Text>
                              </React.Fragment>
                            );
                          })}
                        </HStack>
                      )}

                      {(activeSurface === 'overview' ||
                        activeSurface === 'graph') &&
                        (metrics.heldEventId ? (
                          <Button
                            size="sm"
                            variant={isInspectorOpen ? 'secondary' : 'primary'}
                            label={
                              isInspectorOpen
                                ? 'Hide quote approval'
                                : 'Review held quote (1)'
                            }
                            onClick={() => {
                              setSelectedEventId(metrics.heldEventId);
                              setIsInspectorOpen(v => !v);
                            }}
                          />
                        ) : metrics.awaitingPassEventId ? (
                          <Button
                            size="sm"
                            variant={isInspectorOpen ? 'secondary' : 'primary'}
                            label={
                              isInspectorOpen
                                ? 'Hide pass gate'
                                : 'Review pass request (1)'
                            }
                            onClick={() => {
                              setSelectedEventId(metrics.awaitingPassEventId);
                              setIsInspectorOpen(v => !v);
                            }}
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            label={
                              isInspectorOpen
                                ? 'Hide inspector'
                                : 'Inspect frame'
                            }
                            onClick={() => setIsInspectorOpen(v => !v)}
                          />
                        ))}
                    </HStack>
                  </HStack>
                </div>

                {isMobile && (
                  <SegmentedControl
                    size="sm"
                    layout="fill"
                    label="Active surface"
                    value={activeSurface}
                    onChange={v => setActiveSurface(v as SurfaceId)}>
                    <SegmentedControlItem value="overview" label="Overview" />
                    <SegmentedControlItem value="graph" label="Graph" />
                    <SegmentedControlItem value="wire" label="Wire" />
                    <SegmentedControlItem value="passes" label="Passes" />
                  </SegmentedControl>
                )}
              </VStack>
            </LayoutHeader>
          }
          start={
            !isMobile ? (
              <>
                <LayoutPanel
                  width={sidebarResize.size}
                  padding={0}
                  hasDivider={false}
                  label="Navigation">
                  <VStack gap={0}>
                    <div style={styles.sidebarSection}>
                      <VStack gap={1}>
                        <Text type="label" color="secondary">
                          Merchant Sessions
                        </Text>
                        <List density="compact">
                          {sessions.map(sess => {
                            const sm = deriveWorkspaceMetrics(
                              sess,
                              sessions,
                              passes,
                            );
                            return (
                              <ListItem
                                key={sess.id}
                                isSelected={sess.id === activeSession.id}
                                onClick={() => handleSelectSession(sess.id)}
                                startContent={
                                  <StatusDot
                                    variant={
                                      sm.proxyHeldCount > 0
                                        ? 'warning'
                                        : sm.awaitingPassCount > 0
                                          ? 'accent'
                                          : 'neutral'
                                    }
                                    isPulsing={sm.proxyHeldCount > 0}
                                    label={sm.stage}
                                  />
                                }
                                label={sess.merchantName}
                                description={`${sm.stage} · ${
                                  sm.proxyHeldCount > 0
                                    ? `${sm.proxyHeldCount} held`
                                    : sm.awaitingPassCount > 0
                                      ? 'awaiting pass'
                                      : `${sm.eventCount} frames`
                                }`}
                              />
                            );
                          })}
                        </List>
                      </VStack>
                    </div>

                    <Divider />

                    <div style={styles.sidebarSection}>
                      <VStack gap={1}>
                        <Text type="label" color="secondary">
                          Surfaces
                        </Text>
                        <List density="compact">
                          <ListItem
                            isSelected={activeSurface === 'overview'}
                            onClick={() => setActiveSurface('overview')}
                            label="Overview"
                            description="Observatory + trace"
                          />
                          <ListItem
                            isSelected={activeSurface === 'graph'}
                            onClick={() => setActiveSurface('graph')}
                            label="Graph"
                            description="Full causal topology"
                          />
                          <ListItem
                            isSelected={activeSurface === 'wire'}
                            onClick={() => setActiveSurface('wire')}
                            label="Wire"
                            description="MCP & HTTP packets"
                          />
                          <ListItem
                            isSelected={activeSurface === 'passes'}
                            onClick={() => setActiveSurface('passes')}
                            label="Passes"
                            description="Checkout capabilities"
                            endContent={
                              metrics.globalAwaitingPassCount > 0 ? (
                                <Text
                                  type="supporting"
                                  color="secondary"
                                  hasTabularNumbers>
                                  {metrics.globalAwaitingPassCount}
                                </Text>
                              ) : undefined
                            }
                          />
                        </List>
                      </VStack>
                    </div>

                    <Divider />

                    <div style={styles.sidebarSection}>
                      <VStack gap={1}>
                        <Text type="label" color="secondary">
                          Trace Filters
                        </Text>
                        <List density="compact">
                          <ListItem
                            isSelected={traceFilter === 'all'}
                            onClick={() => {
                              setActiveSurface('overview');
                              setTraceFilter('all');
                            }}
                            label="All frames"
                            endContent={
                              <Text
                                type="supporting"
                                color="secondary"
                                hasTabularNumbers>
                                {metrics.eventCount}
                              </Text>
                            }
                          />
                          <ListItem
                            isSelected={traceFilter === 'mcp'}
                            onClick={() => {
                              setActiveSurface('overview');
                              setTraceFilter('mcp');
                            }}
                            label="MCP JSON-RPC"
                          />
                          <ListItem
                            isSelected={traceFilter === 'http'}
                            onClick={() => {
                              setActiveSurface('overview');
                              setTraceFilter('http');
                            }}
                            label="HTTP transport"
                          />
                          <ListItem
                            isSelected={traceFilter === 'attention'}
                            onClick={() => {
                              setActiveSurface('overview');
                              setTraceFilter('attention');
                            }}
                            label="Held / awaiting gate"
                            endContent={
                              metrics.proxyHeldCount +
                                metrics.awaitingPassCount >
                              0 ? (
                                <Text
                                  type="supporting"
                                  color="secondary"
                                  hasTabularNumbers>
                                  {metrics.proxyHeldCount +
                                    metrics.awaitingPassCount}
                                </Text>
                              ) : undefined
                            }
                          />
                          <ListItem
                            isSelected={traceFilter === 'modified'}
                            onClick={() => {
                              setActiveSurface('overview');
                              setTraceFilter('modified');
                            }}
                            label="Proxy mutations"
                          />
                        </List>
                      </VStack>
                    </div>
                  </VStack>
                </LayoutPanel>
                <ResizeHandle
                  direction="horizontal"
                  hasDivider
                  resizable={sidebarResize.props}
                  label="Resize navigation sidebar"
                />
              </>
            ) : undefined
          }
          content={
            <LayoutContent role="main" padding={0}>
              <div style={styles.workspaceSplit}>
                <div style={styles.centerColumn}>
                  {activeSurface === 'overview' && (
                    <>
                      <div
                        style={{
                          height: isMobile ? 300 : graphHeightResize.size,
                          flexShrink: 0,
                          minHeight: 0,
                          overflow: 'hidden',
                        }}>
                        <CausalObservatoryGraph
                          session={activeSession}
                          selectedEventId={selectedEvent?.id ?? null}
                          onSelectEvent={handleSelectEventFromWorkspace}
                        />
                      </div>

                      {!isMobile && (
                        <ResizeHandle
                          direction="vertical"
                          hasDivider
                          resizable={graphHeightResize.props}
                          label="Resize Causal Observatory and Execution Trace"
                        />
                      )}

                      <div style={styles.traceFill}>
                        <DenseTraceTable
                          events={activeSession.events}
                          activeFilter={traceFilter}
                          selectedEventId={selectedEvent?.id ?? null}
                          onSelectEvent={handleSelectEventFromWorkspace}
                          onResetFilter={() => setTraceFilter('all')}
                        />
                      </div>
                    </>
                  )}

                  {activeSurface === 'graph' && (
                    <CausalObservatoryGraph
                      session={activeSession}
                      selectedEventId={selectedEvent?.id ?? null}
                      onSelectEvent={handleSelectEventFromWorkspace}
                      expanded
                    />
                  )}

                  {activeSurface === 'wire' && (
                    <WireSurface
                      session={activeSession}
                      selectedEventId={selectedEvent?.id ?? null}
                      onSelectEvent={id => setSelectedEventId(id)}
                    />
                  )}

                  {activeSurface === 'passes' && (
                    <PassesSurface
                      passes={passes}
                      onRevokePass={handleRevokePass}
                      onApprovePendingPass={handleApprovePendingPassFromLedger}
                    />
                  )}
                </div>

                {showDesktopRightPanel && (
                  <>
                    <ResizeHandle
                      direction="horizontal"
                      isReversed
                      hasDivider
                      resizable={inspectorResize.props}
                      label="Resize inspection panel"
                    />
                    <div
                      style={{
                        ...styles.inspectorPane,
                        width: inspectorResize.size,
                      }}>
                      <CanonicalInspectorPanel
                        session={activeSession}
                        event={selectedEvent}
                        onToggleMutation={handleToggleMutation}
                        onTransmitModified={handleTransmitModified}
                        onForwardOriginal={handleForwardOriginal}
                        onAuthorizePass={handleAuthorizePass}
                        onRejectPass={handleRejectPass}
                        onClose={() => setIsInspectorOpen(false)}
                      />
                    </div>
                  </>
                )}
              </div>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack
                gap={3}
                vAlign="center"
                wrap="wrap"
                data-testid="canonical-status-bar">
                <StackItem size="fill">
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <StatusDot
                      variant={
                        metrics.proxyHeldCount > 0
                          ? 'warning'
                          : metrics.awaitingPassCount > 0
                            ? 'accent'
                            : 'success'
                      }
                      isPulsing={metrics.proxyHeldCount > 0}
                      label="Proxy status"
                    />
                    <Text
                      type="code"
                      size="2xs"
                      color="secondary"
                      hasTabularNumbers>
                      {metrics.eventCount} events · {metrics.proxyHeldCount}{' '}
                      held by proxy · {metrics.awaitingPassCount} awaiting pass
                    </Text>
                  </HStack>
                </StackItem>

                <Text
                  type="supporting"
                  color="secondary"
                  hasTabularNumbers>
                  {metrics.stageHeadline} · {metrics.activePassCountGlobal}{' '}
                  active pass
                </Text>
              </HStack>
            </LayoutFooter>
          }
        />

        {isMobile && (
          <BottomSheet
            isOpen={isInspectorOpen}
            onOpenChange={setIsInspectorOpen}
            label="Frame inspection"
            height="lg"
            padding="none">
            <CanonicalInspectorPanel
              inBottomSheet
              session={activeSession}
              event={selectedEvent}
              onToggleMutation={handleToggleMutation}
              onTransmitModified={handleTransmitModified}
              onForwardOriginal={handleForwardOriginal}
              onAuthorizePass={handleAuthorizePass}
              onRejectPass={handleRejectPass}
              onClose={() => setIsInspectorOpen(false)}
            />
          </BottomSheet>
        )}
      </div>
    </>
  );
}
