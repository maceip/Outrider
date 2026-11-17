// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {type CSSProperties} from 'react';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
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

const styles: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  groupHeader: {
    padding: 'var(--spacing-2) var(--spacing-3)',
    backgroundColor: 'var(--color-background-muted)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  rows: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
};

function formatPhaseLabel(phase: DeliveryPhase, httpStatus: number | null): string {
  switch (phase) {
    case 'held_at_proxy':
      return 'Held at proxy';
    case 'awaiting_pass':
      return 'Awaiting pass';
    case 'delivered_modified':
      return `${httpStatus ?? 200} · Modified`;
    case 'pass_authorized':
      return `${httpStatus ?? 200} · Settled`;
    case 'delivered_original':
      return `${httpStatus ?? 200} · Delivered`;
    case 'observed_inbound':
    default:
      return `${httpStatus ?? 200}`;
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

  return (
    <div ref={containerRef} style={styles.root}>
      <div style={styles.groupHeader}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center">
              <Text type="label" color="secondary">
                Execution Trace
              </Text>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {filtered.length}
                {filtered.length !== events.length ? ` of ${events.length}` : ''}
              </Text>
            </HStack>
          </StackItem>
          {!isNarrow && (
            <Text type="supporting" color="secondary">
              Select a row to inspect frame
            </Text>
          )}
        </HStack>
      </div>

      <div style={styles.rows}>
        {filtered.length === 0 ? (
          <VStack padding={4}>
            <EmptyState
              title="No matching trace frames"
              description="Clear the active filter to see the full execution sequence."
              primaryAction={{
                label: 'Show all frames',
                onClick: onResetFilter,
              }}
              isCompact
            />
          </VStack>
        ) : (
          <List density="compact" hasDividers>
            {filtered.map(ev => {
              const isHeld = ev.deliveryPhase === 'held_at_proxy';
              const isPass = ev.deliveryPhase === 'awaiting_pass';
              const directionLabel =
                ev.direction === 'buyer_to_seller'
                  ? 'Buyer → Seller'
                  : ev.direction === 'buyer_to_gate'
                    ? 'Buyer → Gate'
                    : 'Seller → Buyer';
              const phaseLabel = formatPhaseLabel(
                ev.deliveryPhase,
                ev.httpStatus,
              );

              return (
                <div key={ev.id} data-testid={`trace-row-${ev.code}`}>
                  <ListItem
                    isSelected={ev.id === selectedEventId}
                    onClick={() => onSelectEvent(ev.id)}
                    startContent={
                      <StatusDot
                        variant={
                          isHeld
                            ? 'warning'
                            : isPass
                              ? 'accent'
                              : 'neutral'
                        }
                        isPulsing={isHeld}
                        label={phaseLabel}
                      />
                    }
                    label={`${ev.code} · ${ev.toolOrEndpoint}`}
                    description={`${ev.protocol} · ${directionLabel} · ${ev.observation}`}
                    endContent={
                      <HStack gap={3} vAlign="center">
                        {!isNarrow && (
                          <Text
                            type="code"
                            size="2xs"
                            color="secondary"
                            hasTabularNumbers>
                            {ev.durationLabel}
                          </Text>
                        )}
                        <Text
                          type="code"
                          size="2xs"
                          color={isHeld ? 'primary' : 'secondary'}
                          weight={isHeld ? 'semibold' : 'normal'}
                          hasTabularNumbers>
                          {phaseLabel}
                        </Text>
                      </HStack>
                    }
                  />
                </div>
              );
            })}
          </List>
        )}
      </div>
    </div>
  );
}
