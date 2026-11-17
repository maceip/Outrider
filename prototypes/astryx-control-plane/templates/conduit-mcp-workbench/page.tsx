// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useEffect, useMemo, useState} from 'react';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  VStack,
} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Token} from '@astryxdesign/core/Token';


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



interface CausalObservatoryGraphProps {
  session: MerchantSession;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  expanded?: boolean;
}

function getNodeStateMeta(ev: TraceEvent): {
  badgeVariant: 'warning' | 'success' | 'info' | 'neutral' | 'purple';
  badgeLabel: string;
  borderVar: string;
  bgTint: string;
  actorLane: 'buyer' | 'proxy' | 'seller';
} {
  if (ev.deliveryPhase === 'held_at_proxy') {
    return {
      badgeVariant: 'warning',
      badgeLabel: 'HELD',
      borderVar: 'var(--color-feedback-warning, #d97706)',
      bgTint: 'color-mix(in srgb, #f59e0b 11%, var(--color-background-surface))',
      actorLane: 'proxy',
    };
  }
  if (ev.deliveryPhase === 'awaiting_pass') {
    return {
      badgeVariant: 'purple',
      badgeLabel: 'PASS GATE',
      borderVar: '#8b5cf6',
      bgTint: 'color-mix(in srgb, #8b5cf6 10%, var(--color-background-surface))',
      actorLane: 'proxy',
    };
  }
  if (ev.deliveryPhase === 'delivered_modified') {
    return {
      badgeVariant: 'info',
      badgeLabel: 'MODIFIED',
      borderVar: 'var(--color-interactive-primary, #2563eb)',
      bgTint:
        'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 9%, var(--color-background-surface))',
      actorLane: 'proxy',
    };
  }
  if (ev.deliveryPhase === 'pass_authorized') {
    return {
      badgeVariant: 'success',
      badgeLabel: 'SETTLED',
      borderVar: '#16a34a',
      bgTint: 'color-mix(in srgb, #16a34a 9%, var(--color-background-surface))',
      actorLane: 'buyer',
    };
  }
  if (ev.direction === 'seller_to_buyer') {
    return {
      badgeVariant: 'success',
      badgeLabel: '200 OK',
      borderVar: 'var(--color-border-default)',
      bgTint: 'var(--color-background-surface)',
      actorLane: 'seller',
    };
  }
  return {
    badgeVariant: 'neutral',
    badgeLabel: `${ev.protocol} ${ev.httpStatus ?? 200}`,
    borderVar: 'var(--color-border-default)',
    bgTint: 'var(--color-background-surface)',
    actorLane: 'buyer',
  };
}

