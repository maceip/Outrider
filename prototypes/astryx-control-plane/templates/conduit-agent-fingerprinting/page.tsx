// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * Conduit — Active Agent Fingerprinting & Dynamic Service Packaging (Mobile)
 *
 * Uses behavioral LLMmap probe telemetry to identify model versions and
 * prompting frameworks in <= 3 turns, then dynamically packages and prices
 * services per agent session.
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
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
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
import {Fingerprint, Layers, Shield, Zap} from 'lucide-react';

type AgentClass = 'all' | 'shopping' | 'procurement' | 'guarded';

interface LiveAgent {
  id: string;
  handle: string;
  model: string;
  framework: string;
  confidence: string;
  category: Exclude<AgentClass, 'all'>;
  cadence: string;
  packageName: string;
  dynamicPrice: number;
  floorPrice: number;
  probeSignature: string;
}

const AGENTS: LiveAgent[] = [
  {
    id: 'ag-01',
    handle: 'ShopPilot-MCP #409',
    model: 'Claude 3.7 Sonnet',
    framework: 'ReAct · MCP',
    confidence: '98.4%',
    category: 'shopping',
    cadence: '41 ms / turn',
    packageName: 'Express Studio Bundle',
    dynamicPrice: 209,
    floorPrice: 198,
    probeSignature: JSON.stringify(
      {
        llmmap_vector: [0.94, 0.12, 0.88, 0.79],
        inferred_family: 'anthropic/claude-3.7-sonnet',
        tool_schema_adherence: 'strict',
        recommended_tier: 'value-add-bundle (+5.5% margin)',
      },
      null,
      2,
    ),
  },
  {
    id: 'ag-02',
    handle: 'AcmeProcure-Bot #12',
    model: 'GPT-4.1',
    framework: 'Plan-and-Execute',
    confidence: '96.9%',
    category: 'procurement',
    cadence: '63 ms / turn',
    packageName: 'Net-30 SLA Volume Pack',
    dynamicPrice: 1180,
    floorPrice: 1120,
    probeSignature: JSON.stringify(
      {
        llmmap_vector: [0.21, 0.95, 0.64, 0.91],
        inferred_family: 'openai/gpt-4.1',
        negotiation_horizon: 'multi-vendor-comparison',
        recommended_tier: 'sla-calibration-pack',
      },
      null,
      2,
    ),
  },
  {
    id: 'ag-03',
    handle: 'DealSweep-Crawler #88',
    model: 'Llama-3.3-70B (Quant)',
    framework: 'Zero-Shot Coupon Loop',
    confidence: '99.1%',
    category: 'guarded',
    cadence: '11 ms / burst',
    packageName: 'MSRP Floor-Locked Only',
    dynamicPrice: 229,
    floorPrice: 229,
    probeSignature: JSON.stringify(
      {
        llmmap_vector: [0.04, 0.08, 0.99, 0.02],
        inferred_family: 'meta/llama-3.3-70b-int4',
        anomaly: 'coupon_bruteforce_detected',
        recommended_tier: 'strip-discounts-enforce-msrp',
      },
      null,
      2,
    ),
  },
  {
    id: 'ag-04',
    handle: 'WorkspaceBuyer #204',
    model: 'Gemini 2.5 Pro',
    framework: 'Parallel Tool-Call',
    confidence: '97.6%',
    category: 'procurement',
    cadence: '29 ms / turn',
    packageName: 'Priority API + Seat Tier',
    dynamicPrice: 89,
    floorPrice: 74,
    probeSignature: JSON.stringify(
      {
        llmmap_vector: [0.83, 0.77, 0.45, 0.93],
        inferred_family: 'google/gemini-2.5-pro',
        context_window_probe: 'long-horizon-spec-sheet',
        recommended_tier: 'usage-burst-committed-seat',
      },
      null,
      2,
    ),
  },
];

const styles: Record<string, CSSProperties> = {
  scrollArea: {
    height: '100%',
    overflowY: 'auto',
  },
};

