// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * Conduit — Live Quote Hold & Margin Gate (Mobile Deal Desk)
 *
 * Restrained Astryx layout: MetadataList + Divider + Switch + BottomSheet payload diff.
 */

import {useState} from 'react';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from '@astryxdesign/core/Layout';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useToast} from '@astryxdesign/core/Toast';

interface HeldDeal {
  id: string;
  shortLabel: string;
  merchant: string;
  item: string;
  agent: string;
  leakedQuote: number;
  floor: number;
  counterQuote: number;
  perk: string;
  passId: string;
  rawDiff: string;
}

const HELD_DEALS: HeldDeal[] = [
  {
    id: 'deal-1',
    shortLabel: 'Audio $209',
    merchant: 'AudioShop',
    item: 'Studio Reference Monitors (Pair)',
    agent: 'Claude 3.7 Sonnet · ReAct',
    leakedQuote: 189,
    floor: 198,
    counterQuote: 209,
    perk: 'Include Acoustic Isolation Pads + 48h Express',
    passId: 'CP-9042',
    rawDiff: [
      ' {',
      '   "sku": "MON-REF-PAIR",',
      '-  "stacked_coupon": "VIP20+WELCOME15",',
      '-  "outbound_price_usd": 189,',
      '+  "bundle": "ISO-PADS-EXPRESS",',
      '+  "outbound_price_usd": 209,',
      '+  "checkout_pass": "CP-9042"',
      ' }',
    ].join('\n'),
  },
  {
    id: 'deal-2',
    shortLabel: 'Display $3.5k',
    merchant: 'DisplayCo',
    item: '3x 5K OLED Studio Panels',
    agent: 'Gemini 2.5 Pro · Procurement',
    leakedQuote: 3270,
    floor: 3360,
    counterQuote: 3540,
    perk: 'Include Factory DeltaE<1 Calibration + Net-30 Terms',
    passId: 'CP-6402',
    rawDiff: [
      ' {',
      '   "sku": "OLED-5K-3PACK",',
      '-  "outbound_total_usd": 3270,',
      '+  "outbound_total_usd": 3540,',
      '+  "terms": "Net-30 + Factory Calibration",',
      '+  "checkout_pass": "CP-6402"',
      ' }',
    ].join('\n'),
  },
  {
    id: 'deal-3',
    shortLabel: 'Cloud $890',
    merchant: 'Cloudstore',
    item: 'Annual GPU Inference Commit (10 Seats)',
    agent: 'GPT-4.1 · FinOps Buyer',
    leakedQuote: 780,
    floor: 820,
    counterQuote: 890,
    perk: 'Include Burst Failover Quota + Dedicated Webhook Key',
    passId: 'CP-5118',
    rawDiff: [
      ' {',
      '   "plan": "GPU-COMMIT-ANNUAL",',
      '-  "legacy_discount_usd": 780,',
      '+  "counter_offer_usd": 890,',
      '+  "burst_failover": true,',
      '+  "checkout_pass": "CP-5118"',
      ' }',
    ].join('\n'),
  },
];

