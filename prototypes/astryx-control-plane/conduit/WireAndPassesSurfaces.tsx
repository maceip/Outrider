// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState} from 'react';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Token} from '@astryxdesign/core/Token';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
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
        <HStack gap={2.5} vAlign="center">
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
        </HStack>
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
        <HStack gap={2.5} vAlign="center">
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
        </HStack>
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