export function CausalObservatoryGraph({
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

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--color-border-default) 55%, transparent) 1px, transparent 0)',
        backgroundSize: '18px 18px',
        backgroundColor: 'var(--color-background-subtle, var(--color-background-surface))',
        overflow: 'hidden',
      }}>
      {/* Compact Observatory Header Bar */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--color-border-subtle, var(--color-border-default))',
          backgroundColor: 'var(--color-background-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}>
        <HStack gap={2} vAlign="center">
          <Text type="label" weight="semibold">
            Causal Observatory
          </Text>
          <Token
            size="sm"
            color="gray"
            label={`${session.buyerAgentId} ↔ Conduit Proxy ↔ ${session.merchantHost}`}
          />
        </HStack>

        <HStack gap={3} vAlign="center">
          <StatusDot
            variant={heldR02 ? 'warning' : 'success'}
            isPulsing={Boolean(heldR02)}
            label={
              heldR02
                ? `${heldR02.code} held in proxy · buyer has 0 offers`
                : 'Wire synchronized · 0 frames held'
            }
          />
        </HStack>
      </div>

      {/* Main Causal Spine + Commercial Offer Cradle */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: expanded ? '18px 20px' : '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        {/* Causal Flow Grid: Responsive wrap with zero horizontal scroll */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${expanded ? '210px' : '172px'}, 1fr))`,
            gap: 10,
            alignItems: 'stretch',
          }}>
          {session.events.map((ev, idx) => {
            const isSelected = ev.id === selectedEventId;
            const meta = getNodeStateMeta(ev);
            const laneLabel =
              meta.actorLane === 'buyer'
                ? 'Buyer'
                : meta.actorLane === 'proxy'
                  ? 'Proxy Gate'
                  : 'Seller';

            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onSelectEvent(ev.id)}
                data-testid={`graph-node-${ev.code}`}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 10,
                  padding: expanded ? '12px 13px' : '9px 11px',
                  border: isSelected
                    ? `2px solid var(--color-interactive-primary, #2563eb)`
                    : `1px solid ${meta.borderVar}`,
                  backgroundColor: meta.bgTint,
                  boxShadow: isSelected
                    ? '0 0 0 3px color-mix(in srgb, var(--color-interactive-primary, #2563eb) 18%, transparent)'
                    : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 6,
                  minWidth: 0,
                  position: 'relative',
                  transition: 'border-color 120ms ease, box-shadow 120ms ease',
                }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    minWidth: 0,
                  }}>
                  <HStack gap={1.5} vAlign="center">
                    <span
                      style={{
                        fontFamily: 'var(--font-family-mono, monospace)',
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 4,
                        backgroundColor:
                          'color-mix(in srgb, var(--color-text-primary) 9%, transparent)',
                        color: 'var(--color-text-primary)',
                      }}>
                      {idx + 1}. {ev.code}
                    </span>
                    <Text type="supporting" size="2xs" maxLines={1}>
                      {laneLabel}
                    </Text>
                  </HStack>
                  <Badge variant={meta.badgeVariant} label={meta.badgeLabel} />
                </div>

                <div style={{minWidth: 0}}>
                  <Text type="code" size="2xs" weight="semibold" maxLines={1}>
                    {ev.toolOrEndpoint}
                  </Text>
                  <Text
                    type="supporting"
                    size="2xs"
                    maxLines={expanded ? 3 : 2}>
                    {ev.observation}
                  </Text>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop:
                      '1px dashed color-mix(in srgb, var(--color-border-default) 70%, transparent)',
                    paddingTop: 5,
                  }}>
                  <Text type="code" size="3xs" color="secondary">
                    {ev.direction === 'buyer_to_seller'
                      ? 'Buyer → Seller'
                      : ev.direction === 'buyer_to_gate'
                        ? 'Buyer → Gate'
                        : 'Seller → Buyer'}
                  </Text>
                  <Text
                    type="code"
                    size="3xs"
                    color="secondary"
                    hasTabularNumbers>
                    {ev.durationLabel}
                  </Text>
                </div>
              </button>
            );
          })}

          {/* When R02 is HELD, explicitly show downstream buyer selection as UNREACHED (fixes P0 #01!) */}
          {heldR02 && (
            <div
              data-testid="graph-node-unreached-downstream"
              style={{
                borderRadius: 10,
                padding: expanded ? '12px 13px' : '9px 11px',
                border: '1px dashed var(--color-border-default)',
                backgroundColor:
                  'color-mix(in srgb, var(--color-background-surface) 55%, transparent)',
                opacity: 0.72,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 6,
                minWidth: 0,
              }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}>
                <Text type="code" size="2xs" color="secondary">
                  Next · C03
                </Text>
                <Badge variant="neutral" label="UNREACHED" />
              </div>
              <Text type="supporting" size="2xs" maxLines={3}>
                {session.buyerAgentId} has 0 offers while {heldR02.code} is
                held. `select_product` runs only after release.
              </Text>
              <Text type="code" size="3xs" color="secondary">
                Awaits {heldR02.code} delivery
              </Text>
            </div>
          )}
        </div>

        {/* Commercial Offer & Proxy Mutation Cradle (renders when session involves commercial offers) */}
        {offerEvent && (
          <div
            onClick={() => onSelectEvent(offerEvent.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectEvent(offerEvent.id);
              }
            }}
            style={{
              borderRadius: 10,
              padding: expanded ? '12px 14px' : '9px 12px',
              backgroundColor: 'var(--color-background-surface)',
              border: '1px solid var(--color-border-default)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              cursor: 'pointer',
            }}>
            <HStack gap={1.5} vAlign="center" wrap>
              <Text type="label" size="2xs" weight="semibold">
                {offerEvent.code} Cradle:
              </Text>
              <Token
                size="sm"
                color="gray"
                label={`Floor $${session.marginFloorUsd}`}
              />
              {(offerEvent.upstreamOffers ?? []).map(off => (
                <Token
                  key={off.id}
                  size="sm"
                  color={off.marginDelta < 0 ? 'red' : 'blue'}
                  label={`${off.id} $${off.price} (${off.marginDelta >= 0 ? `+$${off.marginDelta}` : `-$${Math.abs(off.marginDelta)}`})`}
                />
              ))}
              {offerEvent.stagedOffer && (
                <Token
                  size="sm"
                  color={
                    offerEvent.deliveryPhase === 'delivered_modified'
                      ? 'green'
                      : offerEvent.mutationEnabled !== false
                        ? 'orange'
                        : 'gray'
                  }
                  label={
                    offerEvent.deliveryPhase === 'delivered_modified'
                      ? `+${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price} (Delivered)`
                      : offerEvent.mutationEnabled !== false
                        ? `+${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price} (Staged)`
                        : `${offerEvent.stagedOffer.id} Off`
                  }
                />
              )}
            </HStack>

            <Badge
              variant={
                offerEvent.deliveryPhase === 'held_at_proxy'
                  ? 'warning'
                  : offerEvent.deliveryPhase === 'delivered_modified'
                    ? 'info'
                    : 'success'
              }
              label={
                offerEvent.deliveryPhase === 'held_at_proxy'
                  ? `${offerEvent.upstreamOffers?.length ?? 2} observed → ${
                      offerEvent.mutationEnabled !== false
                        ? (offerEvent.upstreamOffers?.length ?? 2) + 1
                        : (offerEvent.upstreamOffers?.length ?? 2)
                    } staged (undelivered)`
                  : offerEvent.deliveryPhase === 'delivered_modified'
                    ? `${offerEvent.deliveredOffers?.length ?? 3} offers delivered`
                    : 'Original delivered'
              }
            />
          </div>
        )}

        {/* Expanded Graph View Extra Telemetry (when user selects dedicated Graph surface) */}
        {expanded && (
          <div
            style={{
              borderRadius: 10,
              padding: '12px 14px',
              backgroundColor: 'var(--color-background-surface)',
              border: '1px solid var(--color-border-default)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}>
            <VStack gap={1}>
              <Text type="supporting" size="2xs">
                BUYER AGENT TOPOLOGY
              </Text>
              <Text type="body" size="sm" weight="semibold">
                {session.buyerAgentId} · {session.buyerModel}
              </Text>
              <Text type="supporting" size="2xs">
                Fingerprint confidence {session.agentConfidence}
              </Text>
            </VStack>
            <VStack gap={1}>
              <Text type="supporting" size="2xs">
                PROXY INTERCEPTION POSTURE
              </Text>
              <Text type="body" size="sm" weight="semibold">
                {session.trafficProfile}
              </Text>
              <Text type="supporting" size="2xs">
                95% read-only catalog calls pass in &lt;3ms with 0 UI columns
              </Text>
            </VStack>
            <VStack gap={1}>
              <Text type="supporting" size="2xs">
                UNIT ECONOMICS GUARDRAIL
              </Text>
              <Text type="body" size="sm" weight="semibold" hasTabularNumbers>
                SKU {session.skuCode} · Floor ${session.marginFloorUsd}.00 /
                MSRP ${session.msrpUsd}.00
              </Text>
              <Text type="supporting" size="2xs">
                {session.selectedOfferLabel ??
                  'No buyer offer selection recorded yet'}
              </Text>
            </VStack>
          </div>
        )}
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

function renderPhaseBadge(phase: DeliveryPhase, httpStatus: number | null) {
  switch (phase) {
    case 'held_at_proxy':
      return <Badge variant="warning" label="HELD · PROXY" />;
    case 'awaiting_pass':
      return <Badge variant="purple" label="AWAITING PASS" />;
    case 'delivered_modified':
      return <Badge variant="info" label="200 · MODIFIED" />;
    case 'pass_authorized':
      return <Badge variant="success" label="200 · SETTLED" />;
    case 'delivered_original':
      return <Badge variant="success" label={`${httpStatus ?? 200} · DELIVERED`} />;
    case 'observed_inbound':
    default:
      return <Badge variant="neutral" label={`${httpStatus ?? 200} · OBSERVED`} />;
  }
}

export function filterTraceEvents(
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

const GRID_TEMPLATE =
  '42px 92px 46px minmax(112px, 1.1fr) minmax(120px, 1.8fr) 68px 118px';

export function DenseTraceTable({
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
  const activeGrid = isNarrow
    ? '44px minmax(0, 1fr) 118px'
    : GRID_TEMPLATE;

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-background-surface)',
        overflow: 'hidden',
      }}>
      {/* Trace Subheader */}
      <div
        style={{
          padding: '6px 14px',
          borderBottom: '1px solid var(--color-border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}>
        <HStack gap={2} vAlign="center">
          <Text type="label" size="xs" weight="semibold">
            Synchronized Execution Trace
          </Text>
          <Text type="supporting" size="2xs" hasTabularNumbers>
            ({filtered.length}/{events.length})
          </Text>
        </HStack>
        {!isNarrow && (
          <Text type="supporting" size="2xs">
            Select any frame to open canonical inspection
          </Text>
        )}
      </div>

      {/* Dense Column Header (Zero Horizontal Scroll) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: activeGrid,
          gap: 8,
          padding: '6px 14px',
          borderBottom: '1px solid var(--color-border-default)',
          backgroundColor:
            'var(--color-background-subtle, var(--color-background-surface))',
          alignItems: 'center',
          flexShrink: 0,
        }}>
        <Text type="supporting" size="3xs" weight="semibold">
          STEP
        </Text>
        {!isNarrow && (
          <>
            <Text type="supporting" size="3xs" weight="semibold">
              DIRECTION
            </Text>
            <Text type="supporting" size="3xs" weight="semibold">
              PROTO
            </Text>
            <Text type="supporting" size="3xs" weight="semibold">
              TOOL / ENDPOINT
            </Text>
          </>
        )}
        <Text type="supporting" size="3xs" weight="semibold">
          {isNarrow ? 'TOOL & OBSERVATION' : 'CANONICAL OBSERVATION'}
        </Text>
        {!isNarrow && (
          <Text type="supporting" size="3xs" weight="semibold" justify="end">
            LATENCY
          </Text>
        )}
        <Text type="supporting" size="3xs" weight="semibold" justify="end">
          DELIVERY STATE
        </Text>
      </div>

      {/* Rows */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
        {filtered.length === 0 ? (
          <div style={{padding: 24}}>
            <EmptyState
              title="No frames match active trace filter"
              description="Switch back to All frames to view the full causal sequence."
              primaryAction={{
                label: 'Show all frames',
                onClick: onResetFilter,
              }}
            />
          </div>
        ) : (
          filtered.map(ev => {
            const isSelected = ev.id === selectedEventId;
            const isHeld = ev.deliveryPhase === 'held_at_proxy';

            return (
              <div
                key={ev.id}
                role="row"
                tabIndex={0}
                data-testid={`trace-row-${ev.code}`}
                onClick={() => onSelectEvent(ev.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectEvent(ev.id);
                  }
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: activeGrid,
                  gap: 8,
                  padding: '7px 14px',
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderBottom:
                    '1px solid color-mix(in srgb, var(--color-border-default) 55%, transparent)',
                  borderLeft: isSelected
                    ? '3px solid var(--color-interactive-primary, #2563eb)'
                    : isHeld
                      ? '3px solid #d97706'
                      : '3px solid transparent',
                  backgroundColor: isSelected
                    ? 'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 9%, var(--color-background-surface))'
                    : isHeld
                      ? 'color-mix(in srgb, #f59e0b 7%, var(--color-background-surface))'
                      : 'transparent',
                }}>
                <div style={{minWidth: 0}}>
                  <Text
                    type="code"
                    size="2xs"
                    weight="semibold"
                    hasTabularNumbers>
                    {ev.code}
                  </Text>
                </div>

                {!isNarrow ? (
                  <>
                    <div style={{minWidth: 0}}>
                      <Text type="supporting" size="2xs" maxLines={1}>
                        {ev.direction === 'buyer_to_seller'
                          ? 'Buyer → Seller'
                          : ev.direction === 'buyer_to_gate'
                            ? 'Buyer → Gate'
                            : 'Seller → Buyer'}
                      </Text>
                    </div>

                    <div style={{minWidth: 0}}>
                      <Badge
                        variant={ev.protocol === 'MCP' ? 'cyan' : 'neutral'}
                        label={ev.protocol}
                      />
                    </div>

                    <div style={{minWidth: 0}}>
                      <Text type="code" size="2xs" maxLines={1}>
                        {ev.toolOrEndpoint}
                      </Text>
                    </div>

                    <div style={{minWidth: 0}}>
                      <Text type="body" size="xs" maxLines={1}>
                        {ev.observation}
                      </Text>
                    </div>

                    <div style={{minWidth: 0, textAlign: 'right'}}>
                      <Text
                        type="code"
                        size="2xs"
                        color={isHeld ? 'primary' : 'secondary'}
                        hasTabularNumbers
                        maxLines={1}>
                        {ev.durationLabel}
                      </Text>
                    </div>
                  </>
                ) : (
                  <div style={{minWidth: 0}}>
                    <Text type="code" size="2xs" maxLines={1}>
                      {ev.toolOrEndpoint}
                    </Text>
                    <Text type="supporting" size="2xs" maxLines={1}>
                      {ev.observation}
                    </Text>
                  </div>
                )}

                <div
                  style={{
                    minWidth: 0,
                    display: 'flex',
                    justifyContent: 'flex-end',
                  }}>
                  {renderPhaseBadge(ev.deliveryPhase, ev.httpStatus)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}



interface CanonicalInspectorPanelProps {
  session: MerchantSession;
  event: TraceEvent | null;
  onToggleMutation: (eventId: string, nextEnabled: boolean) => void;
  onTransmitModified: (eventId: string) => void;
  onForwardOriginal: (eventId: string) => void;
  onAuthorizePass: (eventId: string) => void;
  onRejectPass: (eventId: string) => void;
  onClose: () => void;
}

export function CanonicalInspectorPanel({
  session,
  event,
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
      <div style={{padding: 16}}>
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center">
            <Heading level={5}>Frame Inspector</Heading>
            <Button
              size="sm"
              variant="ghost"
              label="Collapse"
              onClick={onClose}
            />
          </HStack>
          <Text type="supporting" size="xs">
            Select any node in the Causal Observatory or row in the trace to
            inspect its wire frame and policy gates.
          </Text>
        </VStack>
      </div>
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

  // Panel Title adapts cleanly to operator task
  const panelTitle = isHeldQuote
    ? `Quote Approval · ${event.code}`
    : isHistoricalModified
      ? `Historical Quote Record · ${event.code}`
      : isAwaitingPass
        ? `Checkout Pass Gate · ${event.code}`
        : `Frame Inspection · ${event.code}`;

  return (
    <div
      data-testid="canonical-inspector-panel"
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-background-surface)',
        overflow: 'hidden',
      }}>
      {/* Sticky Canonical Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}>
        <HStack gap={2} vAlign="center">
          <Heading level={5}>{panelTitle}</Heading>
          <Badge
            variant={
              isHeldQuote
                ? 'warning'
                : isAwaitingPass
                  ? 'purple'
                  : isHistoricalModified
                    ? 'info'
                    : 'neutral'
            }
            label={event.protocol}
          />
        </HStack>
        <Button
          size="sm"
          variant="ghost"
          label="Hide panel"
          tooltip="Collapse right panel to give 100% width to the Observatory"
          onClick={onClose}
        />
      </div>

      {/* Scrollable Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '12px 14px',
        }}>
        <VStack gap={3}>
          {/* 1. EXPLICIT DELIVERY STATE BANNER (Fixes #01 P0 & #04 P1) */}
          {isHeldQuote && (
            <Banner
              status="warning"
              container="card"
              collapsible={false}
              title="HELD AT PROXY · NOT DELIVERED TO BUYER"
              description={`${event.sourceActor} returned ${upstreamCount} offers. Conduit paused outbound delivery — ${event.targetActor} has received 0 offers so far.`}
            />
          )}

          {isHistoricalModified && (
            <Banner
              status="info"
              container="card"
              collapsible={false}
              title={`DELIVERED AT ${event.deliveredAt ?? event.timestamp} · HISTORICAL RECORD`}
              description={`Transmitted ${event.deliveredOffers?.length ?? proposedCount} offers to ${event.targetActor}. Wire payload is now immutable; mutation controls are locked.`}
            />
          )}

          {event.deliveryPhase === 'delivered_original' && (
            <Banner
              status="success"
              container="card"
              collapsible={false}
              title={`DELIVERED UNMODIFIED AT ${event.deliveredAt ?? event.timestamp}`}
              description={`Original seller response was forwarded directly to ${event.targetActor} with zero proxy mutations.`}
            />
          )}

          {isAwaitingPass && (
            <Banner
              status="info"
              container="card"
              collapsible={false}
              title="CHECKOUT PASS REQUESTED · 0 FRAMES HELD IN PROXY"
              description={`${event.sourceActor} selected an offer and is requesting a single-use capability pass ($${event.passRequest?.requestedCap ?? 0}.00 cap) before payment execution.`}
            />
          )}

          {/* 2. DEFINED DIRECTION, SOURCE, PROXY RULE, TARGET RECIPIENT */}
          <Card variant="muted" padding={3}>
            <VStack gap={2}>
              <Text type="label" size="2xs" weight="semibold">
                ROUTE & ENVELOPE METADATA
              </Text>
              <MetadataList size="sm">
                <MetadataListItem label="Direction">
                  {event.direction === 'seller_to_buyer'
                    ? 'Outbound MCP Response (Seller → Buyer)'
                    : event.direction === 'buyer_to_gate'
                      ? 'Pass Authority Gate (Buyer → Conduit)'
                      : 'Inbound Request (Buyer → Seller)'}
                </MetadataListItem>
                <MetadataListItem label="Source">
                  {event.sourceActor}
                </MetadataListItem>
                <MetadataListItem label="Recipient">
                  {event.targetActor}
                </MetadataListItem>
                <MetadataListItem label="Tool / URI">
                  {event.toolOrEndpoint}
                </MetadataListItem>
                {event.proxyRuleId && (
                  <MetadataListItem label="Rule Gate">
                    {event.proxyRuleId}
                  </MetadataListItem>
                )}
              </MetadataList>
            </VStack>
          </Card>

          {/* 3. QUOTE APPROVAL / OFFER SEMANTIC DIFF SURFACE */}
          {isOfferFrame && event.upstreamOffers && (
            <>
              <Card padding={3}>
                <VStack gap={2.5}>
                  <HStack hAlign="between" vAlign="center" wrap>
                    <Text type="label" size="xs" weight="semibold">
                      Semantic Offer Diff
                    </Text>
                    <Badge
                      variant={
                        isHeldQuote
                          ? mutationOn
                            ? 'warning'
                            : 'neutral'
                          : 'info'
                      }
                      label={
                        isHistoricalModified
                          ? `${upstreamCount} upstream → ${event.deliveredOffers?.length ?? proposedCount} delivered`
                          : isFloorLeakReplacement && mutationOn
                            ? `${upstreamCount} upstream ($189 leak) → ${proposedCount} compliant`
                            : `${upstreamCount} original offers → ${proposedCount} proposed offers`
                      }
                    />
                  </HStack>

                  {/* Observed Original Upstream Offers */}
                  <VStack gap={1}>
                    <Text type="supporting" size="2xs" weight="semibold">
                      1. OBSERVED ORIGINAL ({upstreamCount} from{' '}
                      {session.merchantHost})
                    </Text>
                    {event.upstreamOffers.map(off => {
                      const violatesFloor = off.marginDelta < 0;
                      const replacedByRule =
                        violatesFloor && mutationOn && isFloorLeakReplacement;
                      return (
                        <div
                          key={off.id}
                          style={{
                            padding: '6px 9px',
                            borderRadius: 7,
                            border: violatesFloor
                              ? '1px solid #ef4444'
                              : '1px solid var(--color-border-default)',
                            backgroundColor:
                              'var(--color-background-subtle, var(--color-background-surface))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            opacity: replacedByRule ? 0.65 : 1,
                          }}>
                          <div style={{minWidth: 0}}>
                            <Text
                              type="body"
                              size="xs"
                              weight="medium"
                              hasStrikethrough={replacedByRule}>
                              {off.id} · {off.label}
                            </Text>
                            <Text type="supporting" size="2xs" maxLines={1}>
                              {off.perk}
                            </Text>
                          </div>
                          <HStack gap={1.5} vAlign="center">
                            <Token
                              size="sm"
                              color={violatesFloor ? 'red' : 'gray'}
                              label={`$${off.price}.00`}
                            />
                          </HStack>
                        </div>
                      );
                    })}
                  </VStack>

                  <Divider />

                  {/* Explicit JSON-RPC Protocol Modification Rule (Fixes #04 P1 — not a mystery promo toggle!) */}
                  {event.stagedOffer && (
                    <VStack gap={1.5}>
                      <Text type="supporting" size="2xs" weight="semibold">
                        2. PROTOCOL FRAME MUTATION (`result.offers[]`)
                      </Text>
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border:
                            mutationOn && isHeldQuote
                              ? '1px solid var(--color-interactive-primary, #2563eb)'
                              : '1px solid var(--color-border-default)',
                          backgroundColor:
                            mutationOn && isHeldQuote
                              ? 'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 6%, var(--color-background-surface))'
                              : 'transparent',
                        }}>
                        <Switch
                          width="100%"
                          labelSpacing="spread"
                          label={
                            isFloorLeakReplacement
                              ? `Replace O01 ($189) with ${event.stagedOffer.id} ($${event.stagedOffer.price}.00)`
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
                      </div>
                    </VStack>
                  )}

                  {/* Resulting Outbound Offer Set */}
                  <VStack gap={1}>
                    <Text type="supporting" size="2xs" weight="semibold">
                      {isHistoricalModified
                        ? `3. DELIVERED RESPONSE (${event.deliveredOffers?.length ?? proposedCount} offers received by ${event.targetActor})`
                        : `3. PROPOSED OUTBOUND PAYLOAD (${proposedCount} offers -> ${event.targetActor})`}
                    </Text>
                    <HStack gap={1.5} wrap>
                      {(isHistoricalModified
                        ? (event.deliveredOffers ?? [])
                        : [
                            ...event.upstreamOffers.filter(
                              o =>
                                !(
                                  o.marginDelta < 0 &&
                                  mutationOn &&
                                  isFloorLeakReplacement
                                ),
                            ),
                            ...(mutationOn && event.stagedOffer
                              ? [event.stagedOffer]
                              : []),
                          ]
                      ).map(o => (
                        <Token
                          key={o.id}
                          size="sm"
                          color={
                            o.source === 'proxy_injected'
                              ? 'green'
                              : o.marginDelta < 0
                                ? 'red'
                                : 'blue'
                          }
                          label={`${o.id}: $${o.price}.00${o.source === 'proxy_injected' ? ' (+injected)' : ''}`}
                        />
                      ))}
                    </HStack>
                  </VStack>
                </VStack>
              </Card>
            </>
          )}

          {/* 4. CHECKOUT PASS GATE SURFACE (when session/event awaits capability pass) */}
          {isAwaitingPass && event.passRequest && (
            <Card padding={3}>
              <VStack gap={2.5}>
                <HStack hAlign="between" vAlign="center">
                  <Text type="label" size="xs" weight="semibold">
                    Requested Capability Pass Scope
                  </Text>
                  <Badge variant="purple" label="SINGLE-USE" />
                </HStack>
                <MetadataList size="sm">
                  <MetadataListItem label="Buyer Agent">
                    {event.sourceActor}
                  </MetadataListItem>
                  <MetadataListItem label="SPIFFE ID">
                    {event.passRequest.agentFingerprint}
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    {event.passRequest.sku}
                  </MetadataListItem>
                  <MetadataListItem label="Amount Cap">
                    ${event.passRequest.requestedCap}.00 USD (hard ceiling)
                  </MetadataListItem>
                  <MetadataListItem label="Pass TTL">
                    {event.passRequest.ttl}
                  </MetadataListItem>
                </MetadataList>
              </VStack>
            </Card>
          )}

          {/* 5. CANONICAL VALIDATION GATES (Lives ONLY here — Fixes #05 P2!) */}
          {event.validations && event.validations.length > 0 && (
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                <Text type="label" size="2xs" weight="semibold">
                  POLICY & SCHEMA VALIDATION
                </Text>
                {event.validations.map(v => (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}>
                    <div style={{minWidth: 0}}>
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
                      <div style={{paddingLeft: 16}}>
                        <Text type="supporting" size="2xs">
                          {v.detail}
                        </Text>
                      </div>
                    </div>
                  </div>
                ))}
              </VStack>
            </Card>
          )}

          {/* 6. EXACT WIRE PAYLOAD / DIFF REVIEW BEFORE TRANSMISSION */}
          <VStack gap={1.5}>
            <HStack hAlign="between" vAlign="center">
              <Text type="label" size="2xs" weight="semibold">
                {event.wireDiffJson && (mutationOn || isHistoricalModified)
                  ? `EXACT JSON-RPC DIFF (TARGET: ${event.targetActor})`
                  : `RAW ${event.protocol} WIRE PAYLOAD`}
              </Text>
              <Token
                size="sm"
                color="gray"
                label={`→ ${event.targetActor}`}
              />
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

      {/* Sticky Canonical Action Footer — Unambiguous Delivery State + Disabled Explanations (Fixes #04 P1) */}
      {(isOfferFrame || isAwaitingPass) && (
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--color-border-default)',
            backgroundColor:
              'var(--color-background-subtle, var(--color-background-surface))',
            flexShrink: 0,
          }}>
          {isHeldQuote ? (
            <VStack gap={2}>
              <Switch
                width="100%"
                labelSpacing="spread"
                label={`Confirm target ${event.targetActor} & exact JSON-RPC payload`}
                value={payloadReviewed}
                onChange={setPayloadReviewed}
              />

              <HStack gap={2}>
                <Button
                  width="100%"
                  variant="primary"
                  label={
                    mutationOn
                      ? `Transmit Modified (${proposedCount} offers)`
                      : 'Enable Mutation Rule to Transmit Diff'
                  }
                  isDisabled={!mutationOn || !payloadReviewed}
                  tooltip={
                    !payloadReviewed
                      ? 'Confirm exact wire payload & target recipient above before transmitting'
                      : !mutationOn
                        ? 'Protocol mutation rule is off — use Forward Original (2 offers) or re-enable mutation'
                        : `Send ${proposedCount} validated offers to ${event.targetActor}`
                  }
                  onClick={() => onTransmitModified(event.id)}
                />
                <Button
                  width="100%"
                  variant="secondary"
                  label={`Forward Original (${upstreamCount} offers)`}
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

              {/* Explicit visible explanation whenever a control is disabled (Fixes #04 P1!) */}
              {event.forwardOriginalBlockedReason && (
                <Text type="supporting" size="2xs">
                  <strong>Why Forward Original is disabled:</strong>{' '}
                  {event.forwardOriginalBlockedReason}
                </Text>
              )}
              {!payloadReviewed && (
                <Text type="supporting" size="2xs">
                  <strong>Transmission locked:</strong> Confirm exact outbound
                  message & recipient `{event.targetActor}` above to unlock send
                  actions.
                </Text>
              )}
            </VStack>
          ) : isAwaitingPass ? (
            <VStack gap={2}>
              <HStack gap={2}>
                <Button
                  width="100%"
                  variant="primary"
                  label={`Issue Scoped Pass ($${event.passRequest?.requestedCap ?? 0})`}
                  onClick={() => onAuthorizePass(event.id)}
                />
                <Button
                  width="100%"
                  variant="destructive"
                  label="Reject Checkout"
                  onClick={() => onRejectPass(event.id)}
                />
              </HStack>
            </VStack>
          ) : (
            <VStack gap={1.5}>
              <HStack gap={2}>
                <Button
                  width="100%"
                  variant="secondary"
                  isDisabled
                  label="Response Already Delivered"
                  tooltip={`Completed at ${event.deliveredAt ?? event.timestamp} — historical frames cannot be re-sent`}
                />
              </HStack>
              <Text type="supporting" size="2xs">
                <strong>Controls locked:</strong> {event.code} was already
                delivered to `{event.targetActor}` at{' '}
                {event.deliveredAt ?? event.timestamp}. Use{' '}
                <strong>Reset Scenario</strong> in the top bar to replay live
                interception.
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

export function WireSurface({
  session,
  selectedEventId,
  onSelectEvent,
}: WireSurfaceProps) {
  const [protoFilter, setProtoFilter] = useState<'all' | 'MCP' | 'HTTP'>('all');
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

  return (
    <div
      data-testid="wire-surface"
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-background-surface)',
        overflow: 'hidden',
      }}>
      {/* Wire Filter Toolbar */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--color-border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            maxWidth: '100%',
          }}>
          <Heading level={5}>Wire Evidence Capture</Heading>
          <SegmentedControl
            size="sm"
            label="Filter protocol"
            value={protoFilter}
            onChange={v => setProtoFilter(v as 'all' | 'MCP' | 'HTTP')}>
            <SegmentedControlItem value="all" label="All" />
            <SegmentedControlItem value="MCP" label="MCP" />
            <SegmentedControlItem value="HTTP" label="HTTP" />
          </SegmentedControl>
        </div>
        <Text type="supporting" size="2xs" hasTabularNumbers>
          Host: {session.merchantHost} · {frames.length} captured packets
        </Text>
      </div>

      {/* Horizontal Split: Packet List + Raw Wire Envelope */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflow: 'hidden',
        }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            borderRight: '1px solid var(--color-border-default)',
          }}>
          {frames.map(f => {
            const selected = activeFrame?.id === f.id;
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectEvent(f.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectEvent(f.id);
                  }
                }}
                style={{
                  padding: '9px 14px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--color-border-default)',
                  backgroundColor: selected
                    ? 'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 9%, var(--color-background-surface))'
                    : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}>
                <div style={{minWidth: 0}}>
                  <HStack gap={1.5} vAlign="center">
                    <Text
                      type="code"
                      size="2xs"
                      weight="semibold"
                      hasTabularNumbers>
                      #{f.seq} · {f.code}
                    </Text>
                    <Badge
                      variant={f.protocol === 'MCP' ? 'cyan' : 'neutral'}
                      label={f.protocol}
                    />
                    <Text type="code" size="2xs" maxLines={1}>
                      {f.toolOrEndpoint}
                    </Text>
                  </HStack>
                  <Text type="supporting" size="2xs" maxLines={1}>
                    {f.sourceActor} → {f.targetActor} · {f.timestamp}
                  </Text>
                </div>
                <Badge
                  variant={
                    f.deliveryPhase === 'held_at_proxy'
                      ? 'warning'
                      : f.deliveryPhase === 'awaiting_pass'
                        ? 'purple'
                        : 'success'
                  }
                  label={
                    f.deliveryPhase === 'held_at_proxy'
                      ? 'HELD'
                      : String(f.httpStatus ?? 200)
                  }
                />
              </div>
            );
          })}
        </div>

        <ResizeHandle
          direction="horizontal"
          isReversed
          hasDivider
          resizable={detailSplit.props}
          label="Resize raw packet pane"
        />

        <div
          style={{
            width: detailSplit.size,
            flexShrink: 0,
            overflowY: 'auto',
            padding: '12px 14px',
          }}>
          {activeFrame && (
            <VStack gap={3}>
              <HStack hAlign="between" vAlign="center">
                <Text type="label" size="xs" weight="semibold">
                  Packet #{activeFrame.seq} ({activeFrame.code}) Headers
                </Text>
                <Token
                  size="sm"
                  color="gray"
                  label={activeFrame.durationLabel}
                />
              </HStack>
              <Card variant="muted" padding={3}>
                <MetadataList size="sm">
                  {Object.entries(activeFrame.headers).map(([k, v]) => (
                    <MetadataListItem key={k} label={k}>
                      {v}
                    </MetadataListItem>
                  ))}
                </MetadataList>
              </Card>
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
          )}
        </div>
      </div>
    </div>
  );
}

