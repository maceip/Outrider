// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useMemo, useState, type CSSProperties} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  LayoutPanel,
  StackItem,
  VStack,
} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {ResizeHandle, useResizable} from '@astryxdesign/core/Resizable';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {Theme} from '@astryxdesign/core/theme';
import {CONDUIT_MARK_DATA_URI} from './conduitMark';
import {conduitTheme} from './conduitTheme';
import {
  STAGE_ORDER,
  buildInitialPasses,
  buildInitialSessions,
  deriveWorkspaceMetrics,
  type CapabilityPassRecord,
  type MerchantSession,
  type ScenarioPresetId,
  type SurfaceId,
  type TraceFilterId,
} from './conduitState';
import {CausalObservatoryGraph} from './CausalObservatoryGraph';
import {DenseTraceTable} from './DenseTraceTable';
import {CanonicalInspectorPanel} from './CanonicalInspectorPanel';
import {ConduitMobileWorkbench} from './ConduitMobileWorkbench';
import {PassesSurface, WireSurface} from './WireAndPassesSurfaces';

const SCENARIO_LABELS: Record<ScenarioPresetId, string> = {
  live_hold_r02: 'Held Quote ($209 Counter)',
  floor_leak_blocked: 'Margin Floor Guard ($189 Blocked)',
  post_release_pass: 'Checkout Pass Gate',
  discovery_95pct: 'Catalog Browsing (2 ms Pass-Through)',
};

const styles: Record<string, CSSProperties> = {
  viewportRoot: {
    height: '100dvh',
    width: '100vw',
    overflow: 'hidden',
    backgroundColor: 'var(--color-background-surface)',
    color: 'var(--color-text-primary)',
    display: 'flex',
    flexDirection: 'column',
  },
  brandMark: {
    width: 20,
    height: 20,
    objectFit: 'contain',
    flexShrink: 0,
  },
  contextRow: {
    paddingTop: 'var(--spacing-1-5)',
    borderTop: 'var(--border-width) solid var(--color-border)',
  },
  sidebarSection: {
    padding: 'var(--spacing-3)',
  },
  workspaceSplit: {
    height: '100%',
    width: '100%',
    display: 'flex',
    overflow: 'hidden',
  },
  centerColumn: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  traceFill: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  inspectorPane: {
    flexShrink: 0,
    height: '100%',
    overflow: 'hidden',
  },
};

export interface ConduitWorkbenchProps {
  initialScenario?: ScenarioPresetId;
  initialColorMode?: 'dark' | 'light';
  colorMode?: 'dark' | 'light';
  onColorModeChange?: (mode: 'dark' | 'light') => void;
  onBackToOverview?: () => void;
}

