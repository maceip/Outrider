// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React from 'react';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Token} from '@astryxdesign/core/Token';
import type {MerchantSession, TraceEvent} from './conduitState';

interface CausalObservatoryGraphProps {
  session: MerchantSession;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  expanded?: boolean;
}

function getNodeStateMeta(ev: TraceEvent): {
  badgeVariant: 'warning' | 'success' | 'info' | 'neutral' | 'purple';
  badgeLabel: string;
  borderVar: string;
  bgTint: string;
  actorLane: 'buyer' | 'proxy' | 'seller';
} {
  if (ev.deliveryPhase === 'held_at_proxy') {
    return {
      badgeVariant: 'warning',
      badgeLabel: 'HELD',
      borderVar: 'var(--color-feedback-warning, #d97706)',
      bgTint: 'color-mix(in srgb, #f59e0b 11%, var(--color-background-surface))',
      actorLane: 'proxy',
    };
  }
  if (ev.deliveryPhase === 'awaiting_pass') {
    return {
      badgeVariant: 'purple',
      badgeLabel: 'PASS GATE',
      borderVar: '#8b5cf6',
      bgTint: 'color-mix(in srgb, #8b5cf6 10%, var(--color-background-surface))',
      actorLane: 'proxy',
    };
  }
  if (ev.deliveryPhase === 'delivered_modified') {
    return {
      badgeVariant: 'info',
      badgeLabel: 'MODIFIED',
      borderVar: 'var(--color-interactive-primary, #2563eb)',
      bgTint:
        'color-mix(in srgb, var(--color-interactive-primary, #2563eb) 9%, var(--color-background-surface))',
      actorLane: 'proxy',
    };
  }
  if (ev.deliveryPhase === 'pass_authorized') {
    return {
      badgeVariant: 'success',
      badgeLabel: 'SETTLED',
      borderVar: '#16a34a',
      bgTint: 'color-mix(in srgb, #16a34a 9%, var(--color-background-surface))',
      actorLane: 'buyer',
    };
  }
  if (ev.direction === 'seller_to_buyer') {
    return {
      badgeVariant: 'success',
      badgeLabel: '200 OK',
      borderVar: 'var(--color-border-default)',
      bgTint: 'var(--color-background-surface)',
      actorLane: 'seller',
    };
  }
  return {
    badgeVariant: 'neutral',
    badgeLabel: `${ev.protocol} ${ev.httpStatus ?? 200}`,
    borderVar: 'var(--color-border-default)',
    bgTint: 'var(--color-background-surface)',
    actorLane: 'buyer',
  };
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

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--color-border-default) 55%, transparent) 1px, transparent 0)',
        backgroundSize: '18px 18px',
        backgroundColor: 'var(--color-background-subtle, var(--color-background-surface))',
        overflow: 'hidden',
      }}>
      {/* Compact Observatory Header Bar */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--color-border-subtle, var(--color-border-default))',
          backgroundColor: 'var(--color-background-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}>
        <HStack gap={2} vAlign="center">
          <Text type="label" weight="semibold">
            Causal Observatory
          </Text>
          <Token
            size="sm"
            color="gray"
            label={`${session.buyerAgentId} ↔ Conduit Proxy ↔ ${session.merchantHost}`}
          />
        </HStack>

        <HStack gap={3} vAlign="center">
          <StatusDot
            variant={heldR02 ? 'warning' : 'success'}
            isPulsing={Boolean(heldR02)}
            label={
              heldR02
                ? `${heldR02.code} held in proxy · buyer has 0 offers`
                : 'Wire synchronized · 0 frames held'
            }
          />
        </HStack>
      </div>

      {/* Main Causal Spine + Commercial Offer Cradle */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: expanded ? '18px 20px' : '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        {/* Causal Flow Grid: Responsive wrap with zero horizontal scroll */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${expanded ? '210px' : '172px'}, 1fr))`,
            gap: 10,
            alignItems: 'stretch',
          }}>
          {session.events.map((ev, idx) => {
            const isSelected = ev.id === selectedEventId;
            const meta = getNodeStateMeta(ev);
            const laneLabel =
              meta.actorLane === 'buyer'
                ? 'Buyer'
                : meta.actorLane === 'proxy'
                  ? 'Proxy Gate'
                  : 'Seller';

            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onSelectEvent(ev.id)}
                data-testid={`graph-node-${ev.code}`}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 10,
                  padding: expanded ? '12px 13px' : '9px 11px',
                  border: isSelected
                    ? `2px solid var(--color-interactive-primary, #2563eb)`
                    : `1px solid ${meta.borderVar}`,
                  backgroundColor: meta.bgTint,
                  boxShadow: isSelected
                    ? '0 0 0 3px color-mix(in srgb, var(--color-interactive-primary, #2563eb) 18%, transparent)'
                    : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 6,
                  minWidth: 0,
                  position: 'relative',
                  transition: 'border-color 120ms ease, box-shadow 120ms ease',
                }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    minWidth: 0,
                  }}>
                  <HStack gap={1.5} vAlign="center">
                    <span
                      style={{
                        fontFamily: 'var(--font-family-mono, monospace)',
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 4,
                        backgroundColor:
                          'color-mix(in srgb, var(--color-text-primary) 9%, transparent)',
                        color: 'var(--color-text-primary)',
                      }}>
                      {idx + 1}. {ev.code}
                    </span>
                    <Text type="supporting" size="2xs" maxLines={1}>
                      {laneLabel}
                    </Text>
                  </HStack>
                  <Badge variant={meta.badgeVariant} label={meta.badgeLabel} />
                </div>

                <div style={{minWidth: 0}}>
                  <Text type="code" size="2xs" weight="semibold" maxLines={1}>
                    {ev.toolOrEndpoint}
                  </Text>
                  <Text
                    type="supporting"
                    size="2xs"
                    maxLines={expanded ? 3 : 2}>
                    {ev.observation}
                  </Text>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop:
                      '1px dashed color-mix(in srgb, var(--color-border-default) 70%, transparent)',
                    paddingTop: 5,
                  }}>
                  <Text type="code" size="3xs" color="secondary">
                    {ev.direction === 'buyer_to_seller'
                      ? 'Buyer → Seller'
                      : ev.direction === 'buyer_to_gate'
                        ? 'Buyer → Gate'
                        : 'Seller → Buyer'}
                  </Text>
                  <Text
                    type="code"
                    size="3xs"
                    color="secondary"
                    hasTabularNumbers>
                    {ev.durationLabel}
                  </Text>
                </div>
              </button>
            );
          })}

          {/* When R02 is HELD, explicitly show downstream buyer selection as UNREACHED (fixes P0 #01!) */}
          {heldR02 && (
            <div
              data-testid="graph-node-unreached-downstream"
              style={{
                borderRadius: 10,
                padding: expanded ? '12px 13px' : '9px 11px',
                border: '1px dashed var(--color-border-default)',
                backgroundColor:
                  'color-mix(in srgb, var(--color-background-surface) 55%, transparent)',
                opacity: 0.72,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 6,
                minWidth: 0,
              }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}>
                <Text type="code" size="2xs" color="secondary">
                  Next · C03
                </Text>
                <Badge variant="neutral" label="UNREACHED" />
              </div>
              <Text type="supporting" size="2xs" maxLines={3}>
                {session.buyerAgentId} has 0 offers while {heldR02.code} is
                held. `select_product` runs only after release.
              </Text>
              <Text type="code" size="3xs" color="secondary">
                Awaits {heldR02.code} delivery
              </Text>
            </div>
          )}
        </div>

        {/* Commercial Offer & Proxy Mutation Cradle (renders when session involves commercial offers) */}
        {offerEvent && (
          <div
            onClick={() => onSelectEvent(offerEvent.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectEvent(offerEvent.id);
              }
            }}
            style={{
              borderRadius: 10,
              padding: expanded ? '12px 14px' : '9px 12px',
              backgroundColor: 'var(--color-background-surface)',
              border: '1px solid var(--color-border-default)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              cursor: 'pointer',
            }}>
            <HStack gap={1.5} vAlign="center" wrap>
              <Text type="label" size="2xs" weight="semibold">
                {offerEvent.code} Cradle:
              </Text>
              <Token
                size="sm"
                color="gray"
                label={`Floor $${session.marginFloorUsd}`}
              />
              {(offerEvent.upstreamOffers ?? []).map(off => (
                <Token
                  key={off.id}
                  size="sm"
                  color={off.marginDelta < 0 ? 'red' : 'blue'}
                  label={`${off.id} $${off.price} (${off.marginDelta >= 0 ? `+$${off.marginDelta}` : `-$${Math.abs(off.marginDelta)}`})`}
                />
              ))}
              {offerEvent.stagedOffer && (
                <Token
                  size="sm"
                  color={
                    offerEvent.deliveryPhase === 'delivered_modified'
                      ? 'green'
                      : offerEvent.mutationEnabled !== false
                        ? 'orange'
                        : 'gray'
                  }
                  label={
                    offerEvent.deliveryPhase === 'delivered_modified'
                      ? `+${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price} (Delivered)`
                      : offerEvent.mutationEnabled !== false
                        ? `+${offerEvent.stagedOffer.id} $${offerEvent.stagedOffer.price} (Staged)`
                        : `${offerEvent.stagedOffer.id} Off`
                  }
                />
              )}
            </HStack>

            <Badge
              variant={
                offerEvent.deliveryPhase === 'held_at_proxy'
                  ? 'warning'
                  : offerEvent.deliveryPhase === 'delivered_modified'
                    ? 'info'
                    : 'success'
              }
              label={
                offerEvent.deliveryPhase === 'held_at_proxy'
                  ? `${offerEvent.upstreamOffers?.length ?? 2} observed → ${
                      offerEvent.mutationEnabled !== false
                        ? (offerEvent.upstreamOffers?.length ?? 2) + 1
                        : (offerEvent.upstreamOffers?.length ?? 2)
                    } staged (undelivered)`
                  : offerEvent.deliveryPhase === 'delivered_modified'
                    ? `${offerEvent.deliveredOffers?.length ?? 3} offers delivered`
                    : 'Original delivered'
              }
            />
          </div>
        )}

        {/* Expanded Graph View Extra Telemetry (when user selects dedicated Graph surface) */}
        {expanded && (
          <div
            style={{
              borderRadius: 10,
              padding: '12px 14px',
              backgroundColor: 'var(--color-background-surface)',
              border: '1px solid var(--color-border-default)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}>
            <VStack gap={1}>
              <Text type="supporting" size="2xs">
                BUYER AGENT TOPOLOGY
              </Text>
              <Text type="body" size="sm" weight="semibold">
                {session.buyerAgentId} · {session.buyerModel}
              </Text>
              <Text type="supporting" size="2xs">
                Fingerprint confidence {session.agentConfidence}
              </Text>
            </VStack>
            <VStack gap={1}>
              <Text type="supporting" size="2xs">
                PROXY INTERCEPTION POSTURE
              </Text>
              <Text type="body" size="sm" weight="semibold">
                {session.trafficProfile}
              </Text>
              <Text type="supporting" size="2xs">
                95% read-only catalog calls pass in &lt;3ms with 0 UI columns
              </Text>
            </VStack>
            <VStack gap={1}>
              <Text type="supporting" size="2xs">
                UNIT ECONOMICS GUARDRAIL
              </Text>
              <Text type="body" size="sm" weight="semibold" hasTabularNumbers>
                SKU {session.skuCode} · Floor ${session.marginFloorUsd}.00 /
                MSRP ${session.msrpUsd}.00
              </Text>
              <Text type="supporting" size="2xs">
                {session.selectedOfferLabel ??
                  'No buyer offer selection recorded yet'}
              </Text>
            </VStack>
          </div>
        )}
      </div>
    </div>
  );
}
