// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState, type CSSProperties} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import type {
  CapabilityPassRecord,
  MerchantSession,
  TraceEvent,
} from './conduitState';

interface WireSurfaceProps {
  session: MerchantSession;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

const styles: Record<string, CSSProperties> = {
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

export function WireSurface({
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
    <div data-testid="wire-surface" style={styles.root}>
      <div style={styles.toolbar}>
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
        <div style={styles.splitBodyVertical}>
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
          <div style={styles.detailPane}>{detailContent}</div>
        </div>
      ) : (
        <div style={styles.splitBody}>
          <div style={styles.packetList}>
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

          <div style={{...styles.detailPane, width: detailSplit.size}}>
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
    <div data-testid="passes-surface" style={styles.root}>
      <div style={styles.toolbar}>
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
      <div style={styles.passesScroll}>
        {visible.length === 0 ? (
          <VStack padding={4}>
            <EmptyState
              title="No capability passes match filter"
              description="Switch to All to view every issued and pending checkout pass."
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  label="Show all passes"
                  onClick={() => setStatusFilter('all')}
                />
              }
              isCompact
            />
          </VStack>
        ) : (
          visible.map(pass => (
            <div key={pass.id} style={styles.passRow}>
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

                <MetadataList columns="multi">
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
