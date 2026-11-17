// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * Conduit — Agentic Commerce Control Plane (Mobile Workbench)
 *
 * Edge-to-edge rows, MetadataList, Divider, and BottomSheet payload inspection
 * following Astryx incident-console/page.tsx.
 */

import {useState, type CSSProperties} from 'react';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useToast} from '@astryxdesign/core/Toast';

type MobileTab = 'overview' | 'approve' | 'wire' | 'passes';

interface WireFrame {
  id: string;
  step: string;
  protocol: string;
  summary: string;
  latency: string;
  state: 'captured' | 'held' | 'rewritten' | 'signed';
  payload: string;
}

interface CheckoutPass {
  id: string;
  scope: string;
  cap: string;
  ttl: string;
  status: 'active' | 'staged' | 'revoked';
}

interface CommerceSession {
  id: string;
  merchant: string;
  sku: string;
  agentModel: string;
  topology: string;
  confidence: string;
  buyerTarget: number;
  marginFloor: number;
  heldOffer: number;
  counterOffer: number;
  bundlePerk: string;
  frames: WireFrame[];
  passes: CheckoutPass[];
}

const SESSIONS: CommerceSession[] = [
  {
    id: 'audioshop',
    merchant: 'AudioShop',
    sku: 'Studio Reference Monitors · Pair',
    agentModel: 'Claude 3.7 Sonnet',
    topology: 'ReAct · MCP Tool-Use',
    confidence: '98.4%',
    buyerTarget: 205,
    marginFloor: 198,
    heldOffer: 219,
    counterOffer: 209,
    bundlePerk: 'O03 · Studio Isolation Pads + 48h Express',
    frames: [
      {
        id: 'F01',
        step: 'tools/call · search_catalog',
        protocol: 'MCP',
        summary: 'Buyer agent requested studio monitors <= $210 landed',
        latency: '2 ms',
        state: 'captured',
        payload: JSON.stringify(
          {
            method: 'tools/call',
            params: {
              name: 'search_catalog',
              arguments: {category: 'monitors', max_price_usd: 210, qty: 1},
            },
          },
          null,
          2,
        ),
      },
      {
        id: 'F02',
        step: 'tools/result · return_offers',
        protocol: 'MCP',
        summary: 'Outbound seller quote ($219, $249) held at proxy',
        latency: 'Held',
        state: 'held',
        payload: JSON.stringify(
          {
            jsonrpc: '2.0',
            id: 'req_02',
            result: {
              offers: [
                {id: 'O01', price_usd: 219},
                {id: 'O02', price_usd: 249},
              ],
            },
          },
          null,
          2,
        ),
      },
    ],
    passes: [
      {
        id: 'pass_aud_7f2',
        scope: 'SWX-BLK-01 · 1 call max',
        cap: '$209.00',
        ttl: '15m 00s',
        status: 'staged',
      },
    ],
  },
  {
    id: 'displayco',
    merchant: 'DisplayCo',
    sku: '27" 5K Creator Reference Display',
    agentModel: 'Gemini 2.5 Pro',
    topology: 'Parallel Spec Sweep',
    confidence: '96.8%',
    buyerTarget: 1120,
    marginFloor: 1090,
    heldOffer: 1199,
    counterOffer: 1149,
    bundlePerk: 'Factory DeltaE<1 Calibration Certificate',
    frames: [
      {
        id: 'D01',
        step: 'GET /v1/products/DSP-5K-27/specs',
        protocol: 'HTTP',
        summary: 'Read-only panel telemetry fetched · 0 holds',
        latency: '3 ms',
        state: 'captured',
        payload: JSON.stringify(
          {sku: 'DSP-5K-27', msrp_usd: 1199, stock: 'in_stock'},
          null,
          2,
        ),
      },
    ],
    passes: [
      {
        id: 'pass_dsp_109',
        scope: 'DSP-5K-27 · 1 call max',
        cap: '$1,199.00',
        ttl: '14m 12s',
        status: 'active',
      },
    ],
  },
];

const styles: Record<string, CSSProperties> = {
  sectionPad: {
    padding: 'var(--spacing-4)',
  },
};

