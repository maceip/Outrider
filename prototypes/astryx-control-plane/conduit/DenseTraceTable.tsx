// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React from 'react';
import {HStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import type {
  DeliveryPhase,
  TraceEvent,
  TraceFilterId,
} from './conduitState';

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
