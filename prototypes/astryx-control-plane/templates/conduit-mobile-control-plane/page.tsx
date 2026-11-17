// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * Conduit — Agentic Commerce Control Plane (Mobile Workbench)
 *
 * Mobile-first 4-surface workbench (Overview | Approve | Wire | Passes) built
 * with Meta Astryx components for rapid iteration in the 402x874 phone stage.
 */

import {useMemo, useState, type CSSProperties} from 'react';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {List, ListItem} from '@astryxdesign/core/List';
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
import {
  CheckCircle2,
  Code2,
  Cpu,
  KeyRound,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

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
        protocol: 'MCP / HTTP2',
        summary: 'Buyer agent requested studio monitors <= $210 landed',
        latency: '38 ms',
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
        step: 'llmmap · behavioral_fingerprint',
        protocol: 'Conduit Core',
        summary: 'Identified Claude 3.7 Sonnet (ReAct loop, 98.4% match)',
        latency: '4 ms',
        state: 'captured',
        payload: JSON.stringify(
          {
            probe_window: '3 turns',
            inferred_model: 'claude-3.7-sonnet',
            prompt_framework: 'ReAct + structured MCP',
            price_elasticity: 'high-intent-bundle',
          },
          null,
          2,
        ),
      },
      {
        id: 'F03',
        step: 'R02 · return_offers',
        protocol: 'MCP Outbound',
        summary: 'Outbound quote paused at margin gate before leaving store',
        latency: 'HELD',
        state: 'held',
        payload: [
          ' {',
          '   "session": "conduit-sess-9042",',
          '-  "offer_id": "O01-PROMO-LEAK",',
          '-  "unit_price_usd": 189,',
          '-  "margin_delta_usd": -9,',
          '+  "offer_id": "O03-STUDIO-BUNDLE",',
          '+  "unit_price_usd": 209,',
          '+  "included_bundle": "IsoPads + 48h Express",',
          '+  "margin_delta_usd": 11',
          ' }',
        ].join('\n'),
      },
    ],
    passes: [
      {
        id: 'CP-9042',
        scope: 'AudioShop · SKU-MON-03 only',
        cap: '$209.00',
        ttl: '15m',
        status: 'staged',
      },
      {
        id: 'CP-8991',
        scope: 'AudioShop · Cable Add-on',
        cap: '$29.00',
        ttl: '8m',
        status: 'active',
      },
    ],
  },
  {
    id: 'skyport',
    merchant: 'Skyport Air',
    sku: 'SFO -> NRT · Business Upgrade',
    agentModel: 'GPT-4.1',
    topology: 'Plan-and-Execute · REST',
    confidence: '96.1%',
    buyerTarget: 390,
    marginFloor: 385,
    heldOffer: 445,
    counterOffer: 412,
    bundlePerk: 'O02 · Lounge Access + Priority Bag Tag',
    frames: [
      {
        id: 'F11',
        step: 'POST /v2/agent/quotes',
        protocol: 'HTTPS',
        summary: 'Executive travel agent requested instant cabin upgrade',
        latency: '52 ms',
        state: 'captured',
        payload: JSON.stringify(
          {
            route: 'SFO-NRT',
            cabin: 'business-upgrade',
            agent_budget_usd: 415,
          },
          null,
          2,
        ),
      },
      {
        id: 'F12',
        step: 'R04 · return_fare_quote',
        protocol: 'HTTPS Outbound',
        summary: 'Held stacked corporate promo code below cabin floor',
        latency: 'HELD',
        state: 'held',
        payload: [
          ' {',
          '   "route": "SFO-NRT",',
          '-  "upgrade_fare_usd": 368,',
          '+  "upgrade_fare_usd": 412,',
          '+  "perks": ["Club Lounge", "Priority Handling"]',
          ' }',
        ].join('\n'),
      },
    ],
    passes: [
      {
        id: 'CP-7710',
        scope: 'Skyport · PNR-88X2 Upgrade',
        cap: '$412.00',
        ttl: '10m',
        status: 'staged',
      },
    ],
  },
  {
    id: 'displayco',
    merchant: 'DisplayCo',
    sku: '5K OLED Pro Panel · 3-Seat Pack',
    agentModel: 'Gemini 2.5 Pro',
    topology: 'Parallel Tool-Call · MCP',
    confidence: '97.8%',
    buyerTarget: 1150,
    marginFloor: 1120,
    heldOffer: 1240,
    counterOffer: 1180,
    bundlePerk: 'O04 · Zero-Dead-Pixel Calibration + Net-30',
    frames: [
      {
        id: 'F21',
        step: 'tools/call · request_volume_quote',
        protocol: 'MCP / WS',
        summary: 'Procurement agent comparing 3 studio display vendors',
        latency: '29 ms',
        state: 'captured',
        payload: JSON.stringify(
          {
            sku: 'OLED-5K-PRO',
            seats: 3,
            requested_unit_usd: 1150,
          },
          null,
          2,
        ),
      },
      {
        id: 'F22',
        step: 'R07 · return_volume_offer',
        protocol: 'MCP Outbound',
        summary: 'High-value quote ($3,540 total) held for deal-desk sign-off',
        latency: 'HELD',
        state: 'held',
        payload: [
          ' {',
          '   "seats": 3,',
          '-  "unit_price_usd": 1090,',
          '+  "unit_price_usd": 1180,',
          '+  "calibration_tier": "Factory-DeltaE<1"',
          ' }',
        ].join('\n'),
      },
    ],
    passes: [
      {
        id: 'CP-6402',
        scope: 'DisplayCo · 3x OLED-5K-PRO',
        cap: '$3,540.00',
        ttl: '30m',
        status: 'staged',
      },
    ],
  },
];