interface PassesSurfaceProps {
  passes: CapabilityPassRecord[];
  onRevokePass: (passId: string) => void;
  onApprovePendingPass: (passId: string) => void;
}

export function PassesSurface({
  passes,
  onRevokePass,
  onApprovePendingPass,
}: PassesSurfaceProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const visible = passes.filter(p =>
    statusFilter === 'all' ? true : p.status === statusFilter,
  );

  return (
    <div
      data-testid="passes-surface"
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-background-surface)',
        overflow: 'hidden',
      }}>
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            maxWidth: '100%',
          }}>
          <Heading level={5}>Scoped Capability Passes Ledger</Heading>
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
        </div>
        <Text type="supporting" size="2xs">
          Ed25519 single-use checkout capabilities bound to SKU, amount cap, and
          TTL
        </Text>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '14px 16px',
        }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 12,
          }}>
          {visible.map(pass => (
            <Card key={pass.id} padding={3}>
              <VStack gap={2.5}>
                <HStack hAlign="between" vAlign="center">
                  <Text type="code" size="xs" weight="semibold">
                    {pass.id}
                  </Text>
                  <Badge
                    variant={
                      pass.status === 'Active'
                        ? 'success'
                        : pass.status === 'Awaiting Approval'
                          ? 'purple'
                          : pass.status === 'Revoked'
                            ? 'error'
                            : 'neutral'
                    }
                    label={pass.status}
                  />
                </HStack>
                <MetadataList size="sm">
                  <MetadataListItem label="Merchant">
                    {pass.merchantHost}
                  </MetadataListItem>
                  <MetadataListItem label="Buyer Agent">
                    {pass.buyerAgent}
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    {pass.sku}
                  </MetadataListItem>
                  <MetadataListItem label="Spend Ceiling">
                    ${pass.capUsd}.00 USD ({pass.remainingCalls} call remaining)
                  </MetadataListItem>
                  <MetadataListItem label="TTL / Issued">
                    {pass.ttl} · {pass.issuedAt}
                  </MetadataListItem>
                  <MetadataListItem label="Signature">
                    {pass.signature}
                  </MetadataListItem>
                </MetadataList>

                <HStack gap={2}>
                  {pass.status === 'Awaiting Approval' && (
                    <Button
                      size="sm"
                      variant="primary"
                      width="100%"
                      label={`Sign & Issue ($${pass.capUsd}.00)`}
                      onClick={() => onApprovePendingPass(pass.id)}
                    />
                  )}
                  {pass.status === 'Active' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      width="100%"
                      label="Revoke Pass"
                      onClick={() => onRevokePass(pass.id)}
                    />
                  )}
                </HStack>
              </VStack>
            </Card>
          ))}
        </div>
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

