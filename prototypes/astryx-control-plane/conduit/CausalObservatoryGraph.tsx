// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {type CSSProperties} from 'react';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import type {MerchantSession, TraceEvent} from './conduitState';

interface CausalObservatoryGraphProps {
  session: MerchantSession;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  expanded?: boolean;
}

const styles: Record<string, CSSProperties> = {
  root: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-body)',
    overflow: 'hidden',
  },
  headerBar: {
    padding: 'var(--spacing-2) var(--spacing-3)',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  canvas: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: 'var(--spacing-3)',
  },
  selectedRing: {
    borderRadius: 'var(--radius-container)',
    outline: '1.5px solid var(--color-border-emphasized)',
    outlineOffset: -1,
  },
  unreachedNode: {
    borderRadius: 'var(--radius-container)',
    border: 'var(--border-width) dashed var(--color-border)',
    padding: 'var(--spacing-3)',
    opacity: 0.72,
  },
  summaryBar: {
    padding: 'var(--spacing-2) var(--spacing-3)',
    borderRadius: 'var(--radius-element)',
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
  },
};

function getNodeStatusText(ev: TraceEvent): string {
  switch (ev.deliveryPhase) {
    case 'held_at_proxy':
      return 'Held';
    case 'awaiting_pass':
      return 'Awaiting pass';
    case 'delivered_modified':
      return 'Counter-offer';
    case 'pass_authorized':
      return 'Settled';
    case 'delivered_original':
    case 'observed_inbound':
    default:
      return `${ev.httpStatus ?? 200}`;
  }
}

