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
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import type {MerchantSession, TraceEvent} from './conduitState';

interface CanonicalInspectorPanelProps {
  session: MerchantSession;
  event: TraceEvent | null;
  inBottomSheet?: boolean;
  onToggleMutation: (eventId: string, nextEnabled: boolean) => void;
  onTransmitModified: (eventId: string) => void;
  onForwardOriginal: (eventId: string) => void;
  onAuthorizePass: (eventId: string) => void;
  onRejectPass: (eventId: string) => void;
  onClose: () => void;
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
  rootSheet: {
    height: '76dvh',
    maxHeight: '76dvh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-surface)',
    overflow: 'hidden',
  },
  header: {
    padding: 'var(--spacing-3) var(--spacing-4)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  scrollBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 'var(--spacing-4)',
  },
  footer: {
    padding: 'var(--spacing-3) var(--spacing-4)',
    borderTop: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
    flexShrink: 0,
  },
};

export function CanonicalInspectorPanel({
  session,
  event,
  inBottomSheet = false,
  onToggleMutation,
  onTransmitModified,
  onForwardOriginal,
  onAuthorizePass,
  onRejectPass,
  onClose,
}: CanonicalInspectorPanelProps) {
  const [showWireJson, setShowWireJson] = useState(false);

  if (!event) {
    return (
      <VStack padding={4}>
        <EmptyState
          title="No frame selected"
          description="Select a node in the Causal Observatory or a row in the trace to inspect its payload and policy gates."
          isCompact
        />
      </VStack>
    );
  }

  const isHeldQuote = event.deliveryPhase === 'held_at_proxy';
  const isHistoricalModified = event.deliveryPhase === 'delivered_modified';
  const isOfferFrame =
    Boolean(event.upstreamOffers && event.upstreamOffers.length > 0) ||
    isHeldQuote ||
    isHistoricalModified;
  const isAwaitingPass = event.deliveryPhase === 'awaiting_pass';
  const isSettledOrder =
    event.deliveryPhase === 'pass_authorized' && event.code === 'C05';

  const upstreamCount = event.upstreamOffers?.length ?? 0;
  const mutationOn = event.mutationEnabled !== false;
  const isFloorLeakReplacement = Boolean(event.forwardOriginalBlockedReason);
  const proposedCount = mutationOn
    ? isFloorLeakReplacement
      ? upstreamCount
      : upstreamCount + 1
    : upstreamCount;

  const panelTitle = isHeldQuote
    ? 'Quote Approval'
    : isHistoricalModified
      ? 'Delivered Quote Record'
      : isAwaitingPass
        ? 'Checkout Pass Gate'
        : isSettledOrder
          ? 'Settled Order'
          : event.title;

  const shouldShowCodeExpanded =
    showWireJson || (!isOfferFrame && !isAwaitingPass && !isSettledOrder);

  return (
    <div
      data-testid="canonical-inspector-panel"
      style={inBottomSheet ? styles.rootSheet : styles.root}>
      {/* Inspector Header */}
      <div style={styles.header}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <VStack gap={0.5}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot
                  variant={
                    isHeldQuote
                      ? 'warning'
                      : isAwaitingPass
                        ? 'accent'
                        : isSettledOrder || isHistoricalModified
                          ? 'success'
                          : 'neutral'
                  }
                  isPulsing={isHeldQuote}
                  label={panelTitle}
                />
                <Text type="supporting" color="secondary">
                  {event.code} · {event.protocol}
                </Text>
              </HStack>
              <Heading level={4}>{panelTitle}</Heading>
            </VStack>
          </StackItem>
          <Button
            size="sm"
            variant="ghost"
            label="Close"
            onClick={onClose}
          />
        </HStack>
      </div>

      {/* Scrollable Inspector Body */}
      <div style={styles.scrollBody}>
        <VStack gap={4}>
          {isHeldQuote && (
            <VStack gap={1}>
              <Text type="label">
                Paused before delivery to {event.targetActor}
              </Text>
              <Text type="supporting" color="secondary">
                {session.merchantName} returned {upstreamCount} offers.{' '}
                {event.targetActor} has received 0 offers until you approve
                below.
              </Text>
            </VStack>
          )}

          {isHistoricalModified && (
            <VStack gap={1}>
              <Text type="label">
                Delivered at {event.deliveredAt ?? event.timestamp}
              </Text>
              <Text type="supporting" color="secondary">
                Sent {event.deliveredOffers?.length ?? proposedCount} offers to{' '}
                {event.targetActor}. Delivered wire frames are immutable.
              </Text>
            </VStack>
          )}

          {event.deliveryPhase === 'delivered_original' && isOfferFrame && (
            <VStack gap={1}>
              <Text type="label">
                Forwarded unmodified at {event.deliveredAt ?? event.timestamp}
              </Text>
              <Text type="supporting" color="secondary">
                Original seller offers cleared your ${session.marginFloorUsd}{' '}
                floor and passed straight to {event.targetActor}.
              </Text>
            </VStack>
          )}

          {isAwaitingPass && (
            <VStack gap={1}>
              <Text type="label">
                Single-use pass requested (${event.passRequest?.requestedCap ?? 0}.00 cap)
              </Text>
              <Text type="supporting" color="secondary">
                {event.sourceActor} locked {session.skuName} in cart and awaits
                a single-use Ed25519 pass to complete payment.
              </Text>
            </VStack>
          )}

          {isSettledOrder && (
            <VStack gap={1}>
              <Text type="label">Order settled &amp; pass consumed</Text>
              <Text type="supporting" color="secondary">
                {event.observation}
              </Text>
            </VStack>
          )}

          {/* Unified Outbound Quote List + Counter-Offer Switch (Zero Duplicate Lists) */}
          {isOfferFrame && event.upstreamOffers && (
            <>
              <Divider />
              <VStack gap={3}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Heading level={5}>
                      Offers for {event.targetActor}
                    </Heading>
                  </StackItem>
                  <Text
                    type="supporting"
                    color="secondary"
                    hasTabularNumbers>
                    Floor ${session.marginFloorUsd}
                  </Text>
                </HStack>

                <List density="compact" hasDividers>
                  {event.upstreamOffers.map(off => {
                    const violatesFloor = off.marginDelta < 0;
                    const replacedByRule =
                      violatesFloor &&
                      (isHistoricalModified ||
                        (mutationOn && isFloorLeakReplacement));
                    return (
                      <ListItem
                        key={off.id}
                        startContent={
                          violatesFloor ? (
                            <StatusDot
                              variant="error"
                              label="Below margin floor"
                            />
                          ) : undefined
                        }
                        label={
                          <Text
                            type="body"
                            hasStrikethrough={replacedByRule}>
                            {off.id} · {off.label}
                          </Text>
                        }
                        description={
                          violatesFloor
                            ? `$${Math.abs(off.marginDelta)} below $${session.marginFloorUsd} floor`
                            : off.perk
                        }
                        endContent={
                          <Text type="code" size="2xs" hasTabularNumbers>
                            ${off.price}.00
                          </Text>
                        }
                      />
                    );
                  })}

                  {event.stagedOffer &&
                    (isHistoricalModified || mutationOn) && (
                      <ListItem
                        key={event.stagedOffer.id}
                        startContent={
                          <StatusDot
                            variant="success"
                            label="Conduit counter-offer"
                          />
                        }
                        label={`${event.stagedOffer.id} · ${event.stagedOffer.label}`}
                        description={`Conduit counter-offer · +$${event.stagedOffer.marginDelta} above $${session.marginFloorUsd} floor`}
                        endContent={
                          <Text
                            type="code"
                            size="2xs"
                            weight="semibold"
                            hasTabularNumbers>
                            ${event.stagedOffer.price}.00
                          </Text>
                        }
                      />
                    )}
                </List>

                {event.stagedOffer && isHeldQuote && (
                  <Switch
                    width="100%"
                    labelSpacing="spread"
                    label={
                      isFloorLeakReplacement
                        ? `Replace $189 leak with $${event.stagedOffer.price} offer (${event.stagedOffer.id})`
                        : `Include $${event.stagedOffer.price} counter-offer (${event.stagedOffer.id})`
                    }
                    description={`${event.stagedOffer.perk} · +$${event.stagedOffer.marginDelta} above $${session.marginFloorUsd} floor`}
                    value={mutationOn}
                    onChange={val => onToggleMutation(event.id, val)}
                  />
                )}
              </VStack>
            </>
          )}

          {/* Checkout Pass Scope */}
          {isAwaitingPass && event.passRequest && (
            <>
              <Divider />
              <VStack gap={2}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Heading level={5}>Pass Scope</Heading>
                  </StackItem>
                  <Text type="supporting" color="secondary">
                    1 call · Ed25519
                  </Text>
                </HStack>
                <MetadataList
                  columns="single"
                  label={{position: 'start', width: 92}}>
                  <MetadataListItem label="Buyer agent">
                    <Text type="code" size="2xs">
                      {event.sourceActor}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    <Text type="code" size="2xs">
                      {event.passRequest.sku}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Spend cap">
                    <Text type="body" hasTabularNumbers>
                      ${event.passRequest.requestedCap}.00 USD
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Expires in">
                    <Text type="body" hasTabularNumbers>
                      {event.passRequest.ttl}
                    </Text>
                  </MetadataListItem>
                </MetadataList>
              </VStack>
            </>
          )}

          {/* Policy & Schema Validation Gates */}
          {event.validations && event.validations.length > 0 && (
            <>
              <Divider />
              <VStack gap={2}>
                <Heading level={5}>Policy Checks</Heading>
                <List density="compact" hasDividers>
                  {event.validations.map(v => (
                    <ListItem
                      key={v.id}
                      align="first-line"
                      startContent={
                        <StatusDot
                          variant={
                            v.status === 'pass'
                              ? 'success'
                              : v.status === 'warn'
                                ? 'warning'
                                : 'error'
                          }
                          label={v.gate}
                        />
                      }
                      label={v.gate}
                      description={v.detail}
                    />
                  ))}
                </List>
              </VStack>
            </>
          )}

          {/* Compact Route Metadata + On-Demand Wire JSON */}
          <Divider />
          <VStack gap={2}>
            <MetadataList columns="single" label={{position: 'start', width: 88}}>
              <MetadataListItem label="Route">
                <Text type="code" size="2xs">
                  {event.sourceActor} → {event.targetActor}
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Endpoint">
                <Text type="code" size="2xs">
                  {event.toolOrEndpoint}
                </Text>
              </MetadataListItem>
            </MetadataList>

            {(isOfferFrame || isAwaitingPass || isSettledOrder) && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  label={
                    showWireJson
                      ? 'Hide wire JSON'
                      : event.wireDiffJson && (mutationOn || isHistoricalModified)
                        ? 'View wire JSON diff'
                        : 'View wire JSON'
                  }
                  onClick={() => setShowWireJson(v => !v)}
                />
              </div>
            )}

            {shouldShowCodeExpanded &&
              (event.wireDiffJson && (mutationOn || isHistoricalModified) ? (
                <CodeBlock
                  code={event.wireDiffJson}
                  language="json"
                  isDiff
                  size="sm"
                  width="100%"
                  isWrapped
                  maxHeight={200}
                  title={`${event.code} · ${event.sourceActor} -> ${event.targetActor}`}
                />
              ) : (
                <CodeBlock
                  code={event.rawOriginalJson}
                  language="json"
                  size="sm"
                  width="100%"
                  isWrapped
                  maxHeight={200}
                  title={`${event.code} · ${event.toolOrEndpoint}`}
                />
              ))}
          </VStack>
        </VStack>
      </div>

      {/* Single-Click Action Footer (Zero 2-Switch Confirmation Trap) */}
      {(isHeldQuote || isAwaitingPass) && (
        <div style={styles.footer}>
          {isHeldQuote ? (
            <VStack gap={2}>
              {mutationOn ? (
                <HStack gap={2}>
                  <Button
                    width="100%"
                    size="sm"
                    variant="primary"
                    label={`Send $${event.stagedOffer?.price ?? 209} Offer (${proposedCount})`}
                    onClick={() => onTransmitModified(event.id)}
                  />
                  <Button
                    width="100%"
                    size="sm"
                    variant="secondary"
                    label={`Forward Original (${upstreamCount})`}
                    isDisabled={Boolean(event.forwardOriginalBlockedReason)}
                    tooltip={event.forwardOriginalBlockedReason}
                    onClick={() => onForwardOriginal(event.id)}
                  />
                </HStack>
              ) : isFloorLeakReplacement ? (
                <Button
                  width="100%"
                  size="sm"
                  variant="primary"
                  label={`Enable $${event.stagedOffer?.price ?? 209} Replacement`}
                  onClick={() => onToggleMutation(event.id, true)}
                />
              ) : (
                <HStack gap={2}>
                  <Button
                    width="100%"
                    size="sm"
                    variant="primary"
                    label={`Forward Original (${upstreamCount})`}
                    onClick={() => onForwardOriginal(event.id)}
                  />
                  <Button
                    width="100%"
                    size="sm"
                    variant="secondary"
                    label={`Add $${event.stagedOffer?.price ?? 209} Offer`}
                    onClick={() => onToggleMutation(event.id, true)}
                  />
                </HStack>
              )}

              {event.forwardOriginalBlockedReason && (
                <Text type="supporting" color="secondary">
                  {event.forwardOriginalBlockedReason}
                </Text>
              )}
            </VStack>
          ) : (
            <HStack gap={2}>
              <Button
                width="100%"
                size="sm"
                variant="primary"
                label={`Issue Pass ($${event.passRequest?.requestedCap ?? 0})`}
                onClick={() => onAuthorizePass(event.id)}
              />
              <Button
                width="100%"
                size="sm"
                variant="destructive"
                label="Reject Checkout"
                onClick={() => onRejectPass(event.id)}
              />
            </HStack>
          )}
        </div>
      )}
    </div>
  );
}