export default function ConduitMcpWorkbench() {
  

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

  // Switch session: auto-open decision drawer ONLY if session has an active hold or pending pass!
  // On 95% discovery traffic (DisplayCo) or settled sessions, collapse drawer to 0px!
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

  // Interactive Mutation Toggle on Held R02
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

  // Interactive Transmit Modified Response -> Transitions R02 to Historical + Materializes C03 & C04!
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
                observation: `DELIVERED (MODIFIED): ${deliveredList.length} offers sent to ${ev.targetActor} (+${chosenOffer?.id ?? 'O03'} $${mintedCartCap}.00)`,
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
          selectedOfferLabel: `${chosenOffer?.id ?? 'O03'} · $${mintedCartCap}.00 (${chosenOffer?.label ?? 'Promo'})`,
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
              observation: `Buyer selected delivered offer ${chosenOffer?.id ?? 'O03'} ($${mintedCartCap}.00) -> cart CART-8841`,
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
              durationLabel: 'AWAITING PASS',
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

  // Interactive Forward Original Unmodified (2 offers)
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
                observation: `DELIVERED (ORIGINAL): ${origOffers.length} unmodified offers forwarded to ${ev.targetActor}`,
                headers: {
                  ...ev.headers,
                  'x-conduit-hold-state': 'FORWARDED_ORIGINAL',
                },
              },
        );

        return {
          ...sess,
          selectedOfferLabel: `${picked?.id ?? 'O01'} · $${cap}.00 (Original)`,
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
              observation: `Buyer selected original offer ${picked?.id ?? 'O01'} ($${cap}.00) -> cart CART-8842`,
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
              durationLabel: 'AWAITING PASS',
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

  // Interactive Authorize Scoped Checkout Pass -> Completes Settlement!
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
                      durationLabel: 'REJECTED',
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
        style={{
          height: '100dvh',
          width: '100vw',
          overflow: 'hidden',
          backgroundColor: 'var(--color-background-surface)',
          color: 'var(--color-text-primary)',
          display: 'flex',
          flexDirection: 'column',
        }}>
        <style>{'nextjs-portal { display: none !important; }'}</style>
        <Layout
          height="fill"
          header={
            <LayoutHeader hasDivider>
              <VStack gap={2}>
                {/* Top Row: MCP Control Plane Identity + Scenario Presets + Astryx Theme Controls */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}>
                  <HStack gap={2} vAlign="center" wrap>
                    <HStack gap={1.5} vAlign="center">
                      <StatusDot variant="accent" isPulsing />
                      <Heading level={5}>Conduit</Heading>
                      {!isMobile && (
                        <Badge variant="neutral" label="MCP Control Plane" />
                      )}
                    </HStack>

                    {/* Mobile Session Switcher */}
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
                        label="Reset Scenario"
                        onClick={() => applyScenarioPreset(scenario)}
                      />
                    )}
                  </HStack>

                  
                </div>

                {/* Second Row: Concise Commercial Context Strip + Canonical 5-Stage Progress (0 Column Width!) */}
                <div
                  data-testid="commercial-context-strip"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    paddingTop: 6,
                    borderTop:
                      '1px solid color-mix(in srgb, var(--color-border-default) 60%, transparent)',
                    flexWrap: 'wrap',
                  }}>
                  <HStack gap={2} vAlign="center" wrap>
                    <Text type="code" size="2xs" weight="semibold">
                      {activeSession.merchantHost}
                    </Text>
                    <Text type="supporting" size="2xs">
                      ← {activeSession.buyerAgentId}
                    </Text>
                    <Token
                      size="sm"
                      color="gray"
                      label={`SKU: ${activeSession.skuName} ($${activeSession.msrpUsd} MSRP · $${activeSession.marginFloorUsd} Floor)`}
                    />
                    {activeSession.selectedOfferLabel && (
                      <Token
                        size="sm"
                        color="green"
                        label={`Selected: ${activeSession.selectedOfferLabel}`}
                      />
                    )}
                  </HStack>

                  {/* Canonical 5-Stage Progress Indicator (Synchronized with Sidebar & Footer — Fixes #02 P1) */}
                  <HStack gap={1.5} vAlign="center" wrap>
                    {!isMobile && (
                      <div
                        data-testid="canonical-stage-pills"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 6px',
                          borderRadius: 999,
                          border: '1px solid var(--color-border-default)',
                          backgroundColor:
                            'var(--color-background-subtle, var(--color-background-surface))',
                        }}>
                        {STAGE_ORDER.map((st, idx) => {
                          const isCurrent = idx === metrics.stageIndex;
                          const isPast = idx < metrics.stageIndex;
                          return (
                            <span
                              key={st}
                              style={{
                                fontSize: 11,
                                fontWeight: isCurrent ? 700 : 500,
                                padding: '2px 8px',
                                borderRadius: 999,
                                backgroundColor: isCurrent
                                  ? metrics.proxyHeldCount > 0
                                    ? 'color-mix(in srgb, #f59e0b 24%, transparent)'
                                    : metrics.awaitingPassCount > 0
                                      ? 'color-mix(in srgb, #8b5cf6 24%, transparent)'
                                      : 'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 20%, transparent)'
                                  : 'transparent',
                                color: isCurrent
                                  ? 'var(--color-text-primary)'
                                  : isPast
                                    ? 'var(--color-text-primary)'
                                    : 'var(--color-text-secondary)',
                                opacity: isCurrent || isPast ? 1 : 0.55,
                              }}>
                              {isPast ? `✓ ${st}` : st}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Contextual Right Drawer Trigger (Demonstrates 0-column default on 95% discovery traffic!) */}
                    {(activeSurface === 'overview' ||
                      activeSurface === 'graph') &&
                      (metrics.heldEventId ? (
                        <Button
                          size="sm"
                          variant={isInspectorOpen ? 'secondary' : 'primary'}
                          label={
                            isInspectorOpen
                              ? 'Quote Approval Open'
                              : 'Review Held Quote (1)'
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
                              ? 'Pass Gate Open'
                              : 'Review Pass Request (1)'
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
                              ? 'Hide Inspector (Full Width)'
                              : 'Inspect Selected Frame'
                          }
                          onClick={() => setIsInspectorOpen(v => !v)}
                        />
                      ))}
                  </HStack>
                </div>

                {/* Mobile Surface Switcher */}
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
                <LayoutPanel width={sidebarResize.size} hasDivider={false}>
                  <VStack gap={3}>
                    {/* 1. LIVE SESSIONS (Canonical Stage & Counts) */}
                    <VStack gap={1}>
                      <Text type="supporting" size="3xs" weight="semibold">
                        LIVE MERCHANT SESSIONS
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
                              label={sess.merchantName}
                              description={`${sm.stage} · ${
                                sm.proxyHeldCount > 0
                                  ? `${sm.proxyHeldCount} held`
                                  : sm.awaitingPassCount > 0
                                    ? 'awaiting pass'
                                    : `${sm.eventCount} frames`
                              }`}
                              endContent={
                                sm.proxyHeldCount > 0 ? (
                                  <Badge variant="warning" label="HELD" />
                                ) : sm.awaitingPassCount > 0 ? (
                                  <Badge variant="purple" label="PASS" />
                                ) : sess.id === 'displayco' ? (
                                  <Badge variant="neutral" label="95%" />
                                ) : (
                                  <Badge variant="success" label="OK" />
                                )
                              }
                            />
                          );
                        })}
                      </List>
                    </VStack>

                    <Divider />

                    {/* 2. SURFACES */}
                    <VStack gap={1}>
                      <Text type="supporting" size="3xs" weight="semibold">
                        SURFACES
                      </Text>
                      <List density="compact">
                        <ListItem
                          isSelected={activeSurface === 'overview'}
                          onClick={() => setActiveSurface('overview')}
                          label="Overview"
                          description="Observatory + dense trace"
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
                          description="MCP & HTTP raw packets"
                        />
                        <ListItem
                          isSelected={activeSurface === 'passes'}
                          onClick={() => setActiveSurface('passes')}
                          label="Passes"
                          description="Scoped checkout capabilities"
                          endContent={
                            metrics.globalAwaitingPassCount > 0 ? (
                              <Badge
                                variant="purple"
                                label={String(metrics.globalAwaitingPassCount)}
                              />
                            ) : undefined
                          }
                        />
                      </List>
                    </VStack>

                    <Divider />

                    {/* 3. TRACE FILTERS */}
                    <VStack gap={1}>
                      <Text type="supporting" size="3xs" weight="semibold">
                        TRACE FILTERS
                      </Text>
                      <List density="compact">
                        <ListItem
                          isSelected={traceFilter === 'all'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('all');
                          }}
                          label="All Frames"
                          endContent={
                            <Text
                              type="code"
                              size="3xs"
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
                          label="HTTP Transport"
                        />
                        <ListItem
                          isSelected={traceFilter === 'attention'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('attention');
                          }}
                          label="Held / Awaiting Gate"
                          endContent={
                            metrics.proxyHeldCount +
                              metrics.awaitingPassCount >
                            0 ? (
                              <Badge
                                variant="warning"
                                label={String(
                                  metrics.proxyHeldCount +
                                    metrics.awaitingPassCount,
                                )}
                              />
                            ) : undefined
                          }
                        />
                        <ListItem
                          isSelected={traceFilter === 'modified'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('modified');
                          }}
                          label="Proxy Mutations"
                        />
                      </List>
                    </VStack>
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
            <LayoutContent padding={0}>
              <div
                style={{
                  height: '100%',
                  width: '100%',
                  display: 'flex',
                  overflow: 'hidden',
                }}>
                {/* Central Workspace */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}>
                  {activeSurface === 'overview' && (
                    <>
                      {/* Top Pane: Compact Causal Observatory Graph */}
                      <div
                        style={{
                          height: isMobile ? 315 : graphHeightResize.size,
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

                      {/* Bottom Pane: Synchronized Dense Execution Trace (Zero Duplicate Cards Below!) */}
                      <div
                        style={{
                          flex: 1,
                          minHeight: 0,
                          overflow: 'hidden',
                        }}>
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

                {/* Contextual Right Canonical Inspection / Decision Panel (0px when closed / on 95% discovery traffic!) */}
                {showDesktopRightPanel && (
                  <>
                    <ResizeHandle
                      direction="horizontal"
                      isReversed
                      hasDivider
                      resizable={inspectorResize.props}
                      label="Resize Canonical Inspection Panel"
                    />
                    <div
                      style={{
                        width: inspectorResize.size,
                        flexShrink: 0,
                        height: '100%',
                        overflow: 'hidden',
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
              {/* Single Canonical Status Bar — Explicitly separates Proxy Held from Awaiting Pass! (Fixes #02 P1) */}
              <div
                data-testid="canonical-status-bar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                  width: '100%',
                }}>
                <HStack gap={3} vAlign="center" wrap>
                  <StatusDot
                    variant={
                      metrics.proxyHeldCount > 0
                        ? 'warning'
                        : metrics.awaitingPassCount > 0
                          ? 'accent'
                          : 'success'
                    }
                    isPulsing={metrics.proxyHeldCount > 0}
                    label={
                      metrics.proxyHeldCount > 0
                        ? `Proxy Interception Active`
                        : 'Conduit Proxy Streaming'
                    }
                  />
                  <Text type="code" size="2xs" hasTabularNumbers>
                    {metrics.eventCount} events · {metrics.proxyHeldCount} held
                    by proxy · {metrics.awaitingPassCount} awaiting pass
                  </Text>
                </HStack>

                <HStack gap={3} vAlign="center" wrap>
                  <Text type="supporting" size="2xs">
                    {metrics.stageHeadline}
                  </Text>
                  <Token
                    size="sm"
                    color="gray"
                    label={`Active Passes: ${metrics.activePassCountGlobal}`}
                  />
                </HStack>
              </div>
            </LayoutFooter>
          }
        />

        {/* Mobile (<1024px) BottomSheet Decision / Inspection Drawer */}
        {isMobile && (
          <BottomSheet
            isOpen={isInspectorOpen}
            onOpenChange={setIsInspectorOpen}
            label="Canonical Frame Inspection"
            height="lg"
            padding="none">
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
          </BottomSheet>
        )}
      </div>
    </>
  );
}