export function CausalObservatoryGraph({
  session,
  selectedEventId,
  onSelectEvent,
  expanded = false,
}: CausalObservatoryGraphProps) {
  const offerEvent = session.events.find(
    e =>
      (e.upstreamOffers && e.upstreamOffers.length > 0) ||
      (e.deliveredOffers && e.deliveredOffers.length > 0),
  );
  const heldR02 = session.events.find(
    e => e.deliveryPhase === 'held_at_proxy',
  );
  const awaitingPassEvt = session.events.find(
    e => e.deliveryPhase === 'awaiting_pass',
  );

  const upstreamSummary = (offerEvent?.upstreamOffers ?? [])
    .map(o => `${o.id} $${o.price}`)
    .join(', ');

  const stagedSummary = offerEvent?.stagedOffer
    ? offerEvent.deliveryPhase === 'delivered_modified'
      ? `Delivered +${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price}`
      : offerEvent.mutationEnabled !== false
        ? `Staged +${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price}`
        : `${offerEvent.stagedOffer.id} off`
    : null;

  return (
    <div style={styles.root}>
      <div style={styles.headerBar}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="label" color="secondary">
                Causal Observatory
              </Text>
              <Text type="supporting" color="secondary">
                {session.buyerAgentId} → Conduit → {session.merchantHost}
              </Text>
            </HStack>
          </StackItem>
          <HStack gap={1.5} vAlign="center">
            <StatusDot
              variant={
                heldR02
                  ? 'warning'
                  : awaitingPassEvt
                    ? 'accent'
                    : 'success'
              }
              isPulsing={Boolean(heldR02)}
              label={
                heldR02
                  ? 'Quote held before delivery'
                  : awaitingPassEvt
                    ? 'Awaiting checkout pass'
                    : 'Synchronized'
              }
            />
            <Text type="supporting" color="secondary">
              {heldR02
                ? 'Quote held (0 delivered)'
                : awaitingPassEvt
                  ? 'Awaiting pass'
                  : 'Synchronized'}
            </Text>
          </HStack>
        </HStack>
      </div>

      <div style={styles.canvas}>
        <VStack gap={3}>
          <Grid
            columns={{minWidth: expanded ? 220 : 176, max: 5, repeat: 'fit'}}
            gap={2}>
            {session.events.map(ev => {
              const isSelected = ev.id === selectedEventId;
              const isHeld = ev.deliveryPhase === 'held_at_proxy';
              const isPassGate = ev.deliveryPhase === 'awaiting_pass';
              const statusText = getNodeStatusText(ev);

              return (
                <div
                  key={ev.id}
                  data-testid={`graph-node-${ev.code}`}
                  style={isSelected ? styles.selectedRing : undefined}>
                  <ClickableCard
                    variant={isSelected ? 'muted' : 'default'}
                    padding={expanded ? 3 : 2}
                    height="100%"
                    label={`Inspect ${ev.code} ${ev.title}`}
                    onClick={() => onSelectEvent(ev.id)}>
                    <VStack gap={1.5}>
                      <HStack gap={1.5} vAlign="center">
                        <StackItem size="fill">
                          <HStack gap={1.5} vAlign="center">
                            {(isHeld || isPassGate) && (
                              <StatusDot
                                variant={isHeld ? 'warning' : 'accent'}
                                isPulsing={isHeld}
                                label={statusText}
                              />
                            )}
                            <Text
                              type="code"
                              size="2xs"
                              weight="semibold"
                              hasTabularNumbers>
                              {ev.code}
                            </Text>
                          </HStack>
                        </StackItem>
                        <Text
                          type="code"
                          size="2xs"
                          color={isHeld ? 'primary' : 'secondary'}
                          weight={isHeld ? 'semibold' : 'normal'}
                          hasTabularNumbers>
                          {statusText}
                        </Text>
                      </HStack>

                      <VStack gap={0.5}>
                        <Text
                          type="label"
                          weight="semibold"
                          maxLines={1}>
                          {ev.title}
                        </Text>
                        <Text
                          type="supporting"
                          size="2xs"
                          color="secondary"
                          maxLines={expanded ? 3 : 2}>
                          {ev.observation}
                        </Text>
                      </VStack>

                      <Divider />

                      <HStack gap={2} vAlign="center">
                        <StackItem size="fill">
                          <Text type="supporting" size="3xs" color="secondary">
                            {ev.direction === 'buyer_to_seller'
                              ? 'Buyer → Seller'
                              : ev.direction === 'buyer_to_gate'
                                ? 'Buyer → Conduit'
                                : 'Seller → Buyer'}
                          </Text>
                        </StackItem>
                        <Text
                          type="code"
                          size="3xs"
                          color="secondary"
                          hasTabularNumbers>
                          {ev.durationLabel}
                        </Text>
                      </HStack>
                    </VStack>
                  </ClickableCard>
                </div>
              );
            })}

            {heldR02 && (
              <div
                data-testid="graph-node-unreached-downstream"
                style={styles.unreachedNode}>
                <VStack gap={1.5}>
                  <HStack gap={2} vAlign="center">
                    <StackItem size="fill">
                      <Text type="label" color="secondary">
                        Select Offer
                      </Text>
                    </StackItem>
                    <Text type="supporting" size="2xs" color="secondary">
                      Waiting
                    </Text>
                  </HStack>
                  <Text
                    type="supporting"
                    size="2xs"
                    color="secondary"
                    maxLines={3}>
                    {session.buyerAgentId} has 0 offers until {heldR02.code} is
                    released.
                  </Text>
                </VStack>
              </div>
            )}
          </Grid>

          {offerEvent && (
            <div style={styles.summaryBar}>
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <Text
                    type="supporting"
                    color="secondary"
                    hasTabularNumbers>
                    Floor ${session.marginFloorUsd} · Seller: {upstreamSummary}
                    {stagedSummary ? ` · ${stagedSummary}` : ''}
                  </Text>
                </StackItem>
                <Text
                  type="supporting"
                  color="secondary"
                  hasTabularNumbers>
                  {offerEvent.deliveryPhase === 'held_at_proxy'
                    ? `${offerEvent.upstreamOffers?.length ?? 2} seller → ${
                        offerEvent.mutationEnabled !== false
                          ? offerEvent.forwardOriginalBlockedReason
                            ? (offerEvent.upstreamOffers?.length ?? 2)
                            : (offerEvent.upstreamOffers?.length ?? 2) + 1
                          : (offerEvent.upstreamOffers?.length ?? 2)
                      } outbound`
                    : offerEvent.deliveryPhase === 'delivered_modified'
                      ? `${offerEvent.deliveredOffers?.length ?? 3} delivered`
                      : 'Delivered unmodified'}
                </Text>
              </HStack>
            </div>
          )}

          {expanded && (
            <div style={styles.summaryBar}>
              <MetadataList columns="multi">
                <MetadataListItem label="Buyer agent">
                  <Text type="body">
                    {session.buyerAgentId} · {session.buyerModel} (
                    {session.agentConfidence})
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Traffic posture">
                  <Text type="body">{session.trafficProfile}</Text>
                </MetadataListItem>
                <MetadataListItem label="Unit economics">
                  <Text type="body" hasTabularNumbers>
                    {session.skuCode} · Floor ${session.marginFloorUsd}.00 /
                    MSRP ${session.msrpUsd}.00
                  </Text>
                </MetadataListItem>
              </MetadataList>
            </div>
          )}
        </VStack>
      </div>
    </div>
  );
}