export default function ConduitMobileControlPlanePage() {
  const showToast = useToast();
  const [sessionId, setSessionId] = useState<string>(SESSIONS[0].id);
  const [tab, setTab] = useState<MobileTab>('overview');
  const [includePerk, setIncludePerk] = useState<boolean>(true);
  const [releasedIds, setReleasedIds] = useState<Record<string, boolean>>({});
  const [selectedFrame, setSelectedFrame] = useState<WireFrame | null>(null);

  const session = SESSIONS.find(s => s.id === sessionId) ?? SESSIONS[0];
  const isReleased = Boolean(releasedIds[session.id]);

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <HStack gap={1.5} vAlign="center">
                  <StatusDot
                    variant={!isReleased && session.id === 'audioshop' ? 'warning' : 'neutral'}
                    isPulsing={!isReleased && session.id === 'audioshop'}
                    label="Session state"
                  />
                  <Heading level={4}>Conduit</Heading>
                </HStack>
              </StackItem>
              <DropdownMenu
                presentation="adaptive"
                button={{
                  size: 'sm',
                  variant: 'secondary',
                  label: session.merchant,
                }}
                items={SESSIONS.map(s => ({
                  label: s.merchant,
                  onClick: () => setSessionId(s.id),
                }))}
              />
            </HStack>

            <SegmentedControl
              label="Control plane surface"
              layout="fill"
              size="sm"
              value={tab}
              onChange={v => setTab(v as MobileTab)}>
              <SegmentedControlItem value="overview" label="Overview" />
              <SegmentedControlItem
                value="approve"
                label={!isReleased && session.id === 'audioshop' ? 'Approve (1)' : 'Approve'}
              />
              <SegmentedControlItem value="wire" label="Wire" />
              <SegmentedControlItem value="passes" label="Passes" />
            </SegmentedControl>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" padding={0}>
          {tab === 'overview' && (
            <VStack gap={0}>
              <div style={styles.sectionPad}>
                <VStack gap={2}>
                  <Heading level={5}>Agent Fingerprint</Heading>
                  <MetadataList
                    columns="single"
                    label={{position: 'start', width: 96}}>
                    <MetadataListItem label="Model">
                      <Text type="body">{session.agentModel}</Text>
                    </MetadataListItem>
                    <MetadataListItem label="Topology">
                      <Text type="body">{session.topology}</Text>
                    </MetadataListItem>
                    <MetadataListItem label="Confidence">
                      <Text type="body" hasTabularNumbers>
                        {session.confidence}
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="SKU">
                      <Text type="body">{session.sku}</Text>
                    </MetadataListItem>
                  </MetadataList>
                </VStack>
              </div>

              <Divider />

              <List density="compact" hasDividers>
                {session.frames.map(f => (
                  <ListItem
                    key={f.id}
                    startContent={
                      <StatusDot
                        variant={f.state === 'held' && !isReleased ? 'warning' : 'neutral'}
                        label={f.state}
                      />
                    }
                    label={`${f.id} · ${f.step}`}
                    description={`${f.protocol} · ${f.summary}`}
                    endContent={
                      <Text type="code" size="2xs" color="secondary" hasTabularNumbers>
                        {isReleased && f.state === 'held' ? '200' : f.latency}
                      </Text>
                    }
                    onClick={() => setSelectedFrame(f)}
                  />
                ))}
              </List>
            </VStack>
          )}

          {tab === 'approve' && (
            <div style={styles.sectionPad}>
              <VStack gap={3}>
                <VStack gap={0.5}>
                  <Text type="supporting" color="secondary">
                    {isReleased
                      ? 'Delivered · Historical record'
                      : 'Held at proxy · Not delivered to buyer'}
                  </Text>
                  <Heading level={4}>Pause & Counter Live Quote</Heading>
                </VStack>

                <MetadataList
                  columns="single"
                  label={{position: 'start', width: 108}}>
                  <MetadataListItem label="Observed quote">
                    <Text type="code" size="2xs" hasTabularNumbers>
                      ${session.heldOffer}.00 USD
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="SKU floor">
                    <Text type="code" size="2xs" hasTabularNumbers>
                      ${session.marginFloor}.00 USD
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Counter quote">
                    <Text type="code" size="2xs" weight="semibold" hasTabularNumbers>
                      ${session.counterOffer}.00 USD
                    </Text>
                  </MetadataListItem>
                </MetadataList>

                <Divider />

                <Switch
                  width="100%"
                  labelSpacing="spread"
                  label="Append value-add bundle"
                  description={session.bundlePerk}
                  value={includePerk}
                  isDisabled={isReleased}
                  onChange={setIncludePerk}
                />

                <Button
                  width="100%"
                  size="sm"
                  isDisabled={isReleased}
                  label={
                    isReleased
                      ? 'Quote already transmitted'
                      : `Transmit $${session.counterOffer}.00 quote`
                  }
                  onClick={() => {
                    setReleasedIds(prev => ({...prev, [session.id]: true}));
                    showToast({
                      body: `Transmitted $${session.counterOffer}.00 quote for ${session.merchant}`,
                      uniqueID: `rel-${session.id}`,
                    });
                  }}
                />
              </VStack>
            </div>
          )}

          {tab === 'wire' && (
            <List density="compact" hasDividers>
              {session.frames.map(f => (
                <ListItem
                  key={f.id}
                  label={`${f.id} · ${f.step}`}
                  description={f.summary}
                  endContent={
                    <Text type="code" size="2xs" color="secondary">
                      {f.protocol}
                    </Text>
                  }
                  onClick={() => setSelectedFrame(f)}
                />
              ))}
            </List>
          )}

          {tab === 'passes' && (
            <List density="compact" hasDividers>
              {session.passes.map(p => (
                <ListItem
                  key={p.id}
                  startContent={
                    <StatusDot
                      variant={p.status === 'active' ? 'success' : 'warning'}
                      label={p.status}
                    />
                  }
                  label={`${p.id} · ${p.cap}`}
                  description={`${p.scope} · TTL ${p.ttl}`}
                  endContent={
                    <Text type="supporting" color="secondary">
                      {p.status}
                    </Text>
                  }
                />
              ))}
            </List>
          )}

          {selectedFrame && (
            <BottomSheet
              isOpen={Boolean(selectedFrame)}
              onOpenChange={open => {
                if (!open) setSelectedFrame(null);
              }}
              label={selectedFrame.step}
              padding={4}>
              <VStack gap={3}>
                <Heading level={4}>
                  {selectedFrame.id} · {selectedFrame.step}
                </Heading>
                <CodeBlock
                  code={selectedFrame.payload}
                  language="json"
                  size="sm"
                  width="100%"
                  isWrapped
                  title="Captured JSON-RPC frame"
                />
              </VStack>
            </BottomSheet>
          )}
        </LayoutContent>
      }
    />
  );
}