const styles: Record<string, CSSProperties> = {
  scrollArea: {
    height: '100%',
    overflowY: 'auto',
  },
};

export default function ConduitMobileControlPlane() {
  const showToast = useToast();
  const [sessionId, setSessionId] = useState<string>(SESSIONS[0].id);
  const [activeTab, setActiveTab] = useState<MobileTab>('overview');
  const [useCounterOffer, setUseCounterOffer] = useState<boolean>(true);
  const [autoRevokeOnDrift, setAutoRevokeOnDrift] = useState<boolean>(true);
  const [approvedIds, setApprovedIds] = useState<Record<string, boolean>>({});
  const [inspectFrame, setInspectFrame] = useState<WireFrame | null>(null);
  const [isDiffSheetOpen, setIsDiffSheetOpen] = useState<boolean>(false);

  const session = useMemo(
    () => SESSIONS.find(s => s.id === sessionId) ?? SESSIONS[0],
    [sessionId],
  );

  const isApproved = Boolean(approvedIds[session.id]);
  const activeQuotePrice = useCounterOffer
    ? session.counterOffer
    : session.heldOffer;
  const netMargin = activeQuotePrice - session.marginFloor;

  const sessionMenuItems = useMemo(
    () =>
      SESSIONS.map(item => ({
        label: `${item.merchant} · $${item.counterOffer}`,
        onClick: () => {
          setSessionId(item.id);
          setInspectFrame(null);
        },
      })),
    [],
  );

  const handleApproveQuote = () => {
    setApprovedIds(prev => ({...prev, [session.id]: true}));
    showToast({
      body: `Released $${activeQuotePrice} quote to ${session.agentModel} and activated pass ${session.passes[0].id}`,
      type: 'success',
      uniqueID: `approve-${session.id}`,
    });
  };

  const handleResetDemo = () => {
    setApprovedIds(prev => ({...prev, [session.id]: false}));
    showToast({
      body: `Re-armed mid-flight quote hold for ${session.merchant}`,
      uniqueID: `reset-${session.id}`,
    });
  };

  const heldFrame =
    session.frames[session.frames.length - 1] ?? session.frames[0];

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={2.5} width="100%">
            <HStack justify="between" align="center" gap={2} width="100%">
              <HStack gap={2} align="center">
                <StatusDot
                  variant={isApproved ? 'success' : 'warning'}
                  label={isApproved ? 'Quote released' : 'Outbound quote held'}
                  isPulsing={!isApproved}
                />
                <Heading level={3}>Conduit</Heading>
                <Token
                  label={isApproved ? 'Live' : '1 Held'}
                  size="sm"
                  color={isApproved ? 'green' : 'orange'}
                />
              </HStack>
              <DropdownMenu
                presentation="adaptive"
                alignment="end"
                button={{
                  label: session.merchant,
                  variant: 'secondary',
                  size: 'sm',
                }}
                items={sessionMenuItems}
              />
            </HStack>

            <SegmentedControl
              label="Control plane surface"
              layout="fill"
              size="sm"
              value={activeTab}
              onChange={value => setActiveTab(value as MobileTab)}>
              <SegmentedControlItem value="overview" label="Overview" />
              <SegmentedControlItem
                value="approve"
                label={isApproved ? 'Approve' : 'Approve (1)'}
              />
              <SegmentedControlItem value="wire" label="Wire" />
              <SegmentedControlItem value="passes" label="Passes" />
            </SegmentedControl>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" padding={3} style={styles.scrollArea}>
          <VStack gap={3}>
            {activeTab === 'overview' && (
              <>
                <Banner
                  status={isApproved ? 'success' : 'warning'}
                  container="card"
                  collapsible={false}
                  title={
                    isApproved
                      ? `Counter-offer ($${activeQuotePrice}) delivered`
                      : 'Outbound agent quote paused mid-flight'
                  }
                  description={
                    isApproved
                      ? `Scoped checkout pass ${session.passes[0].id} is active above your $${session.marginFloor} margin floor.`
                      : `${heldFrame.step} intercepted before leaving ${session.merchant}. Validate against $${session.marginFloor} floor.`
                  }
                  endContent={
                    <Button
                      label={isApproved ? 'Inspect' : 'Review'}
                      size="sm"
                      variant={isApproved ? 'secondary' : 'primary'}
                      onClick={() => setActiveTab('approve')}
                    />
                  }
                />

                <Card padding={3}>
                  <VStack gap={2.5}>
                    <HStack justify="between" align="center" gap={2}>
                      <HStack gap={1.5} align="center">
                        <Cpu size={16} />
                        <Heading level={4}>Agent Fingerprint</Heading>
                      </HStack>
                      <Token
                        label={`${session.confidence} LLMmap`}
                        size="sm"
                        color="purple"
                      />
                    </HStack>

                    <Text type="supporting" color="secondary">
                      {session.sku}
                    </Text>

                    <Divider />

                    <MetadataList
                      columns="single"
                      label={{position: 'start', width: 112}}>
                      <MetadataListItem label="Inferred LLM">
                        <Text type="body" weight="medium">
                          {session.agentModel}
                        </Text>
                      </MetadataListItem>
                      <MetadataListItem label="Framework">
                        <Token
                          label={session.topology}
                          size="sm"
                          color="blue"
                        />
                      </MetadataListItem>
                      <MetadataListItem label="Buyer Ask">
                        <Text type="body" hasTabularNumbers>
                          ${session.buyerTarget}.00 max
                        </Text>
                      </MetadataListItem>
                      <MetadataListItem label="Margin Floor">
                        <Text type="body" weight="semibold" hasTabularNumbers>
                          ${session.marginFloor}.00 (+${netMargin} net)
                        </Text>
                      </MetadataListItem>
                    </MetadataList>
                  </VStack>
                </Card>

                <Card padding={3}>
                  <VStack gap={2}>
                    <HStack justify="between" align="center">
                      <Heading level={4}>Live Negotiation Trace</Heading>
                      <Button
                        label="All frames"
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveTab('wire')}
                      />
                    </HStack>
                    <List density="compact">
                      {session.frames.map(frame => {
                        const effectiveState =
                          frame.state === 'held' && isApproved
                            ? 'rewritten'
                            : frame.state;
                        return (
                          <ListItem
                            key={frame.id}
                            align="first-line"
                            label={frame.step}
                            description={frame.summary}
                            startContent={
                              <StatusDot
                                variant={
                                  effectiveState === 'held'
                                    ? 'warning'
                                    : effectiveState === 'rewritten'
                                      ? 'success'
                                      : 'accent'
                                }
                                label={effectiveState}
                              />
                            }
                            endContent={
                              <Token
                                label={
                                  effectiveState === 'rewritten'
                                    ? 'SENT'
                                    : frame.latency
                                }
                                size="sm"
                                color={
                                  effectiveState === 'held'
                                    ? 'orange'
                                    : effectiveState === 'rewritten'
                                      ? 'green'
                                      : 'gray'
                                }
                              />
                            }
                            onClick={() => setInspectFrame(frame)}
                          />
                        );
                      })}
                    </List>
                  </VStack>
                </Card>
              </>
            )}

            {activeTab === 'approve' && (
              <>
                <Card padding={3}>
                  <VStack gap={3}>
                    <HStack justify="between" align="center">
                      <HStack gap={1.5} align="center">
                        {isApproved ? (
                          <ShieldCheck size={18} />
                        ) : (
                          <ShieldAlert size={18} />
                        )}
                        <Heading level={4}>Pause & Counter Live Quote</Heading>
                      </HStack>
                      <Token
                        label={isApproved ? 'Approved' : 'Held Mid-Flight'}
                        size="sm"
                        color={isApproved ? 'green' : 'orange'}
                      />
                    </HStack>

                    <Text type="supporting" color="secondary">
                      {session.merchant} · {session.sku}
                    </Text>

                    <HStack gap={2} width="100%">
                      <StackItem size="fill">
                        <Card variant="muted" padding={2.5}>
                          <VStack gap={0.5}>
                            <Text type="supporting" color="secondary">
                              Margin Floor
                            </Text>
                            <Heading level={3}>${session.marginFloor}</Heading>
                          </VStack>
                        </Card>
                      </StackItem>
                      <StackItem size="fill">
                        <Card variant="muted" padding={2.5}>
                          <VStack gap={0.5}>
                            <Text type="supporting" color="secondary">
                              Buyer Target
                            </Text>
                            <Heading level={3}>${session.buyerTarget}</Heading>
                          </VStack>
                        </Card>
                      </StackItem>
                      <StackItem size="fill">
                        <Card
                          variant={isApproved ? 'green' : 'blue'}
                          padding={2.5}>
                          <VStack gap={0.5}>
                            <Text type="supporting" color="secondary">
                              Staged Quote
                            </Text>
                            <Heading level={3}>${activeQuotePrice}</Heading>
                          </VStack>
                        </Card>
                      </StackItem>
                    </HStack>

                    <Divider />

                    <Switch
                      label={`Package Dynamic Counter ($${session.counterOffer})`}
                      description={session.bundlePerk}
                      value={useCounterOffer}
                      onChange={setUseCounterOffer}
                      labelSpacing="spread"
                      status={{
                        type: 'success',
                        message: `Clears margin floor by +$${netMargin}.00 per unit while matching ${session.agentModel} bundle preference.`,
                      }}
                    />

                    <Divider />

                    <MetadataList
                      columns="single"
                      label={{position: 'start', width: 118}}>
                      <MetadataListItem label="Policy Gate">
                        <HStack gap={1.5} align="center">
                          <StatusDot variant="success" label="Passed" />
                          <Text type="body" hasTabularNumbers>
                            Floor +${netMargin}.00 verified
                          </Text>
                        </HStack>
                      </MetadataListItem>
                      <MetadataListItem label="Promo Leak">
                        <Token
                          label="Blocked (-$30 code stripped)"
                          size="sm"
                          color="red"
                        />
                      </MetadataListItem>
                      <MetadataListItem label="Checkout Pass">
                        <Token
                          label={`${session.passes[0].id} · ${session.passes[0].ttl}`}
                          size="sm"
                          color="teal"
                        />
                      </MetadataListItem>
                    </MetadataList>

                    <VStack gap={2} width="100%">
                      {!isApproved ? (
                        <Button
                          label={`Approve & Send $${activeQuotePrice} Counter`}
                          variant="primary"
                          width="100%"
                          icon={<Sparkles size={16} />}
                          onClick={handleApproveQuote}
                        />
                      ) : (
                        <Button
                          label="Re-arm Mid-Flight Hold"
                          variant="secondary"
                          width="100%"
                          icon={<RotateCcw size={16} />}
                          onClick={handleResetDemo}
                        />
                      )}
                      <Button
                        label="Inspect Outbound Wire Diff"
                        variant="secondary"
                        width="100%"
                        icon={<Code2 size={16} />}
                        onClick={() => setIsDiffSheetOpen(true)}
                      />
                    </VStack>
                  </VStack>
                </Card>
              </>
            )}

            {activeTab === 'wire' && (
              <Card padding={3}>
                <VStack gap={2.5}>
                  <HStack justify="between" align="center">
                    <Heading level={4}>HTTP / MCP / WS Wire Frames</Heading>
                    <Token
                      label={`${session.frames.length} captured`}
                      size="sm"
                      color="blue"
                    />
                  </HStack>
                  <Text type="supporting" color="secondary">
                    Tap any frame to inspect raw payloads or outbound diff
                    rewrites in a mobile sheet.
                  </Text>
                  <Divider />
                  <List density="compact">
                    {session.frames.map(frame => {
                      const effectiveState =
                        frame.state === 'held' && isApproved
                          ? 'rewritten'
                          : frame.state;
                      return (
                        <ListItem
                          key={frame.id}
                          align="first-line"
                          label={`${frame.id} · ${frame.step}`}
                          description={`${frame.protocol} — ${frame.summary}`}
                          startContent={
                            <StatusDot
                              variant={
                                effectiveState === 'held'
                                  ? 'warning'
                                  : effectiveState === 'rewritten'
                                    ? 'success'
                                    : 'accent'
                              }
                              label={effectiveState}
                            />
                          }
                          endContent={
                            <Token
                              label={effectiveState.toUpperCase()}
                              size="sm"
                              color={
                                effectiveState === 'held'
                                  ? 'orange'
                                  : effectiveState === 'rewritten'
                                    ? 'green'
                                    : 'gray'
                              }
                            />
                          }
                          onClick={() => setInspectFrame(frame)}
                        />
                      );
                    })}
                  </List>
                </VStack>
              </Card>
            )}

            {activeTab === 'passes' && (
              <>
                <Card padding={3}>
                  <VStack gap={2.5}>
                    <HStack justify="between" align="center">
                      <HStack gap={1.5} align="center">
                        <KeyRound size={16} />
                        <Heading level={4}>Scoped Checkout Passes</Heading>
                      </HStack>
                      <Token label="Local Keys" size="sm" color="teal" />
                    </HStack>
                    <Text type="supporting" color="secondary">
                      Short-lived capability tokens bound to SKU, price ceiling,
                      and agent session fingerprint.
                    </Text>
                    <Divider />
                    <Switch
                      label="Auto-revoke on SKU or price drift"
                      description="Invalidate pass immediately if agent mutates cart quantities"
                      value={autoRevokeOnDrift}
                      onChange={setAutoRevokeOnDrift}
                      labelSpacing="spread"
                    />
                    <Divider />
                    <List density="compact">
                      {session.passes.map((pass, idx) => {
                        const liveStatus =
                          idx === 0 && isApproved ? 'active' : pass.status;
                        return (
                          <ListItem
                            key={pass.id}
                            align="first-line"
                            label={`${pass.id} · Cap ${pass.cap}`}
                            description={`${pass.scope} · TTL ${pass.ttl}`}
                            startContent={
                              <StatusDot
                                variant={
                                  liveStatus === 'active'
                                    ? 'success'
                                    : 'warning'
                                }
                                label={liveStatus}
                              />
                            }
                            endContent={
                              <Token
                                label={liveStatus.toUpperCase()}
                                size="sm"
                                color={
                                  liveStatus === 'active' ? 'green' : 'orange'
                                }
                              />
                            }
                          />
                        );
                      })}
                    </List>
                    {!isApproved && (
                      <Button
                        label={`Authorize ${session.passes[0].id} ($${activeQuotePrice})`}
                        variant="primary"
                        width="100%"
                        icon={<CheckCircle2 size={16} />}
                        onClick={handleApproveQuote}
                      />
                    )}
                  </VStack>
                </Card>
              </>
            )}
          </VStack>

          <BottomSheet
            isOpen={isDiffSheetOpen}
            onOpenChange={setIsDiffSheetOpen}
            label="Outbound MCP Quote Diff"
            padding={4}>
            <VStack gap={3}>
              <HStack justify="between" align="center">
                <Heading level={3}>Outbound Quote Rewrite</Heading>
                <Token label="MCP JSON Diff" size="sm" color="purple" />
              </HStack>
              <Text type="supporting" color="secondary">
                Conduit strips leaked discount codes and injects the margin-safe
                bundle before releasing the response frame.
              </Text>
              <CodeBlock
                title={`${heldFrame.id} · ${heldFrame.step}`}
                language="json"
                isDiff
                size="sm"
                width="100%"
                isWrapped
                code={heldFrame.payload}
              />
              <Button
                label={
                  isApproved
                    ? 'Close Inspector'
                    : `Approve $${activeQuotePrice} Rewrite`
                }
                variant="primary"
                width="100%"
                onClick={() => {
                  if (!isApproved) {
                    handleApproveQuote();
                  }
                  setIsDiffSheetOpen(false);
                }}
              />
            </VStack>
          </BottomSheet>

          <BottomSheet
            isOpen={inspectFrame != null}
            onOpenChange={open => {
              if (!open) setInspectFrame(null);
            }}
            label={inspectFrame ? inspectFrame.step : 'Frame Inspector'}
            padding={4}>
            {inspectFrame && (
              <VStack gap={3}>
                <HStack justify="between" align="center">
                  <Heading level={3}>{inspectFrame.step}</Heading>
                  <Token
                    label={inspectFrame.protocol}
                    size="sm"
                    color="blue"
                  />
                </HStack>
                <Text type="supporting" color="secondary">
                  {inspectFrame.summary}
                </Text>
                <CodeBlock
                  title={`Frame ${inspectFrame.id}`}
                  language="json"
                  isDiff={inspectFrame.payload.includes('\n-')}
                  size="sm"
                  width="100%"
                  isWrapped
                  code={inspectFrame.payload}
                />
              </VStack>
            )}
          </BottomSheet>
        </LayoutContent>
      }
    />
  );
}
