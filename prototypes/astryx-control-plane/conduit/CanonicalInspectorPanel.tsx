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
  const [payloadReviewed, setPayloadReviewed] = useState(true);

  if (!event) {
    return (
      <VStack padding={4}>
        <EmptyState
          title="No frame selected"
          description="Select a node in the Causal Observatory or a row in the trace to inspect its wire frame and policy gates."
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
      ? 'Historical Quote Record'
      : isAwaitingPass
        ? 'Checkout Pass Gate'
        : 'Frame Details';

  const outboundOffers = isHistoricalModified
    ? (event.deliveredOffers ?? [])
    : [
        ...(event.upstreamOffers ?? []).filter(
          o => !(o.marginDelta < 0 && mutationOn && isFloorLeakReplacement),
        ),
        ...(mutationOn && event.stagedOffer ? [event.stagedOffer] : []),
      ];

  return (
    <div
      data-testid="canonical-inspector-panel"
      style={inBottomSheet ? styles.rootSheet : styles.root}>
      {/* Inspector Header — matches incident-console IncidentInspector */}
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

      {/* Scrollable Inspector Body — flat VStack + Divider + MetadataList + List (zero Cards, zero Badges) */}
      <div style={styles.scrollBody}>
        <VStack gap={4}>
          {isHeldQuote && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot
                  variant="warning"
                  isPulsing
                  label="Held at proxy"
                />
                <Text type="label">Held at proxy · Not delivered to buyer</Text>
              </HStack>
              <Text type="supporting" color="secondary">
                {event.sourceActor} returned {upstreamCount} offers. Conduit
                paused outbound delivery — {event.targetActor} has received 0
                offers so far.
              </Text>
            </VStack>
          )}

          {isHistoricalModified && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="success" label="Delivered" />
                <Text type="label">
                  Delivered at {event.deliveredAt ?? event.timestamp} ·
                  Historical record
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                Transmitted {event.deliveredOffers?.length ?? proposedCount}{' '}
                offers to {event.targetActor}. Wire payload is immutable and
                mutation controls are locked.
              </Text>
            </VStack>
          )}

          {event.deliveryPhase === 'delivered_original' && isOfferFrame && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="success" label="Delivered unmodified" />
                <Text type="label">
                  Delivered unmodified at {event.deliveredAt ?? event.timestamp}
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                Original seller response was forwarded directly to{' '}
                {event.targetActor} with zero proxy mutations.
              </Text>
            </VStack>
          )}

          {isAwaitingPass && (
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <StatusDot variant="accent" label="Checkout pass requested" />
                <Text type="label">
                  Checkout pass requested · 0 frames held in proxy
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                {event.sourceActor} selected an offer and is requesting a
                single-use capability pass ($
                {event.passRequest?.requestedCap ?? 0}.00 cap) before payment
                execution.
              </Text>
            </VStack>
          )}

          <Divider />

          <MetadataList columns="single" label={{position: 'start', width: 92}}>
            <MetadataListItem label="Direction">
              <Text type="body">
                {event.direction === 'seller_to_buyer'
                  ? 'Outbound response (Seller → Buyer)'
                  : event.direction === 'buyer_to_gate'
                    ? 'Pass gate (Buyer → Conduit)'
                    : 'Inbound request (Buyer → Seller)'}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Source">
              <Text type="code" size="2xs">
                {event.sourceActor}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Recipient">
              <Text type="code" size="2xs">
                {event.targetActor}
              </Text>
            </MetadataListItem>
            <MetadataListItem label="Tool / URI">
              <Text type="code" size="2xs">
                {event.toolOrEndpoint}
              </Text>
            </MetadataListItem>
            {event.proxyRuleId && (
              <MetadataListItem label="Rule gate">
                <Text type="code" size="2xs">
                  {event.proxyRuleId}
                </Text>
              </MetadataListItem>
            )}
          </MetadataList>

          {/* Offer Semantic Diff — Edge-to-edge List rows with Dividers */}
          {isOfferFrame && event.upstreamOffers && (
            <>
              <Divider />
              <VStack gap={3}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Heading level={5}>Offer Diff</Heading>
                  </StackItem>
                  <Text
                    type="supporting"
                    color="secondary"
                    hasTabularNumbers>
                    {isHistoricalModified
                      ? `${upstreamCount} observed → ${event.deliveredOffers?.length ?? proposedCount} delivered`
                      : `${upstreamCount} original → ${proposedCount} proposed`}
                  </Text>
                </HStack>

                <VStack gap={1}>
                  <Text type="label" color="secondary">
                    Observed from {session.merchantHost}
                  </Text>
                  <List density="compact" hasDividers>
                    {event.upstreamOffers.map(off => {
                      const violatesFloor = off.marginDelta < 0;
                      const replacedByRule =
                        violatesFloor && mutationOn && isFloorLeakReplacement;
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
                              ? `${off.perk} · -$${Math.abs(off.marginDelta)}.00 below $${session.marginFloorUsd} floor`
                              : off.perk
                          }
                          endContent={
                            <Text
                              type="code"
                              size="2xs"
                              hasTabularNumbers>
                              ${off.price}.00
                            </Text>
                          }
                        />
                      );
                    })}
                  </List>
                </VStack>

                {event.stagedOffer && (
                  <VStack gap={1.5}>
                    <Text type="label" color="secondary">
                      Protocol mutation (result.offers[])
                    </Text>
                    <Switch
                      width="100%"
                      labelSpacing="spread"
                      label={
                        isFloorLeakReplacement
                          ? `Replace O01 ($189.00) with ${event.stagedOffer.id} ($${event.stagedOffer.price}.00)`
                          : `Append ${event.stagedOffer.id} ($${event.stagedOffer.price}.00) to result.offers[]`
                      }
                      description={`${event.stagedOffer.label} · +$${event.stagedOffer.marginDelta}.00 above $${session.marginFloorUsd} SKU floor`}
                      value={mutationOn}
                      isDisabled={!isHeldQuote}
                      onChange={val => onToggleMutation(event.id, val)}
                      status={
                        !isHeldQuote
                          ? {
                              type: 'success',
                              message:
                                'Locked: response was already transmitted to buyer.',
                            }
                          : undefined
                      }
                    />
                  </VStack>
                )}

                <VStack gap={1}>
                  <Text type="label" color="secondary">
                    {isHistoricalModified
                      ? `Delivered to ${event.targetActor}`
                      : `Proposed outbound to ${event.targetActor}`}
                  </Text>
                  <List density="compact" hasDividers>
                    {outboundOffers.map(o => (
                      <ListItem
                        key={o.id}
                        label={`${o.id} · ${o.label}`}
                        description={
                          o.source === 'proxy_injected'
                            ? 'Added by Conduit rule'
                            : 'Upstream seller offer'
                        }
                        endContent={
                          <Text type="code" size="2xs" hasTabularNumbers>
                            ${o.price}.00
                          </Text>
                        }
                      />
                    ))}
                  </List>
                </VStack>
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
                    <Heading level={5}>Capability Pass Scope</Heading>
                  </StackItem>
                  <Text type="supporting" color="secondary">
                    Single-use · Ed25519
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
                  <MetadataListItem label="SPIFFE ID">
                    <Text type="code" size="2xs">
                      {event.passRequest.agentFingerprint}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    <Text type="code" size="2xs">
                      {event.passRequest.sku}
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Amount cap">
                    <Text type="body" hasTabularNumbers>
                      ${event.passRequest.requestedCap}.00 USD
                    </Text>
                  </MetadataListItem>
                  <MetadataListItem label="Pass TTL">
                    <Text type="body" hasTabularNumbers>
                      {event.passRequest.ttl}
                    </Text>
                  </MetadataListItem>
                </MetadataList>
              </VStack>
            </>
          )}

          {/* Policy & Schema Validation — List rows, zero Card */}
          {event.validations && event.validations.length > 0 && (
            <>
              <Divider />
              <VStack gap={2}>
                <Heading level={5}>Policy & Schema Validation</Heading>
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

          {/* Raw / Diff Wire Payload */}
          <Divider />
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <Heading level={5}>
                  {event.wireDiffJson && (mutationOn || isHistoricalModified)
                    ? 'JSON-RPC Payload Diff'
                    : `${event.protocol} Wire Payload`}
                </Heading>
              </StackItem>
              <Text type="supporting" color="secondary">
                → {event.targetActor}
              </Text>
            </HStack>

            {event.wireDiffJson && (mutationOn || isHistoricalModified) ? (
              <CodeBlock
                code={event.wireDiffJson}
                language="json"
                isDiff
                size="sm"
                width="100%"
                isWrapped
                maxHeight={220}
                title={`${event.code} · ${event.sourceActor} -> ${event.targetActor}`}
              />
            ) : (
              <CodeBlock
                code={event.rawOriginalJson}
                language="json"
                size="sm"
                width="100%"
                isWrapped
                maxHeight={220}
                title={`${event.code} · ${event.toolOrEndpoint}`}
              />
            )}
          </VStack>
        </VStack>
      </div>

      {/* Sticky Action Footer */}
      {(isOfferFrame || isAwaitingPass) && (
        <div style={styles.footer}>
          {isHeldQuote ? (
            <VStack gap={2}>
              <Switch
                width="100%"
                labelSpacing="spread"
                label={`Confirm target ${event.targetActor} & outbound payload`}
                value={payloadReviewed}
                onChange={setPayloadReviewed}
              />

              <HStack gap={2}>
                <Button
                  width="100%"
                  size="sm"
                  variant="primary"
                  label={
                    mutationOn
                      ? `Transmit modified (${proposedCount})`
                      : 'Enable mutation to transmit diff'
                  }
                  isDisabled={!mutationOn || !payloadReviewed}
                  tooltip={
                    !payloadReviewed
                      ? 'Confirm outbound payload and target recipient above before transmitting'
                      : !mutationOn
                        ? 'Protocol mutation rule is off — use Forward original or re-enable mutation'
                        : `Send ${proposedCount} validated offers to ${event.targetActor}`
                  }
                  onClick={() => onTransmitModified(event.id)}
                />
                <Button
                  width="100%"
                  size="sm"
                  variant="secondary"
                  label={`Forward original (${upstreamCount})`}
                  isDisabled={
                    Boolean(event.forwardOriginalBlockedReason) ||
                    !payloadReviewed
                  }
                  tooltip={
                    event.forwardOriginalBlockedReason ??
                    (!payloadReviewed
                      ? 'Confirm target recipient above before forwarding'
                      : `Forward unmodified upstream response (${upstreamCount} offers) to ${event.targetActor}`)
                  }
                  onClick={() => onForwardOriginal(event.id)}
                />
              </HStack>

              {event.forwardOriginalBlockedReason && (
                <Text type="supporting" color="secondary">
                  Forward original disabled: {event.forwardOriginalBlockedReason}
                </Text>
              )}
              {!payloadReviewed && (
                <Text type="supporting" color="secondary">
                  Confirm outbound message and recipient {event.targetActor} to
                  unlock transmission.
                </Text>
              )}
            </VStack>
          ) : isAwaitingPass ? (
            <HStack gap={2}>
              <Button
                width="100%"
                size="sm"
                variant="primary"
                label={`Issue pass ($${event.passRequest?.requestedCap ?? 0})`}
                onClick={() => onAuthorizePass(event.id)}
              />
              <Button
                width="100%"
                size="sm"
                variant="destructive"
                label="Reject checkout"
                onClick={() => onRejectPass(event.id)}
              />
            </HStack>
          ) : (
            <VStack gap={1.5}>
              <Button
                width="100%"
                size="sm"
                variant="secondary"
                isDisabled
                label="Response already delivered"
              />
              <Text type="supporting" color="secondary">
                {event.code} was delivered to {event.targetActor} at{' '}
                {event.deliveredAt ?? event.timestamp}. Use Reset scenario to
                replay live interception.
              </Text>
            </VStack>
          )}
        </div>
      )}
    </div>
  );
}