export default function ConduitLiveQuoteGatePage() {
  const showToast = useToast();
  const [selectedId, setSelectedId] = useState<string>(HELD_DEALS[0].id);
  const [attachPerk, setAttachPerk] = useState<boolean>(true);
  const [decisions, setDecisions] = useState<
    Record<string, 'approved' | 'blocked'>
  >({});
  const [payloadOpen, setPayloadOpen] = useState<boolean>(false);

  const deal = HELD_DEALS.find(d => d.id === selectedId) ?? HELD_DEALS[0];
  const decision = decisions[deal.id];
  const marginSaved = deal.counterQuote - deal.leakedQuote;
  const netAboveFloor = deal.counterQuote - deal.floor;
  const pendingCount = HELD_DEALS.filter(d => !decisions[d.id]).length;

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <HStack gap={2} vAlign="center">
                  <StatusDot
                    variant={pendingCount > 0 ? 'warning' : 'success'}
                    label="Queue status"
                    isPulsing={pendingCount > 0}
                  />
                  <Heading level={3}>Quote Gate</Heading>
                </HStack>
              </StackItem>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {pendingCount > 0 ? `${pendingCount} held` : 'Queue clear'}
              </Text>
            </HStack>

            <SegmentedControl
              label="Held outbound deals"
              layout="fill"
              size="sm"
              value={selectedId}
              onChange={setSelectedId}>
              {HELD_DEALS.map(item => (
                <SegmentedControlItem
                  key={item.id}
                  value={item.id}
                  label={item.shortLabel}
                />
              ))}
            </SegmentedControl>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" padding={4}>
          <VStack gap={4}>
            <VStack gap={1}>
              <Text type="supporting" color="secondary">
                {decision === 'approved'
                  ? 'Counter-offer transmitted'
                  : decision === 'blocked'
                    ? 'Outbound quote dropped at proxy'
                    : 'Held at proxy · Undelivered'}
              </Text>
              <Heading level={4}>{deal.merchant}</Heading>
              <Text type="supporting" color="secondary">
                {deal.item}
              </Text>
            </VStack>

            <Divider />

            <MetadataList
              columns="single"
              label={{position: 'start', width: 112}}>
              <MetadataListItem label="Buyer agent">
                <Text type="body">{deal.agent}</Text>
              </MetadataListItem>
              <MetadataListItem label="Blocked quote">
                <Text type="code" size="2xs" hasTabularNumbers>
                  ${deal.leakedQuote}.00 USD (-${deal.floor - deal.leakedQuote}
                  .00 below floor)
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Margin floor">
                <Text type="code" size="2xs" hasTabularNumbers>
                  ${deal.floor}.00 USD
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Counter quote">
                <Text type="code" size="2xs" weight="semibold" hasTabularNumbers>
                  ${deal.counterQuote}.00 USD (+${marginSaved}.00 / +$
                  {netAboveFloor}.00 over floor)
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Scoped pass">
                <Text type="code" size="2xs">
                  {deal.passId} · 15m TTL
                </Text>
              </MetadataListItem>
            </MetadataList>

            <Divider />

            <Switch
              width="100%"
              labelSpacing="spread"
              label="Include value-add counter bundle"
              description={deal.perk}
              value={attachPerk}
              isDisabled={Boolean(decision)}
              onChange={setAttachPerk}
            />

            <HStack gap={2}>
              <Button
                width="100%"
                size="sm"
                variant="primary"
                isDisabled={Boolean(decision)}
                label={`Transmit $${deal.counterQuote}`}
                onClick={() => {
                  setDecisions(prev => ({...prev, [deal.id]: 'approved'}));
                  showToast({
                    body: `Sent $${deal.counterQuote} counter-quote for ${deal.merchant}`,
                    uniqueID: `approve-${deal.id}`,
                  });
                }}
              />
              <Button
                width="100%"
                size="sm"
                variant="secondary"
                label="View wire diff"
                onClick={() => setPayloadOpen(true)}
              />
            </HStack>

            {!decision && (
              <Button
                width="100%"
                size="sm"
                variant="ghost"
                label="Drop outbound quote"
                onClick={() => {
                  setDecisions(prev => ({...prev, [deal.id]: 'blocked'}));
                  showToast({
                    body: `Dropped below-floor quote for ${deal.merchant}`,
                    uniqueID: `block-${deal.id}`,
                  });
                }}
              />
            )}

            <BottomSheet
              isOpen={payloadOpen}
              onOpenChange={setPayloadOpen}
              label="Outbound JSON-RPC diff"
              padding={4}>
              <VStack gap={3}>
                <Heading level={4}>{deal.merchant} · Wire Diff</Heading>
                <CodeBlock
                  code={deal.rawDiff}
                  language="json"
                  isDiff
                  size="sm"
                  width="100%"
                  isWrapped
                  title={`${deal.passId} · Outbound mutation`}
                />
              </VStack>
            </BottomSheet>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