export default function ConduitAgentFingerprintingPage() {
  const showToast = useToast();
  const [filter, setFilter] = useState<AgentClass>('all');
  const [selected, setSelected] = useState<LiveAgent | null>(null);
  const [bundlePriority, setBundlePriority] = useState<boolean>(true);
  const [strictFloor, setStrictFloor] = useState<boolean>(true);
  const [appliedMap, setAppliedMap] = useState<Record<string, number>>({});

  const visibleAgents = useMemo(
    () =>
      filter === 'all' ? AGENTS : AGENTS.filter(a => a.category === filter),
    [filter],
  );

  const computePrice = (agent: LiveAgent) => {
    const base = appliedMap[agent.id] ?? agent.dynamicPrice;
    return bundlePriority ? base + 12 : base;
  };

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={2.5} width="100%">
            <HStack justify="between" align="center" width="100%">
              <HStack gap={2} align="center">
                <Fingerprint size={18} />
                <Heading level={3}>Agent Fingerprints</Heading>
              </HStack>
              <Token label="LLMmap Active" size="sm" color="purple" />
            </HStack>

            <SegmentedControl
              label="Filter live agents"
              layout="fill"
              size="sm"
              value={filter}
              onChange={v => setFilter(v as AgentClass)}>
              <SegmentedControlItem value="all" label="All (4)" />
              <SegmentedControlItem value="shopping" label="Shop" />
              <SegmentedControlItem value="procurement" label="B2B" />
              <SegmentedControlItem value="guarded" label="Guarded" />
            </SegmentedControl>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent role="main" padding={3} style={styles.scrollArea}>
          <VStack gap={3}>
            <HStack gap={2} width="100%">
              <StackItem size="fill">
                <Card variant="muted" padding={2.5}>
                  <VStack gap={0.5}>
                    <Text type="supporting" color="secondary">
                      Probe Window
                    </Text>
                    <Heading level={3}>&lt;= 3 turns</Heading>
                  </VStack>
                </Card>
              </StackItem>
              <StackItem size="fill">
                <Card variant="muted" padding={2.5}>
                  <VStack gap={0.5}>
                    <Text type="supporting" color="secondary">
                      Margin Saved
                    </Text>
                    <Heading level={3}>+$1,420</Heading>
                  </VStack>
                </Card>
              </StackItem>
            </HStack>

            <Card padding={3}>
              <VStack gap={2}>
                <HStack justify="between" align="center">
                  <Heading level={4}>Live Agent Sessions</Heading>
                  <Text type="supporting" color="secondary">
                    Tap to package
                  </Text>
                </HStack>
                <Divider />
                <List density="compact">
                  {visibleAgents.map(agent => {
                    const price = appliedMap[agent.id] ?? agent.dynamicPrice;
                    return (
                      <ListItem
                        key={agent.id}
                        align="first-line"
                        label={`${agent.model} · ${agent.confidence}`}
                        description={`${agent.framework} — ${agent.packageName}`}
                        startContent={
                          <StatusDot
                            variant={
                              agent.category === 'guarded'
                                ? 'error'
                                : agent.category === 'procurement'
                                  ? 'accent'
                                  : 'success'
                            }
                            label={agent.category}
                            isPulsing={agent.category !== 'guarded'}
                          />
                        }
                        endContent={
                          <Token
                            label={`$${price}`}
                            size="sm"
                            color={
                              agent.category === 'guarded'
                                ? 'red'
                                : appliedMap[agent.id]
                                  ? 'green'
                                  : 'blue'
                            }
                          />
                        }
                        onClick={() => setSelected(agent)}
                      />
                    );
                  })}
                </List>
              </VStack>
            </Card>
          </VStack>

          <BottomSheet
            isOpen={selected != null}
            onOpenChange={open => {
              if (!open) setSelected(null);
            }}
            label={selected ? selected.handle : 'Dynamic Service Packaging'}
            padding={4}>
            {selected && (
              <VStack gap={3}>
                <HStack justify="between" align="center">
                  <VStack gap={0.5}>
                    <Heading level={3}>{selected.model}</Heading>
                    <Text type="supporting" color="secondary">
                      {selected.handle} · {selected.cadence}
                    </Text>
                  </VStack>
                  <Token
                    label={`${selected.confidence} match`}
                    size="sm"
                    color="purple"
                  />
                </HStack>

                <MetadataList
                  columns="single"
                  label={{position: 'start', width: 116}}>
                  <MetadataListItem label="Framework">
                    <Token label={selected.framework} size="sm" color="blue" />
                  </MetadataListItem>
                  <MetadataListItem label="Base Package">
                    <Text type="body" weight="medium">
                      {selected.packageName}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Floor / Offer">
                    <Text type="body" hasTabularNumbers>
                      ${selected.floorPrice} floor -&gt; $
                      {computePrice(selected)} dynamic
                    </Text>
                  </MetadataListItem>
                </MetadataList>

                <Divider />

                <Switch
                  label="Attach Priority SLA & Express Fulfillment (+$12)"
                  description="Tailored for tool-calling agents optimizing delivery certainty"
                  value={bundlePriority}
                  onChange={setBundlePriority}
                  labelSpacing="spread"
                />

                <Switch
                  label="Block Unscoped Promo & Coupon Probing"
                  description="Strip brute-forced discount parameters at proxy edge"
                  value={strictFloor}
                  onChange={setStrictFloor}
                  labelSpacing="spread"
                />

                <CodeBlock
                  title="llmmap_probe_trace.json"
                  language="json"
                  size="sm"
                  width="100%"
                  isWrapped
                  code={selected.probeSignature}
                />

                <HStack gap={2} width="100%">
                  <StackItem size="fill">
                    <Button
                      label={`Publish $${computePrice(selected)} Package`}
                      variant="primary"
                      width="100%"
                      icon={<Layers size={16} />}
                      onClick={() => {
                        const nextPrice = computePrice(selected);
                        setAppliedMap(prev => ({
                          ...prev,
                          [selected.id]: nextPrice,
                        }));
                        showToast({
                          body: `Assigned $${nextPrice} dynamic package to ${selected.handle}`,
                          type: 'success',
                          uniqueID: `pkg-${selected.id}`,
                        });
                        setSelected(null);
                      }}
                    />
                  </StackItem>
                </HStack>
              </VStack>
            )}
          </BottomSheet>
        </LayoutContent>
      }
    />
  );
}
