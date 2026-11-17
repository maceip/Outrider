// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * Conduit — Active Agent Fingerprinting & Dynamic Service Packaging (Mobile)
 *
 * Edge-to-edge list + bottom-sheet inspector following Astryx incident-console.
 */

import {useMemo, useState, type CSSProperties} from 'react';
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
  summaryBand: {
    padding: 'var(--spacing-3) var(--spacing-4)',
    backgroundColor: 'var(--color-background-muted)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
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
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <HStack gap={2} vAlign="center">
                  <Heading level={3}>Agent Fingerprints</Heading>
                  <Text type="supporting" color="secondary">
                    LLMmap · &lt;= 3 turns
                  </Text>
                </HStack>
              </StackItem>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                +$1,420 saved
              </Text>
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
        <LayoutContent role="main" padding={0}>
          <div style={styles.summaryBand}>
            <Text type="supporting" color="secondary">
              Select a session to inspect probe telemetry and calibrate outbound
              packaging.
            </Text>
          </div>
          <List density="compact" hasDividers>
            {visibleAgents.map(agent => {
              const price = appliedMap[agent.id] ?? agent.dynamicPrice;
              return (
                <ListItem
                  key={agent.id}
                  align="first-line"
                  label={`${agent.model} · ${agent.confidence}`}
                  description={`${agent.handle} · ${agent.framework} · ${agent.packageName}`}
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
                    />
                  }
                  endContent={
                    <Text type="code" size="2xs" hasTabularNumbers>
                      ${price}.00
                    </Text>
                  }
                  onClick={() => setSelected(agent)}
                />
              );
            })}
          </List>

          {selected && (
            <BottomSheet
              isOpen={Boolean(selected)}
              onOpenChange={open => {
                if (!open) setSelected(null);
              }}
              label={selected.handle}
              padding={4}>
              <VStack gap={3}>
                <VStack gap={0.5}>
                  <Text type="supporting" color="secondary">
                    {selected.handle} · {selected.cadence}
                  </Text>
                  <Heading level={4}>{selected.model}</Heading>
                </VStack>

                <MetadataList
                  columns="single"
                  label={{position: 'start', width: 96}}>
                  <MetadataListItem label="Framework">
                    <Text type="body">{selected.framework}</Text>
                  </MetadataListItem>
                  <MetadataListItem label="Confidence">
                    <Text type="body" hasTabularNumbers>
                      {selected.confidence}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="SKU floor">
                    <Text type="body" hasTabularNumbers>
                      ${selected.floorPrice}.00 USD
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Target quote">
                    <Text type="body" weight="semibold" hasTabularNumbers>
                      ${computePrice(selected)}.00 USD
                    </Text>
                  </MetadataListItem>
                </MetadataList>

                <Divider />

                <Switch
                  width="100%"
                  labelSpacing="spread"
                  label="Attach express SLA (+$12.00)"
                  value={bundlePriority}
                  onChange={setBundlePriority}
                />
                <Switch
                  width="100%"
                  labelSpacing="spread"
                  label="Enforce hard margin floor"
                  value={strictFloor}
                  onChange={setStrictFloor}
                />

                <CodeBlock
                  code={selected.probeSignature}
                  language="json"
                  size="sm"
                  width="100%"
                  isWrapped
                  title="LLMmap probe telemetry"
                />

                <Button
                  width="100%"
                  size="sm"
                  label={`Apply $${computePrice(selected)}.00 package`}
                  onClick={() => {
                    const next = computePrice(selected);
                    setAppliedMap(prev => ({...prev, [selected.id]: next}));
                    showToast({
                      body: `Updated ${selected.handle} package to $${next}.00`,
                      uniqueID: `pkg-${selected.id}`,
                    });
                    setSelected(null);
                  }}
                />
              </VStack>
            </BottomSheet>
          )}
        </LayoutContent>
      }
    />
  );
}
