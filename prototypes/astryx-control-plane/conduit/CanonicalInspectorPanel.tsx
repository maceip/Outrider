// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState} from 'react';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Token} from '@astryxdesign/core/Token';
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
      <div style={{padding: 16}}>
        <VStack gap={3}>
          <HStack hAlign="between" vAlign="center">
            <Heading level={5}>Frame Inspector</Heading>
            <Button
              size="sm"
              variant="ghost"
              label="Collapse"
              onClick={onClose}
            />
          </HStack>
          <Text type="supporting" size="xs">
            Select any node in the Causal Observatory or row in the trace to
            inspect its wire frame and policy gates.
          </Text>
        </VStack>
      </div>
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

  // Panel Title adapts cleanly to operator task
  const panelTitle = isHeldQuote
    ? `Quote Approval · ${event.code}`
    : isHistoricalModified
      ? `Historical Quote Record · ${event.code}`
      : isAwaitingPass
        ? `Checkout Pass Gate · ${event.code}`
        : `Frame Inspection · ${event.code}`;

  return (
    <div
      data-testid="canonical-inspector-panel"
      style={{
        height: inBottomSheet ? '76dvh' : '100%',
        maxHeight: inBottomSheet ? '76dvh' : undefined,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-background-surface)',
        overflow: 'hidden',
      }}>
      {/* Sticky Canonical Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}>
        <HStack gap={2} vAlign="center">
          <Heading level={5}>{panelTitle}</Heading>
          <Badge
            variant={
              isHeldQuote
                ? 'warning'
                : isAwaitingPass
                  ? 'purple'
                  : isHistoricalModified
                    ? 'info'
                    : 'neutral'
            }
            label={event.protocol}
          />
        </HStack>
        <Button
          size="sm"
          variant="ghost"
          label="Hide panel"
          tooltip="Collapse right panel to give 100% width to the Observatory"
          onClick={onClose}
        />
      </div>

      {/* Scrollable Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '12px 14px',
        }}>
        <VStack gap={3}>
          {/* 1. EXPLICIT DELIVERY STATE BANNER (Fixes #01 P0 & #04 P1) */}
          {isHeldQuote && (
            <Banner
              status="warning"
              container="card"
              collapsible={false}
              title="HELD AT PROXY · NOT DELIVERED TO BUYER"
              description={`${event.sourceActor} returned ${upstreamCount} offers. Conduit paused outbound delivery — ${event.targetActor} has received 0 offers so far.`}
            />
          )}

          {isHistoricalModified && (
            <Banner
              status="info"
              container="card"
              collapsible={false}
              title={`DELIVERED AT ${event.deliveredAt ?? event.timestamp} · HISTORICAL RECORD`}
              description={`Transmitted ${event.deliveredOffers?.length ?? proposedCount} offers to ${event.targetActor}. Wire payload is now immutable; mutation controls are locked.`}
            />
          )}

          {event.deliveryPhase === 'delivered_original' && (
            <Banner
              status="success"
              container="card"
              collapsible={false}
              title={`DELIVERED UNMODIFIED AT ${event.deliveredAt ?? event.timestamp}`}
              description={`Original seller response was forwarded directly to ${event.targetActor} with zero proxy mutations.`}
            />
          )}

          {isAwaitingPass && (
            <Banner
              status="info"
              container="card"
              collapsible={false}
              title="CHECKOUT PASS REQUESTED · 0 FRAMES HELD IN PROXY"
              description={`${event.sourceActor} selected an offer and is requesting a single-use capability pass ($${event.passRequest?.requestedCap ?? 0}.00 cap) before payment execution.`}
            />
          )}

          {/* 2. DEFINED DIRECTION, SOURCE, PROXY RULE, TARGET RECIPIENT */}
          <Card variant="muted" padding={3}>
            <VStack gap={2}>
              <Text type="label" size="2xs" weight="semibold">
                ROUTE & ENVELOPE METADATA
              </Text>
              <MetadataList size="sm">
                <MetadataListItem label="Direction">
                  {event.direction === 'seller_to_buyer'
                    ? 'Outbound MCP Response (Seller → Buyer)'
                    : event.direction === 'buyer_to_gate'
                      ? 'Pass Authority Gate (Buyer → Conduit)'
                      : 'Inbound Request (Buyer → Seller)'}
                </MetadataListItem>
                <MetadataListItem label="Source">
                  {event.sourceActor}
                </MetadataListItem>
                <MetadataListItem label="Recipient">
                  {event.targetActor}
                </MetadataListItem>
                <MetadataListItem label="Tool / URI">
                  {event.toolOrEndpoint}
                </MetadataListItem>
                {event.proxyRuleId && (
                  <MetadataListItem label="Rule Gate">
                    {event.proxyRuleId}
                  </MetadataListItem>
                )}
              </MetadataList>
            </VStack>
          </Card>

          {/* 3. QUOTE APPROVAL / OFFER SEMANTIC DIFF SURFACE */}
          {isOfferFrame && event.upstreamOffers && (
            <>
              <Card padding={3}>
                <VStack gap={2.5}>
                  <HStack hAlign="between" vAlign="center" wrap>
                    <Text type="label" size="xs" weight="semibold">
                      Semantic Offer Diff
                    </Text>
                    <Badge
                      variant={
                        isHeldQuote
                          ? mutationOn
                            ? 'warning'
                            : 'neutral'
                          : 'info'
                      }
                      label={
                        isHistoricalModified
                          ? `${upstreamCount} upstream → ${event.deliveredOffers?.length ?? proposedCount} delivered`
                          : isFloorLeakReplacement && mutationOn
                            ? `${upstreamCount} upstream ($189 leak) → ${proposedCount} compliant`
                            : `${upstreamCount} original offers → ${proposedCount} proposed offers`
                      }
                    />
                  </HStack>

                  {/* Observed Original Upstream Offers */}
                  <VStack gap={1}>
                    <Text type="supporting" size="2xs" weight="semibold">
                      1. OBSERVED ORIGINAL ({upstreamCount} from{' '}
                      {session.merchantHost})
                    </Text>
                    {event.upstreamOffers.map(off => {
                      const violatesFloor = off.marginDelta < 0;
                      const replacedByRule =
                        violatesFloor && mutationOn && isFloorLeakReplacement;
                      return (
                        <div
                          key={off.id}
                          style={{
                            padding: '6px 9px',
                            borderRadius: 7,
                            border: violatesFloor
                              ? '1px solid #ef4444'
                              : '1px solid var(--color-border-default)',
                            backgroundColor:
                              'var(--color-background-subtle, var(--color-background-surface))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            opacity: replacedByRule ? 0.65 : 1,
                          }}>
                          <div style={{minWidth: 0}}>
                            <Text
                              type="body"
                              size="xs"
                              weight="medium"
                              hasStrikethrough={replacedByRule}>
                              {off.id} · {off.label}
                            </Text>
                            <Text type="supporting" size="2xs" maxLines={1}>
                              {off.perk}
                            </Text>
                          </div>
                          <HStack gap={1.5} vAlign="center">
                            <Token
                              size="sm"
                              color={violatesFloor ? 'red' : 'gray'}
                              label={`$${off.price}.00`}
                            />
                          </HStack>
                        </div>
                      );
                    })}
                  </VStack>

                  <Divider />

                  {/* Explicit JSON-RPC Protocol Modification Rule (Fixes #04 P1 — not a mystery promo toggle!) */}
                  {event.stagedOffer && (
                    <VStack gap={1.5}>
                      <Text type="supporting" size="2xs" weight="semibold">
                        2. PROTOCOL FRAME MUTATION (`result.offers[]`)
                      </Text>
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          border:
                            mutationOn && isHeldQuote
                              ? '1px solid var(--color-interactive-primary, #2563eb)'
                              : '1px solid var(--color-border-default)',
                          backgroundColor:
                            mutationOn && isHeldQuote
                              ? 'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 6%, var(--color-background-surface))'
                              : 'transparent',
                        }}>
                        <Switch
                          width="100%"
                          labelSpacing="spread"
                          label={
                            isFloorLeakReplacement
                              ? `Replace O01 ($189) with ${event.stagedOffer.id} ($${event.stagedOffer.price}.00)`
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
                      </div>
                    </VStack>
                  )}

                  {/* Resulting Outbound Offer Set */}
                  <VStack gap={1}>
                    <Text type="supporting" size="2xs" weight="semibold">
                      {isHistoricalModified
                        ? `3. DELIVERED RESPONSE (${event.deliveredOffers?.length ?? proposedCount} offers received by ${event.targetActor})`
                        : `3. PROPOSED OUTBOUND PAYLOAD (${proposedCount} offers -> ${event.targetActor})`}
                    </Text>
                    <HStack gap={1.5} wrap>
                      {(isHistoricalModified
                        ? (event.deliveredOffers ?? [])
                        : [
                            ...event.upstreamOffers.filter(
                              o =>
                                !(
                                  o.marginDelta < 0 &&
                                  mutationOn &&
                                  isFloorLeakReplacement
                                ),
                            ),
                            ...(mutationOn && event.stagedOffer
                              ? [event.stagedOffer]
                              : []),
                          ]
                      ).map(o => (
                        <Token
                          key={o.id}
                          size="sm"
                          color={
                            o.source === 'proxy_injected'
                              ? 'green'
                              : o.marginDelta < 0
                                ? 'red'
                                : 'blue'
                          }
                          label={`${o.id}: $${o.price}.00${o.source === 'proxy_injected' ? ' (+injected)' : ''}`}
                        />
                      ))}
                    </HStack>
                  </VStack>
                </VStack>
              </Card>
            </>
          )}

          {/* 4. CHECKOUT PASS GATE SURFACE (when session/event awaits capability pass) */}
          {isAwaitingPass && event.passRequest && (
            <Card padding={3}>
              <VStack gap={2.5}>
                <HStack hAlign="between" vAlign="center">
                  <Text type="label" size="xs" weight="semibold">
                    Requested Capability Pass Scope
                  </Text>
                  <Badge variant="purple" label="SINGLE-USE" />
                </HStack>
                <MetadataList size="sm">
                  <MetadataListItem label="Buyer Agent">
                    {event.sourceActor}
                  </MetadataListItem>
                  <MetadataListItem label="SPIFFE ID">
                    {event.passRequest.agentFingerprint}
                  </MetadataListItem>
                  <MetadataListItem label="Pinned SKU">
                    {event.passRequest.sku}
                  </MetadataListItem>
                  <MetadataListItem label="Amount Cap">
                    ${event.passRequest.requestedCap}.00 USD (hard ceiling)
                  </MetadataListItem>
                  <MetadataListItem label="Pass TTL">
                    {event.passRequest.ttl}
                  </MetadataListItem>
                </MetadataList>
              </VStack>
            </Card>
          )}

          {/* 5. CANONICAL VALIDATION GATES (Lives ONLY here — Fixes #05 P2!) */}
          {event.validations && event.validations.length > 0 && (
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                <Text type="label" size="2xs" weight="semibold">
                  POLICY & SCHEMA VALIDATION
                </Text>
                {event.validations.map(v => (
                  <div
                    key={v.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}>
                    <div style={{minWidth: 0}}>
                      <HStack gap={1.5} vAlign="center">
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
                        <Text type="body" size="xs" weight="medium">
                          {v.gate}
                        </Text>
                      </HStack>
                      <div style={{paddingLeft: 16}}>
                        <Text type="supporting" size="2xs">
                          {v.detail}
                        </Text>
                      </div>
                    </div>
                  </div>
                ))}
              </VStack>
            </Card>
          )}

          {/* 6. EXACT WIRE PAYLOAD / DIFF REVIEW BEFORE TRANSMISSION */}
          <VStack gap={1.5}>
            <HStack hAlign="between" vAlign="center">
              <Text type="label" size="2xs" weight="semibold">
                {event.wireDiffJson && (mutationOn || isHistoricalModified)
                  ? `EXACT JSON-RPC DIFF (TARGET: ${event.targetActor})`
                  : `RAW ${event.protocol} WIRE PAYLOAD`}
              </Text>
              <Token
                size="sm"
                color="gray"
                label={`→ ${event.targetActor}`}
              />
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

      {/* Sticky Canonical Action Footer — Unambiguous Delivery State + Disabled Explanations (Fixes #04 P1) */}
      {(isOfferFrame || isAwaitingPass) && (
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--color-border-default)',
            backgroundColor:
              'var(--color-background-subtle, var(--color-background-surface))',
            flexShrink: 0,
          }}>
          {isHeldQuote ? (
            <VStack gap={2}>
              <Switch
                width="100%"
                labelSpacing="spread"
                label={`Confirm target ${event.targetActor} & exact JSON-RPC payload`}
                value={payloadReviewed}
                onChange={setPayloadReviewed}
              />

              <HStack gap={2}>
                <Button
                  width="100%"
                  variant="primary"
                  label={
                    mutationOn
                      ? `Transmit Modified (${proposedCount} offers)`
                      : 'Enable Mutation Rule to Transmit Diff'
                  }
                  isDisabled={!mutationOn || !payloadReviewed}
                  tooltip={
                    !payloadReviewed
                      ? 'Confirm exact wire payload & target recipient above before transmitting'
                      : !mutationOn
                        ? 'Protocol mutation rule is off — use Forward Original (2 offers) or re-enable mutation'
                        : `Send ${proposedCount} validated offers to ${event.targetActor}`
                  }
                  onClick={() => onTransmitModified(event.id)}
                />
                <Button
                  width="100%"
                  variant="secondary"
                  label={`Forward Original (${upstreamCount} offers)`}
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

              {/* Explicit visible explanation whenever a control is disabled (Fixes #04 P1!) */}
              {event.forwardOriginalBlockedReason && (
                <Text type="supporting" size="2xs">
                  <strong>Why Forward Original is disabled:</strong>{' '}
                  {event.forwardOriginalBlockedReason}
                </Text>
              )}
              {!payloadReviewed && (
                <Text type="supporting" size="2xs">
                  <strong>Transmission locked:</strong> Confirm exact outbound
                  message & recipient `{event.targetActor}` above to unlock send
                  actions.
                </Text>
              )}
            </VStack>
          ) : isAwaitingPass ? (
            <VStack gap={2}>
              <HStack gap={2}>
                <Button
                  width="100%"
                  variant="primary"
                  label={`Issue Scoped Pass ($${event.passRequest?.requestedCap ?? 0})`}
                  onClick={() => onAuthorizePass(event.id)}
                />
                <Button
                  width="100%"
                  variant="destructive"
                  label="Reject Checkout"
                  onClick={() => onRejectPass(event.id)}
                />
              </HStack>
            </VStack>
          ) : (
            <VStack gap={1.5}>
              <HStack gap={2}>
                <Button
                  width="100%"
                  variant="secondary"
                  isDisabled
                  label="Response Already Delivered"
                  tooltip={`Completed at ${event.deliveredAt ?? event.timestamp} — historical frames cannot be re-sent`}
                />
              </HStack>
              <Text type="supporting" size="2xs">
                <strong>Controls locked:</strong> {event.code} was already
                delivered to `{event.targetActor}` at{' '}
                {event.deliveredAt ?? event.timestamp}. Use{' '}
                <strong>Reset Scenario</strong> in the top bar to replay live
                interception.
              </Text>
            </VStack>
          )}
        </div>
      )}
    </div>
  );
}
