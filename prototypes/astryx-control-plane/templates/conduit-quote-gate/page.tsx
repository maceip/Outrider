// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * Conduit — Live Quote Hold & Margin Gate (Mobile Deal Desk)
 *
 * Single-thumb mobile triage queue for approving or replacing high-value
 * outbound AI agent quotes mid-flight.
 */

import {useState, type CSSProperties} from 'react';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Token} from '@astryxdesign/core/Token';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {useToast} from '@astryxdesign/core/Toast';
import {Check, Eye, ShieldAlert, XCircle} from 'lucide-react';

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

const styles: Record<string, CSSProperties> = {
  scrollArea: {
    height: '100%',
    overflowY: 'auto',
  },
};

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
          <VStack gap={2.5} width="100%">
            <HStack justify="between" align="center" width="100%">
              <HStack gap={2} align="center">
                <StatusDot
                  variant={pendingCount > 0 ? 'warning' : 'success'}
                  label="Queue status"
                  isPulsing={pendingCount > 0}
                />
                <Heading level={3}>Quote Gate</Heading>
              </HStack>
              <Token
                label={
                  pendingCount > 0 ? `${pendingCount} Held` : 'Queue Clear'
                }
                size="sm"
                color={pendingCount > 0 ? 'orange' : 'green'}
              />
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
        <LayoutContent role="main" padding={3} style={styles.scrollArea}>
          <VStack gap={3}>
            <Banner
              status={
                decision === 'approved'
                  ? 'success'
                  : decision === 'blocked'
                    ? 'error'
                    : 'warning'
              }
              container="card"
              collapsible={false}
              title={
                decision === 'approved'
                  ? `Approved $${deal.counterQuote} counter-offer`
                  : decision === 'blocked'
                    ? 'Outbound quote dropped at edge'
                    : `Stopped $${deal.leakedQuote} below-floor quote`
              }
              description={
                decision
                  ? `Pass ${deal.passId} state updated in local control plane.`
                  : `Original response was $${deal.floor - deal.leakedQuote} under your $${deal.floor} margin floor.`
              }
            />

            <Card padding={3}>
              <VStack gap={3}>
                <HStack justify="between" align="center">
                  <VStack gap={0.5}>
                    <Heading level={4}>{deal.merchant}</Heading>
                    <Text type="supporting" color="secondary">
                      {deal.item}
                    </Text>
                  </VStack>
                  <ShieldAlert size={18} />
                </HStack>

                <HStack gap={2} width="100%">
                  <StackItem size="fill">
                    <Card variant="red" padding={2.5}>
                      <VStack gap={0.5}>
                        <Text type="supporting" color="secondary">
                          Blocked Leak
                        </Text>
                        <Heading level={3}>${deal.leakedQuote}</Heading>
                      </VStack>
                    </Card>
                  </StackItem>
                  <StackItem size="fill">
                    <Card variant="muted" padding={2.5}>
                      <VStack gap={0.5}>
                        <Text type="supporting" color="secondary">
                          Margin Floor
                        </Text>
                        <Heading level={3}>${deal.floor}</Heading>
                      </VStack>
                    </Card>
                  </StackItem>
                  <StackItem size="fill">
                    <Card variant="green" padding={2.5}>
                      <VStack gap={0.5}>
                        <Text type="supporting" color="secondary">
                          Counter
                        </Text>
                        <Heading level={3}>${deal.counterQuote}</Heading>
                      </VStack>
                    </Card>
                  </StackItem>
                </HStack>

                <Divider />

                <MetadataList
                  columns="single"
                  label={{position: 'start', width: 112}}>
                  <MetadataListItem label="Buyer Agent">
                    <Token label={deal.agent} size="sm" color="purple" />
                  </MetadataListItem>
                  <MetadataListItem label="Margin Rescue">
                    <Text type="body" weight="semibold" hasTabularNumbers>
                      +${marginSaved} (+${netAboveFloor} over floor)
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Scoped Pass">
                    <Token
                      label={`${deal.passId} · 15m TTL`}
                      size="sm"
                      color="teal"
                    />
                  </MetadataListItem>
                </MetadataList>

                <Divider />

                <Switch
                  label="Include Value-Add Counter Bundle"
                  description={deal.perk}
                  value={attachPerk}
                  onChange={setAttachPerk}
                  labelSpacing="spread"
                />

                <VStack gap={2} width="100%">
                  <Button
                    label={`Approve & Counter at $${deal.counterQuote}`}
                    variant="primary"
                    width="100%"
                    icon={<Check size={16} />}
                    onClick={() => {
                      setDecisions(prev => ({...prev, [deal.id]: 'approved'}));
                      showToast({
                        body: `Sent $${deal.counterQuote} counter-offer for ${deal.merchant}`,
                        type: 'success',
                        uniqueID: `ok-${deal.id}`,
                      });
                    }}
                  />
                  <HStack gap={2} width="100%">
                    <StackItem size="fill">
                      <Button
                        label="Wire Diff"
                        variant="secondary"
                        width="100%"
                        icon={<Eye size={16} />}
                        onClick={() => setPayloadOpen(true)}
                      />
                    </StackItem>
                    <StackItem size="fill">
                      <Button
                        label="Drop Quote"
                        variant="destructive"
                        width="100%"
                        icon={<XCircle size={16} />}
                        onClick={() => {
                          setDecisions(prev => ({
                            ...prev,
                            [deal.id]: 'blocked',
                          }));
                          showToast({
                            body: `Dropped below-floor quote for ${deal.merchant}`,
                            uniqueID: `drop-${deal.id}`,
                          });
                        }}
                      />
                    </StackItem>
                  </HStack>
                </VStack>
              </VStack>
            </Card>
          </VStack>

          <BottomSheet
            isOpen={payloadOpen}
            onOpenChange={setPayloadOpen}
            label="Intercepted Quote Payload"
            padding={4}>
            <VStack gap={3}>
              <Heading level={3}>Outbound Payload Rewrite</Heading>
              <CodeBlock
                title={`${deal.merchant} · ${deal.passId}`}
                language="json"
                isDiff
                size="sm"
                width="100%"
                isWrapped
                code={deal.rawDiff}
              />
            </VStack>
          </BottomSheet>
        </LayoutContent>
      }
    />
  );
}