export function ConduitWorkbench({
  initialScenario = 'live_hold_r02',
  initialColorMode = 'dark',
  colorMode: controlledColorMode,
  onColorModeChange,
  onBackToOverview,
}: ConduitWorkbenchProps = {}) {
  const [internalColorMode, setInternalColorMode] = useState<'dark' | 'light'>(
    initialColorMode,
  );
  const colorMode = controlledColorMode ?? internalColorMode;
  const handleColorModeChange = (next: 'dark' | 'light') => {
    if (onColorModeChange) {
      onColorModeChange(next);
    } else {
      setInternalColorMode(next);
    }
  };

  const [scenario, setScenario] = useState<ScenarioPresetId>(initialScenario);
  const [isScenarioDirty, setIsScenarioDirty] = useState<boolean>(false);

  const [sessions, setSessions] = useState<MerchantSession[]>(() =>
    buildInitialSessions(initialScenario),
  );
  const [passes, setPasses] = useState<CapabilityPassRecord[]>(() =>
    buildInitialPasses(),
  );
  const [activeSessionId, setActiveSessionId] = useState<string>(() =>
    initialScenario === 'discovery_95pct' ? 'displayco' : 'audioshop',
  );
  const [activeSurface, setActiveSurface] = useState<SurfaceId>('overview');
  const [traceFilter, setTraceFilter] = useState<TraceFilterId>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(() => {
    const initSessions = buildInitialSessions(initialScenario);
    if (initialScenario === 'discovery_95pct') {
      return 'evt-dsp-02';
    }
    const aud = initSessions[0];
    const focusEvt =
      aud.events.find(
        e =>
          e.deliveryPhase === 'held_at_proxy' ||
          e.deliveryPhase === 'awaiting_pass',
      ) ?? aud.events[aud.events.length - 1];
    return focusEvt?.id ?? null;
  });

  const isMobile = useMediaQuery('(max-width: 1024px)');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(() => {
    if (initialScenario === 'discovery_95pct') return false;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1024px)').matches
    ) {
      return false;
    }
    return true;
  });
  const [wasMobile, setWasMobile] = useState<boolean>(isMobile);
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (isMobile) {
      setIsInspectorOpen(false);
    }
  }

  const sidebarResize = useResizable({
    defaultSize: 228,
    minSize: 192,
    maxSize: 300,
  });

  const graphHeightResize = useResizable({
    direction: 'vertical',
    defaultSize: 268,
    minSize: 175,
    maxSize: 470,
  });

  const inspectorResize = useResizable({
    defaultSize: 404,
    minSize: 340,
    maxSize: 540,
  });

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  );

  const metrics = useMemo(
    () => deriveWorkspaceMetrics(activeSession, sessions, passes),
    [activeSession, sessions, passes],
  );

  const selectedEvent = useMemo(
    () =>
      activeSession.events.find(e => e.id === selectedEventId) ??
      activeSession.events[activeSession.events.length - 1] ??
      null,
    [activeSession, selectedEventId],
  );

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setTraceFilter('all');
    const target = sessions.find(s => s.id === sessionId);
    if (!target) return;

    const actionEvent = target.events.find(
      e =>
        e.deliveryPhase === 'held_at_proxy' ||
        e.deliveryPhase === 'awaiting_pass',
    );
    const settledOrModified =
      target.events.find(e => e.deliveryPhase === 'pass_authorized') ??
      target.events.find(e => e.deliveryPhase === 'delivered_modified');

    if (actionEvent) {
      setSelectedEventId(actionEvent.id);
      setIsInspectorOpen(!isMobile);
    } else if (settledOrModified) {
      setSelectedEventId(settledOrModified.id);
      setIsInspectorOpen(!isMobile);
    } else {
      // Read-only browsing (DisplayCo) opens full-width by default
      setSelectedEventId(target.events[target.events.length - 1]?.id ?? null);
      setIsInspectorOpen(false);
    }
  };

  const applyScenarioPreset = (preset: ScenarioPresetId) => {
    setScenario(preset);
    setIsScenarioDirty(false);
    const freshSessions = buildInitialSessions(preset);
    const freshPasses = buildInitialPasses();
    setSessions(freshSessions);
    setPasses(freshPasses);
    setActiveSurface('overview');
    setTraceFilter('all');

    if (preset === 'discovery_95pct') {
      setActiveSessionId('displayco');
      setSelectedEventId('evt-dsp-02');
      setIsInspectorOpen(false);
    } else {
      setActiveSessionId('audioshop');
      const aud = freshSessions[0];
      const focusEvt =
        aud.events.find(
          e =>
            e.deliveryPhase === 'held_at_proxy' ||
            e.deliveryPhase === 'awaiting_pass',
        ) ?? aud.events[aud.events.length - 1];
      setSelectedEventId(focusEvt?.id ?? null);
      setIsInspectorOpen(!isMobile);
    }
  };

  const handleSelectEventFromWorkspace = (eventId: string) => {
    setSelectedEventId(eventId);
    setIsInspectorOpen(true);
  };

  const handleToggleMutation = (eventId: string, nextEnabled: boolean) => {
    setIsScenarioDirty(true);
    setSessions(prev =>
      prev.map(sess =>
        sess.id !== activeSession.id
          ? sess
          : {
              ...sess,
              events: sess.events.map(ev =>
                ev.id === eventId ? {...ev, mutationEnabled: nextEnabled} : ev,
              ),
            },
      ),
    );
  };

  const handleTransmitModified = (eventId: string) => {
    setIsScenarioDirty(true);
    const nowStamp = '14:02:11.408';
    let mintedCartCap = 209;
    const c04Id = `evt-${activeSession.id}-c04-live`;

    setSessions(prev =>
      prev.map(sess => {
        if (sess.id !== activeSession.id) return sess;
        const target = sess.events.find(e => e.id === eventId);
        if (!target || target.deliveryPhase !== 'held_at_proxy') return sess;

        const isLeakFix = Boolean(target.forwardOriginalBlockedReason);
        const deliveredList = [
          ...(target.upstreamOffers ?? []).filter(
            o => !(isLeakFix && o.marginDelta < 0),
          ),
          ...(target.stagedOffer ? [target.stagedOffer] : []),
        ];
        const chosenOffer = target.stagedOffer ?? deliveredList[0];
        mintedCartCap = chosenOffer?.price ?? 209;

        const updatedEvents = sess.events.map(ev =>
          ev.id !== eventId
            ? ev
            : {
                ...ev,
                durationLabel: '412 ms',
                httpStatus: 200,
                deliveryPhase: 'delivered_modified' as const,
                deliveredOffers: deliveredList,
                deliveredAt: nowStamp,
                observation: `${deliveredList.length} offers delivered to ${ev.targetActor} (+${chosenOffer?.id ?? 'O03'} $${mintedCartCap}.00)`,
                headers: {
                  ...ev.headers,
                  'x-conduit-hold-state': 'RELEASED_MODIFIED',
                  'x-conduit-delivered-at': `${nowStamp}Z`,
                },
              },
        );

        const c03Id = `evt-${sess.id}-c03-live`;

        return {
          ...sess,
          selectedOfferLabel: `${chosenOffer?.id ?? 'O03'} · $${mintedCartCap}.00`,
          events: [
            ...updatedEvents,
            {
              id: c03Id,
              seq: 104,
              code: 'C03',
              title: 'Select Offer',
              direction: 'buyer_to_seller' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'select_product',
              timestamp: '14:02:12.019',
              durationLabel: '3 ms',
              httpStatus: 200,
              deliveryPhase: 'observed_inbound' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: `${sess.merchantHost}/mcp`,
              observation: `Buyer selected ${chosenOffer?.id ?? 'O03'} ($${mintedCartCap}.00) → cart CART-8841`,
              rawOriginalJson: JSON.stringify(
                {
                  jsonrpc: '2.0',
                  id: 'req_03',
                  method: 'tools/call',
                  params: {
                    name: 'select_product',
                    arguments: {
                      sku: sess.skuCode,
                      selected_offer_id: chosenOffer?.id ?? 'O03',
                      agreed_price_usd: mintedCartCap,
                      cart_id: 'CART-8841',
                    },
                  },
                },
                null,
                2,
              ),
              headers: {
                'content-type': 'application/json',
                'x-mcp-agent-id': sess.buyerAgentId,
                'x-conduit-cart': 'CART-8841',
              },
            },
            {
              id: c04Id,
              seq: 105,
              code: 'C04',
              title: 'Request Pass',
              direction: 'buyer_to_gate' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'request_checkout_pass',
              timestamp: '14:02:12.490',
              durationLabel: 'Awaiting pass',
              httpStatus: 202,
              deliveryPhase: 'awaiting_pass' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: 'conduit.pass.authority',
              observation: `Checkout awaits single-use pass ($${mintedCartCap}.00 cap · ${sess.skuCode})`,
              passRequest: {
                requestId: 'req_pass_7f2_live',
                sku: sess.skuCode,
                requestedCap: mintedCartCap,
                ttl: '15m 00s',
                agentFingerprint: `spiffe://agents.buyer/${sess.buyerAgentId}`,
              },
              validations: [
                {
                  id: 'vp-live-1',
                  gate: 'Agreed Quote Match',
                  status: 'pass' as const,
                  detail: `Requested $${mintedCartCap}.00 matches delivered offer ${chosenOffer?.id ?? 'O03'}`,
                },
                {
                  id: 'vp-live-2',
                  gate: 'Single-Use Replay Lock',
                  status: 'pass' as const,
                  detail: 'Pinned to CART-8841 · 1 call max · 15m TTL',
                },
              ],
              rawOriginalJson: JSON.stringify(
                {
                  jsonrpc: '2.0',
                  id: 'req_04',
                  method: 'conduit/request_checkout_pass',
                  params: {
                    cart_id: 'CART-8841',
                    sku: sess.skuCode,
                    amount_cap_usd: mintedCartCap,
                    ttl_seconds: 900,
                  },
                },
                null,
                2,
              ),
              headers: {
                'content-type': 'application/json',
                'x-conduit-gate': 'PASS_AUTHORITY',
              },
            },
          ],
        };
      }),
    );

    setPasses(prev => [
      {
        id: 'pass_aud_7f2_await',
        sessionId: activeSession.id,
        merchantHost: activeSession.merchantHost,
        buyerAgent: activeSession.buyerAgentId,
        sku: activeSession.skuCode,
        capUsd: mintedCartCap,
        remainingCalls: 1,
        ttl: '15m 00s',
        issuedAt: 'Pending approval',
        signature: 'unsigned (awaiting operator)',
        status: 'Awaiting Approval',
      },
      ...prev.filter(p => p.id !== 'pass_aud_7f2_await'),
    ]);

    // Auto-advance inspector focus to the newly arrived Checkout Pass Gate!
    setSelectedEventId(c04Id);
  };

  const handleForwardOriginal = (eventId: string) => {
    setIsScenarioDirty(true);
    const nowStamp = '14:02:11.512';
    const c04OrigId = `evt-${activeSession.id}-c04-orig`;

    setSessions(prev =>
      prev.map(sess => {
        if (sess.id !== activeSession.id) return sess;
        const target = sess.events.find(e => e.id === eventId);
        if (!target || target.deliveryPhase !== 'held_at_proxy') return sess;

        const origOffers = target.upstreamOffers ?? [];
        const picked = origOffers[0];
        const cap = picked?.price ?? 219;

        const updatedEvents = sess.events.map(ev =>
          ev.id !== eventId
            ? ev
            : {
                ...ev,
                durationLabel: '390 ms',
                httpStatus: 200,
                deliveryPhase: 'delivered_original' as const,
                deliveredOffers: origOffers,
                deliveredAt: nowStamp,
                observation: `${origOffers.length} original seller offers forwarded to ${ev.targetActor}`,
                headers: {
                  ...ev.headers,
                  'x-conduit-hold-state': 'FORWARDED_ORIGINAL',
                },
              },
        );

        return {
          ...sess,
          selectedOfferLabel: `${picked?.id ?? 'O01'} · $${cap}.00`,
          events: [
            ...updatedEvents,
            {
              id: `evt-${sess.id}-c03-orig`,
              seq: 104,
              code: 'C03',
              title: 'Select Offer',
              direction: 'buyer_to_seller' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'select_product',
              timestamp: '14:02:12.210',
              durationLabel: '3 ms',
              httpStatus: 200,
              deliveryPhase: 'observed_inbound' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: `${sess.merchantHost}/mcp`,
              observation: `Buyer selected ${picked?.id ?? 'O01'} ($${cap}.00) → cart CART-8842`,
              rawOriginalJson: JSON.stringify(
                {
                  sku: sess.skuCode,
                  selected_offer_id: picked?.id ?? 'O01',
                  agreed_price_usd: cap,
                },
                null,
                2,
              ),
              headers: {'content-type': 'application/json'},
            },
            {
              id: c04OrigId,
              seq: 105,
              code: 'C04',
              title: 'Request Pass',
              direction: 'buyer_to_gate' as const,
              protocol: 'MCP' as const,
              toolOrEndpoint: 'request_checkout_pass',
              timestamp: '14:02:12.680',
              durationLabel: 'Awaiting pass',
              httpStatus: 202,
              deliveryPhase: 'awaiting_pass' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: 'conduit.pass.authority',
              observation: `Checkout awaits $${cap}.00 single-use pass`,
              passRequest: {
                requestId: 'req_pass_orig',
                sku: sess.skuCode,
                requestedCap: cap,
                ttl: '15m 00s',
                agentFingerprint: `spiffe://agents.buyer/${sess.buyerAgentId}`,
              },
              validations: [
                {
                  id: 'vp-orig-1',
                  gate: 'Agreed Quote Match',
                  status: 'pass' as const,
                  detail: `Requested $${cap}.00 matches delivered offer ${picked?.id ?? 'O01'}`,
                },
              ],
              rawOriginalJson: JSON.stringify(
                {sku: sess.skuCode, amount_cap_usd: cap},
                null,
                2,
              ),
              headers: {'content-type': 'application/json'},
            },
          ],
        };
      }),
    );

    setSelectedEventId(c04OrigId);
  };

  const handleAuthorizePass = (eventId: string) => {
    setIsScenarioDirty(true);
    const newPassId = `pass_${activeSession.id}_signed`;
    let settledUsd = activeSession.msrpUsd;
    const c05Id = `evt-${activeSession.id}-c05-settled`;

    setSessions(prev =>
      prev.map(sess => {
        if (sess.id !== activeSession.id) return sess;
        const evt = sess.events.find(e => e.id === eventId);
        settledUsd = evt?.passRequest?.requestedCap ?? sess.msrpUsd;

        const updated = sess.events.map(e =>
          e.id !== eventId
            ? e
            : {
                ...e,
                httpStatus: 200,
                durationLabel: '18 ms',
                deliveryPhase: 'pass_authorized' as const,
                observation: `Issued single-use pass ${newPassId} ($${settledUsd}.00 cap)`,
              },
        );

        return {
          ...sess,
          events: [
            ...updated,
            {
              id: c05Id,
              seq: 106,
              code: 'C05',
              title: 'Confirm Order',
              direction: 'buyer_to_seller' as const,
              protocol: 'HTTP' as const,
              toolOrEndpoint: 'POST /v1/orders/confirm',
              timestamp: '14:02:15.044',
              durationLabel: '14 ms',
              httpStatus: 200,
              deliveryPhase: 'pass_authorized' as const,
              sourceActor: sess.buyerAgentId,
              targetActor: sess.merchantHost,
              observation: `Order ORD-99204 confirmed ($${settledUsd}.00) with single-use pass ${newPassId}`,
              validations: [
                {
                  id: 'v-settled-1',
                  gate: 'Single-Use Pass Verified',
                  status: 'pass' as const,
                  detail: `${newPassId} signed & bound to $${settledUsd}.00`,
                },
                {
                  id: 'v-settled-2',
                  gate: `Margin Floor Cleared ($${sess.marginFloorUsd}.00)`,
                  status: 'pass' as const,
                  detail: `Settled at $${settledUsd}.00 (+$${settledUsd - sess.marginFloorUsd}.00 net margin)`,
                },
              ],
              rawOriginalJson: JSON.stringify(
                {
                  order_id: 'ORD-99204',
                  sku: sess.skuCode,
                  settled_usd: settledUsd,
                  capability_pass: newPassId,
                },
                null,
                2,
              ),
              headers: {
                'content-type': 'application/json',
                'authorization': `ConduitPass ${newPassId}`,
              },
            },
          ],
        };
      }),
    );

    setPasses(prev => {
      const filtered = prev.filter(p => p.sessionId !== activeSession.id);
      return [
        {
          id: newPassId,
          sessionId: activeSession.id,
          merchantHost: activeSession.merchantHost,
          buyerAgent: activeSession.buyerAgentId,
          sku: activeSession.skuCode,
          capUsd: settledUsd,
          remainingCalls: 1,
          ttl: '14m 59s',
          issuedAt: '14:02:14 UTC',
          signature: 'ed25519:7c19f0…a42e',
          status: 'Active',
        },
        ...filtered,
      ];
    });

    setSelectedEventId(c05Id);
  };

  const handleRejectPass = (eventId: string) => {
    setIsScenarioDirty(true);
    setSessions(prev =>
      prev.map(sess =>
        sess.id !== activeSession.id
          ? sess
          : {
              ...sess,
              events: sess.events.map(e =>
                e.id !== eventId
                  ? e
                  : {
                      ...e,
                      httpStatus: 403,
                      durationLabel: 'Rejected',
                      deliveryPhase: 'delivered_original' as const,
                      observation:
                        'Operator rejected checkout pass request (403 returned to agent)',
                    },
              ),
            },
      ),
    );
    setPasses(prev =>
      prev.map(p =>
        p.sessionId === activeSession.id ? {...p, status: 'Revoked'} : p,
      ),
    );
  };

  const handleRevokePass = (passId: string) => {
    setIsScenarioDirty(true);
    setPasses(prev =>
      prev.map(p => (p.id === passId ? {...p, status: 'Revoked'} : p)),
    );
  };

  const handleApprovePendingPassFromLedger = (passId: string) => {
    setIsScenarioDirty(true);
    const targetPass = passes.find(p => p.id === passId);
    if (!targetPass) return;
    const sess = sessions.find(s => s.id === targetPass.sessionId);
    const awaitingEvt = sess?.events.find(
      e => e.deliveryPhase === 'awaiting_pass',
    );
    if (sess && awaitingEvt) {
      setActiveSessionId(sess.id);
      setTimeout(() => handleAuthorizePass(awaitingEvt.id), 0);
    } else {
      setPasses(prev =>
        prev.map(p =>
          p.id === passId
            ? {...p, status: 'Active', signature: 'ed25519:3a92bc…19d4'}
            : p,
        ),
      );
    }
  };

  if (isMobile) {
    return (
      <Theme theme={conduitTheme} mode={colorMode}>
        <style>{'nextjs-portal { display: none !important; }'}</style>
        <ConduitMobileWorkbench
          sessions={sessions}
          activeSession={activeSession}
          passes={passes}
          scenario={scenario}
          scenarioLabels={SCENARIO_LABELS}
          isScenarioDirty={isScenarioDirty}
          selectedEvent={selectedEvent}
          traceFilter={traceFilter}
          colorMode={colorMode}
          onColorModeChange={handleColorModeChange}
          onBackToOverview={onBackToOverview}
          onSelectSession={handleSelectSession}
          onApplyScenario={applyScenarioPreset}
          onSelectEvent={id => setSelectedEventId(id)}
          onTraceFilterChange={setTraceFilter}
          onToggleMutation={handleToggleMutation}
          onTransmitModified={handleTransmitModified}
          onForwardOriginal={handleForwardOriginal}
          onAuthorizePass={handleAuthorizePass}
          onRejectPass={handleRejectPass}
          onRevokePass={handleRevokePass}
          onApprovePendingPass={handleApprovePendingPassFromLedger}
        />
      </Theme>
    );
  }

  const showDesktopRightPanel =
    isInspectorOpen &&
    (activeSurface === 'overview' || activeSurface === 'graph');

  const showReopenButton =
    (activeSurface === 'overview' || activeSurface === 'graph') &&
    !isInspectorOpen;

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <div
        data-testid="conduit-astryx-workbench"
        style={styles.viewportRoot}>
        <style>{'nextjs-portal { display: none !important; }'}</style>
        <Layout
          height="fill"
          header={
            <LayoutHeader hasDivider>
              <VStack gap={2}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <StackItem size="fill">
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      {onBackToOverview && (
                        <Button
                          id="workbench-back-overview"
                          size="sm"
                          variant="ghost"
                          label="← Home"
                          onClick={onBackToOverview}
                        />
                      )}
                      <HStack gap={1.5} vAlign="center">
                        <img
                          src={CONDUIT_MARK_DATA_URI}
                          alt=""
                          width={20}
                          height={20}
                          style={styles.brandMark}
                        />
                        <Heading level={4}>Conduit</Heading>
                      </HStack>
                    </HStack>
                  </StackItem>

                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <DropdownMenu
                      presentation="adaptive"
                      button={{
                        size: 'sm',
                        variant: 'secondary',
                        label: `Scenario: ${SCENARIO_LABELS[scenario]}`,
                      }}
                      items={(
                        Object.keys(SCENARIO_LABELS) as ScenarioPresetId[]
                      ).map(presetKey => ({
                        label: SCENARIO_LABELS[presetKey],
                        onClick: () => applyScenarioPreset(presetKey),
                      }))}
                    />

                    {isScenarioDirty && (
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Reset"
                        onClick={() => applyScenarioPreset(scenario)}
                      />
                    )}
                  </HStack>
                </HStack>

                {/* Commercial Context Strip */}
                <div
                  data-testid="commercial-context-strip"
                  style={styles.contextRow}>
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <StackItem size="fill">
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text type="code" size="2xs" weight="semibold">
                          {activeSession.merchantHost}
                        </Text>
                        <Text
                          type="supporting"
                          color="secondary"
                          hasTabularNumbers>
                          ← {activeSession.buyerAgentId} ·{' '}
                          {activeSession.skuName} (${activeSession.msrpUsd}{' '}
                          MSRP / ${activeSession.marginFloorUsd} floor)
                          {activeSession.selectedOfferLabel
                            ? ` · Selected ${activeSession.selectedOfferLabel}`
                            : ''}
                        </Text>
                      </HStack>
                    </StackItem>

                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <HStack
                        gap={1.5}
                        vAlign="center"
                        data-testid="canonical-stage-pills">
                        {STAGE_ORDER.map((st, idx) => {
                          const isCurrent = idx === metrics.stageIndex;
                          const isPast = idx < metrics.stageIndex;
                          return (
                            <React.Fragment key={st}>
                              {idx > 0 && (
                                <Text type="supporting" color="secondary">
                                  →
                                </Text>
                              )}
                              <Text
                                type="supporting"
                                color={
                                  isCurrent
                                    ? 'primary'
                                    : isPast
                                      ? 'secondary'
                                      : 'disabled'
                                }
                                weight={isCurrent ? 'semibold' : 'normal'}>
                                {st}
                              </Text>
                            </React.Fragment>
                          );
                        })}
                      </HStack>

                      {showReopenButton &&
                        (metrics.heldEventId ? (
                          <Button
                            size="sm"
                            variant="primary"
                            label="Review held quote"
                            onClick={() => {
                              setSelectedEventId(metrics.heldEventId);
                              setIsInspectorOpen(true);
                            }}
                          />
                        ) : metrics.awaitingPassEventId ? (
                          <Button
                            size="sm"
                            variant="primary"
                            label="Review pass request"
                            onClick={() => {
                              setSelectedEventId(metrics.awaitingPassEventId);
                              setIsInspectorOpen(true);
                            }}
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            label="Inspect frame"
                            onClick={() => setIsInspectorOpen(true)}
                          />
                        ))}
                    </HStack>
                  </HStack>
                </div>
              </VStack>
            </LayoutHeader>
          }
          start={
            <>
              <LayoutPanel
                width={sidebarResize.size}
                padding={0}
                hasDivider={false}
                label="Navigation">
                <VStack gap={0}>
                  <div style={styles.sidebarSection}>
                    <VStack gap={1}>
                      <Text type="label" color="secondary">
                        Merchant Sessions
                      </Text>
                      <List density="compact">
                        {sessions.map(sess => {
                          const sm = deriveWorkspaceMetrics(
                            sess,
                            sessions,
                            passes,
                          );
                          return (
                            <ListItem
                              key={sess.id}
                              isSelected={sess.id === activeSession.id}
                              onClick={() => handleSelectSession(sess.id)}
                              startContent={
                                <StatusDot
                                  variant={
                                    sm.proxyHeldCount > 0
                                      ? 'warning'
                                      : sm.awaitingPassCount > 0
                                        ? 'accent'
                                        : sm.stage === 'Fulfill'
                                          ? 'success'
                                          : 'neutral'
                                  }
                                  isPulsing={sm.proxyHeldCount > 0}
                                  label={sm.stage}
                                />
                              }
                              label={sess.merchantName}
                              description={`${sm.stage} · ${
                                sm.proxyHeldCount > 0
                                  ? `${sm.proxyHeldCount} held`
                                  : sm.awaitingPassCount > 0
                                    ? 'awaiting pass'
                                    : sm.stage === 'Fulfill'
                                      ? 'settled'
                                      : `${sm.eventCount} frames`
                              }`}
                            />
                          );
                        })}
                      </List>
                    </VStack>
                  </div>

                  <Divider />

                  <div style={styles.sidebarSection}>
                    <VStack gap={1}>
                      <Text type="label" color="secondary">
                        Surfaces
                      </Text>
                      <List density="compact">
                        <ListItem
                          isSelected={activeSurface === 'overview'}
                          onClick={() => setActiveSurface('overview')}
                          label="Overview"
                          description="Observatory + trace"
                        />
                        <ListItem
                          isSelected={activeSurface === 'graph'}
                          onClick={() => setActiveSurface('graph')}
                          label="Graph"
                          description="Causal topology"
                        />
                        <ListItem
                          isSelected={activeSurface === 'wire'}
                          onClick={() => setActiveSurface('wire')}
                          label="Wire"
                          description="MCP & HTTP packets"
                        />
                        <ListItem
                          isSelected={activeSurface === 'passes'}
                          onClick={() => setActiveSurface('passes')}
                          label="Passes"
                          description="Single-use checkout keys"
                          endContent={
                            metrics.globalAwaitingPassCount > 0 ? (
                              <Text
                                type="supporting"
                                color="secondary"
                                hasTabularNumbers>
                                {metrics.globalAwaitingPassCount}
                              </Text>
                            ) : undefined
                          }
                        />
                      </List>
                    </VStack>
                  </div>

                  <Divider />

                  <div style={styles.sidebarSection}>
                    <VStack gap={1}>
                      <Text type="label" color="secondary">
                        Trace Filters
                      </Text>
                      <List density="compact">
                        <ListItem
                          isSelected={traceFilter === 'all'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('all');
                          }}
                          label="All frames"
                          endContent={
                            <Text
                              type="supporting"
                              color="secondary"
                              hasTabularNumbers>
                              {metrics.eventCount}
                            </Text>
                          }
                        />
                        <ListItem
                          isSelected={traceFilter === 'mcp'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('mcp');
                          }}
                          label="MCP"
                        />
                        <ListItem
                          isSelected={traceFilter === 'http'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('http');
                          }}
                          label="HTTP"
                        />
                        <ListItem
                          isSelected={traceFilter === 'attention'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('attention');
                          }}
                          label="Needs approval"
                          endContent={
                            metrics.proxyHeldCount +
                              metrics.awaitingPassCount >
                            0 ? (
                              <Text
                                type="supporting"
                                color="secondary"
                                hasTabularNumbers>
                                {metrics.proxyHeldCount +
                                  metrics.awaitingPassCount}
                              </Text>
                            ) : undefined
                          }
                        />
                        <ListItem
                          isSelected={traceFilter === 'modified'}
                          onClick={() => {
                            setActiveSurface('overview');
                            setTraceFilter('modified');
                          }}
                          label="Counter-offers"
                        />
                      </List>
                    </VStack>
                  </div>
                </VStack>
              </LayoutPanel>
              <ResizeHandle
                direction="horizontal"
                hasDivider
                resizable={sidebarResize.props}
                label="Resize navigation sidebar"
              />
            </>
          }
          content={
            <LayoutContent role="main" padding={0}>
              <div style={styles.workspaceSplit}>
                <div style={styles.centerColumn}>
                  {activeSurface === 'overview' && (
                    <>
                      <div
                        style={{
                          height: graphHeightResize.size,
                          flexShrink: 0,
                          minHeight: 0,
                          overflow: 'hidden',
                        }}>
                        <CausalObservatoryGraph
                          session={activeSession}
                          selectedEventId={selectedEvent?.id ?? null}
                          onSelectEvent={handleSelectEventFromWorkspace}
                        />
                      </div>

                      <ResizeHandle
                        direction="vertical"
                        hasDivider
                        resizable={graphHeightResize.props}
                        label="Resize Causal Observatory and Execution Trace"
                      />

                      <div style={styles.traceFill}>
                        <DenseTraceTable
                          events={activeSession.events}
                          activeFilter={traceFilter}
                          selectedEventId={selectedEvent?.id ?? null}
                          onSelectEvent={handleSelectEventFromWorkspace}
                          onResetFilter={() => setTraceFilter('all')}
                        />
                      </div>
                    </>
                  )}

                  {activeSurface === 'graph' && (
                    <CausalObservatoryGraph
                      session={activeSession}
                      selectedEventId={selectedEvent?.id ?? null}
                      onSelectEvent={handleSelectEventFromWorkspace}
                      expanded
                    />
                  )}

                  {activeSurface === 'wire' && (
                    <WireSurface
                      session={activeSession}
                      selectedEventId={selectedEvent?.id ?? null}
                      onSelectEvent={id => setSelectedEventId(id)}
                    />
                  )}

                  {activeSurface === 'passes' && (
                    <PassesSurface
                      passes={passes}
                      onRevokePass={handleRevokePass}
                      onApprovePendingPass={handleApprovePendingPassFromLedger}
                    />
                  )}
                </div>

                {showDesktopRightPanel && (
                  <>
                    <ResizeHandle
                      direction="horizontal"
                      isReversed
                      hasDivider
                      resizable={inspectorResize.props}
                      label="Resize inspection panel"
                    />
                    <div
                      style={{
                        ...styles.inspectorPane,
                        width: inspectorResize.size,
                      }}>
                      <CanonicalInspectorPanel
                        session={activeSession}
                        event={selectedEvent}
                        onToggleMutation={handleToggleMutation}
                        onTransmitModified={handleTransmitModified}
                        onForwardOriginal={handleForwardOriginal}
                        onAuthorizePass={handleAuthorizePass}
                        onRejectPass={handleRejectPass}
                        onClose={() => setIsInspectorOpen(false)}
                      />
                    </div>
                  </>
                )}
              </div>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack
                gap={3}
                vAlign="center"
                wrap="wrap"
                data-testid="canonical-status-bar">
                <StackItem size="fill">
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <StatusDot
                      variant={
                        metrics.proxyHeldCount > 0
                          ? 'warning'
                          : metrics.awaitingPassCount > 0
                            ? 'accent'
                            : 'success'
                      }
                      isPulsing={metrics.proxyHeldCount > 0}
                      label="Session status"
                    />
                    <Text
                      type="code"
                      size="2xs"
                      color="secondary"
                      hasTabularNumbers>
                      {activeSession.merchantName} · {metrics.eventCount} frames
                      · {metrics.proxyHeldCount} held ·{' '}
                      {metrics.awaitingPassCount} awaiting pass
                    </Text>
                    <Text type="supporting" color="secondary">
                      · {metrics.stageHeadline}
                    </Text>
                  </HStack>
                </StackItem>

                <HStack gap={2} vAlign="center">
                  <SegmentedControl
                    size="sm"
                    label="Color mode"
                    value={colorMode}
                    onChange={v => handleColorModeChange(v as 'dark' | 'light')}>
                    <SegmentedControlItem value="dark" label="Dark" />
                    <SegmentedControlItem value="light" label="Light" />
                  </SegmentedControl>
                </HStack>
              </HStack>
            </LayoutFooter>
          }
        />
      </div>
    </Theme>
  );
}
