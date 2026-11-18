// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState, type CSSProperties} from 'react';
import {BottomSheet} from '@astryxdesign/core/BottomSheet';
import {Button} from '@astryxdesign/core/Button';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {DropdownMenu} from '@astryxdesign/core/DropdownMenu';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {List, ListItem} from '@astryxdesign/core/List';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import {CONDUIT_MARK_DATA_URI} from './conduitMark';
import {
  deriveWorkspaceMetrics,
  type CapabilityPassRecord,
  type DeliveryPhase,
  type MerchantSession,
  type ScenarioPresetId,
  type TraceEvent,
  type TraceFilterId,
} from './conduitState';
import {filterTraceEvents} from './DenseTraceTable';

export type MobileTabId = 'deal' | 'trace' | 'wire' | 'passes';

export interface ConduitMobileWorkbenchProps {
  sessions: MerchantSession[];
  activeSession: MerchantSession;
  passes: CapabilityPassRecord[];
  scenario: ScenarioPresetId;
  scenarioLabels: Record<ScenarioPresetId, string>;
  isScenarioDirty: boolean;
  selectedEvent: TraceEvent | null;
  traceFilter: TraceFilterId;
  colorMode: 'dark' | 'light';
  onColorModeChange: (mode: 'dark' | 'light') => void;
  onBackToOverview?: () => void;
  onSelectSession: (sessionId: string) => void;
  onApplyScenario: (preset: ScenarioPresetId) => void;
  onSelectEvent: (eventId: string) => void;
  onTraceFilterChange: (filter: TraceFilterId) => void;
  onToggleMutation: (eventId: string, nextEnabled: boolean) => void;
  onTransmitModified: (eventId: string) => void;
  onForwardOriginal: (eventId: string) => void;
  onAuthorizePass: (eventId: string) => void;
  onRejectPass: (eventId: string) => void;
  onRevokePass: (passId: string) => void;
  onApprovePendingPass: (passId: string) => void;
}

const styles: Record<string, CSSProperties> = {
  root: {
    height: '100dvh',
    width: '100vw',
    maxWidth: '100vw',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background-body)',
    color: 'var(--color-text-primary)',
  },
  topBar: {
    padding: '8px 12px',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
  },
  brandMark: {
    width: 18,
    height: 18,
    objectFit: 'contain',
    flexShrink: 0,
  },
  storyTape: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflowX: 'auto',
    padding: '8px 12px',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    flexShrink: 0,
    scrollbarWidth: 'none',
  },
  tapeNode: {
    all: 'unset',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderRadius: 8,
    border: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-card)',
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  tapeNodeSelected: {
    borderColor: 'var(--color-accent)',
    backgroundColor: 'var(--color-accent-muted)',
  },
  tapeNodeHeld: {
    borderColor: 'var(--color-warning)',
  },
  tapeUnreached: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 8,
    border: 'var(--border-width) dashed var(--color-border)',
    opacity: 0.65,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  tapeArrow: {
    color: 'var(--color-text-disabled)',
    fontSize: 11,
    flexShrink: 0,
  },
  stageScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
  },
  skuStrip: {
    padding: '10px 14px',
    backgroundColor: 'var(--color-background-muted)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
  sectionBlock: {
    padding: '12px 14px',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
  traceCardButton: {
    all: 'unset',
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 14px',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  traceCardSelected: {
    backgroundColor: 'var(--color-background-muted)',
  },
  passCard: {
    padding: '12px 14px',
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
  thumbDock: {
    flexShrink: 0,
    backgroundColor: 'var(--color-background-surface)',
    borderTop: 'var(--border-width) solid var(--color-border)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  actionShelf: {
    padding: '8px 12px',
    backgroundColor: 'var(--color-background-muted)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
  navShelf: {
    padding: '8px 12px',
  },
  sheetBody: {
    padding: '14px',
    maxHeight: '68dvh',
    overflowY: 'auto',
  },
};

function shortStatusLabel(phase: DeliveryPhase, status: number | null): string {
  switch (phase) {
    case 'held_at_proxy':
      return 'Held';
    case 'awaiting_pass':
      return 'Pass gate';
    case 'delivered_modified':
      return 'Countered';
    case 'pass_authorized':
      return 'Settled';
    case 'delivered_original':
    case 'observed_inbound':
    default:
      return `${status ?? 200}`;
  }
}

export function ConduitMobileWorkbench({
  sessions,
  activeSession,
  passes,
  scenario,
  scenarioLabels,
  isScenarioDirty,
  selectedEvent,
  traceFilter,
  colorMode,
  onColorModeChange,
  onBackToOverview,
  onSelectSession,
  onApplyScenario,
  onSelectEvent,
  onTraceFilterChange,
  onToggleMutation,
  onTransmitModified,
  onForwardOriginal,
  onAuthorizePass,
  onRejectPass,
  onRevokePass,
  onApprovePendingPass,
}: ConduitMobileWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<MobileTabId>('deal');
  const [wireProto, setWireProto] = useState<'all' | 'MCP' | 'HTTP'>('all');
  const [payloadSheetEvent, setPayloadSheetEvent] =
    useState<TraceEvent | null>(null);

  const metrics = deriveWorkspaceMetrics(activeSession, sessions, passes);
  const heldEvt =
    activeSession.events.find(e => e.deliveryPhase === 'held_at_proxy') ?? null;
  const passGateEvt =
    activeSession.events.find(e => e.deliveryPhase === 'awaiting_pass') ?? null;

  // Primary event shown in the Deal surface: active gate first, otherwise selected event
  const dealEvent = heldEvt ?? passGateEvt ?? selectedEvent;
  const isHeldQuote = dealEvent?.deliveryPhase === 'held_at_proxy';
  const isHistoricalModified =
    dealEvent?.deliveryPhase === 'delivered_modified';
  const isOfferFrame =
    Boolean(dealEvent?.upstreamOffers && dealEvent.upstreamOffers.length > 0) ||
    isHeldQuote ||
    isHistoricalModified;
  const isAwaitingPass = dealEvent?.deliveryPhase === 'awaiting_pass';
  const mutationOn = dealEvent?.mutationEnabled !== false;
  const isFloorLeakReplacement = Boolean(
    dealEvent?.forwardOriginalBlockedReason,
  );
  const upstreamCount = dealEvent?.upstreamOffers?.length ?? 0;
  const proposedCount = mutationOn
    ? isFloorLeakReplacement
      ? upstreamCount
      : upstreamCount + 1
    : upstreamCount;

  const filteredTrace = filterTraceEvents(activeSession.events, traceFilter);
  const wireFrames = activeSession.events.filter(e =>
    wireProto === 'all' ? true : e.protocol === wireProto,
  );
  const activeWireFrame =
    wireFrames.find(f => f.id === selectedEvent?.id) ?? wireFrames[0] ?? null;

  return (
    <div data-testid="conduit-mobile-workbench" style={styles.root}>
      {/* 1. Razor-Thin 1-Row Top Header (<= 46px, Zero Multi-Row Wrapping) */}
      <div style={styles.topBar}>
        <HStack gap={1.5} vAlign="center">
          {onBackToOverview && (
            <Button
              id="workbench-back-overview"
              size="sm"
              variant="ghost"
              label="←"
              aria-label="Back to home"
              onClick={onBackToOverview}
            />
          )}
          <img
            src={CONDUIT_MARK_DATA_URI}
            alt=""
            width={18}
            height={18}
            style={styles.brandMark}
          />
          <StackItem size="fill">
            <DropdownMenu
              presentation="adaptive"
              button={{
                size: 'sm',
                variant: 'secondary',
                label: `${activeSession.merchantName} · ${metrics.stage}`,
              }}
              items={sessions.map(s => {
                const sm = deriveWorkspaceMetrics(s, sessions, passes);
                const suffix =
                  sm.proxyHeldCount > 0
                    ? '1 held'
                    : sm.awaitingPassCount > 0
                      ? 'pass gate'
                      : sm.stage;
                return {
                  label: `${s.merchantName} (${suffix})`,
                  onClick: () => {
                    onSelectSession(s.id);
                    setActiveTab('deal');
                  },
                };
              })}
            />
          </StackItem>

          <DropdownMenu
            presentation="adaptive"
            button={{
              size: 'sm',
              variant: 'ghost',
              label: 'Preset',
            }}
            items={[
              ...(Object.keys(scenarioLabels) as ScenarioPresetId[]).map(
                presetKey => ({
                  label: scenarioLabels[presetKey],
                  onClick: () => {
                    onApplyScenario(presetKey);
                    setActiveTab('deal');
                  },
                }),
              ),
              ...(isScenarioDirty
                ? [
                    {
                      label: 'Reset current scenario',
                      onClick: () => onApplyScenario(scenario),
                    },
                  ]
                : []),
            ]}
          />
        </HStack>
      </div>

      {/* 2. Horizontal Tappable Causal Story Tape (H = 44px, Zero Chopped Card Grid) */}
      <div
        role="region"
        aria-label="Causal story tape"
        data-testid="mobile-story-tape"
        style={styles.storyTape}>
        {activeSession.events.map((ev, idx) => {
          const isSel = selectedEvent?.id === ev.id;
          const isHeld = ev.deliveryPhase === 'held_at_proxy';
          const isGate = ev.deliveryPhase === 'awaiting_pass';

          return (
            <React.Fragment key={ev.id}>
              {idx > 0 && <span style={styles.tapeArrow}>→</span>}
              <button
                type="button"
                data-testid={`mobile-tape-${ev.code}`}
                style={{
                  ...styles.tapeNode,
                  ...(isHeld ? styles.tapeNodeHeld : null),
                  ...(isSel ? styles.tapeNodeSelected : null),
                }}
                onClick={() => {
                  onSelectEvent(ev.id);
                  if (
                    ev.deliveryPhase !== 'held_at_proxy' &&
                    ev.deliveryPhase !== 'awaiting_pass' &&
                    activeTab === 'deal' &&
                    !ev.upstreamOffers
                  ) {
                    setPayloadSheetEvent(ev);
                  }
                }}>
                {(isHeld || isGate) && (
                  <StatusDot
                    variant={isHeld ? 'warning' : 'accent'}
                    isPulsing={isHeld}
                    label={shortStatusLabel(ev.deliveryPhase, ev.httpStatus)}
                  />
                )}
                <Text type="code" size="2xs" weight="semibold">
                  {ev.code}
                </Text>
                <Text type="supporting" size="2xs">
                  {ev.title}
                </Text>
              </button>
            </React.Fragment>
          );
        })}

        {heldEvt && (
          <>
            <span style={styles.tapeArrow}>→</span>
            <div style={styles.tapeUnreached}>
              <Text type="supporting" size="2xs" color="secondary">
                Select Offer (waiting)
              </Text>
            </div>
          </>
        )}
      </div>

      {/* 3. Full-Height Mobile Center Stage (Zero Nested Scroll Traps, Zero Truncated Sentences) */}
      <div style={styles.stageScroll}>
        {/* SKU & Unit Economics Strip */}
        <div style={styles.skuStrip}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <Text type="label">{activeSession.skuName}</Text>
              <Text type="supporting" size="2xs" color="secondary">
                {' '}
                · {activeSession.buyerAgentId}
              </Text>
            </StackItem>
            <Text type="code" size="2xs" color="secondary" hasTabularNumbers>
              ${activeSession.msrpUsd} MSRP · ${activeSession.marginFloorUsd}{' '}
              floor
            </Text>
          </HStack>
        </div>

        {/* TAB 1: DEAL (Thumb-First Quote & Pass Decision Deck, or Wrapped Session Summary) */}
        {activeTab === 'deal' && dealEvent && (
          <VStack gap={0}>
            <div style={styles.sectionBlock}>
              <VStack gap={1}>
                <HStack gap={1.5} vAlign="center">
                  <StatusDot
                    variant={
                      isHeldQuote
                        ? 'warning'
                        : isAwaitingPass
                          ? 'accent'
                          : 'success'
                    }
                    isPulsing={isHeldQuote}
                    label={metrics.stage}
                  />
                  <StackItem size="fill">
                    <Heading level={5}>
                      {isHeldQuote
                        ? `Quote Held · 0 sent to ${dealEvent.targetActor}`
                        : isAwaitingPass
                          ? `Pass Gate · $${dealEvent.passRequest?.requestedCap ?? 0} Cap`
                          : isHistoricalModified
                            ? 'Delivered Counter-Offer'
                            : dealEvent.code === 'C05'
                              ? 'Order Settled'
                              : `${activeSession.trafficProfile}`}
                    </Heading>
                  </StackItem>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="JSON"
                    onClick={() => setPayloadSheetEvent(dealEvent)}
                  />
                </HStack>
                <Text type="supporting" color="secondary">
                  {isHeldQuote
                    ? `${activeSession.merchantName} returned ${upstreamCount} offers. Review below and tap Send at the bottom to release.`
                    : isAwaitingPass
                      ? `${dealEvent.sourceActor} locked ${activeSession.skuName} in cart and awaits a single-use Ed25519 pass.`
                      : dealEvent.observation}
                </Text>
              </VStack>
            </div>

            {isOfferFrame && dealEvent.upstreamOffers && (
              <div style={styles.sectionBlock}>
                <VStack gap={2}>
                  <HStack gap={2} vAlign="center">
                    <StackItem size="fill">
                      <Text type="label" color="secondary">
                        Offers for {dealEvent.targetActor}
                      </Text>
                    </StackItem>
                    <Text
                      type="code"
                      size="2xs"
                      color="secondary"
                      hasTabularNumbers>
                      Floor ${activeSession.marginFloorUsd}
                    </Text>
                  </HStack>

                  <List density="compact" hasDividers>
                    {dealEvent.upstreamOffers.map(off => {
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
                              ? `$${Math.abs(off.marginDelta)} below $${activeSession.marginFloorUsd} floor`
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

                    {dealEvent.stagedOffer &&
                      (isHistoricalModified || mutationOn) && (
                        <ListItem
                          key={dealEvent.stagedOffer.id}
                          startContent={
                            <StatusDot
                              variant="success"
                              label="Conduit counter-offer"
                            />
                          }
                          label={`${dealEvent.stagedOffer.id} · ${dealEvent.stagedOffer.label}`}
                          description={`Conduit counter-offer · +$${dealEvent.stagedOffer.marginDelta} above $${activeSession.marginFloorUsd} floor`}
                          endContent={
                            <Text
                              type="code"
                              size="2xs"
                              weight="semibold"
                              hasTabularNumbers>
                              ${dealEvent.stagedOffer.price}.00
                            </Text>
                          }
                        />
                      )}
                  </List>

                  {dealEvent.stagedOffer && isHeldQuote && (
                    <Switch
                      width="100%"
                      labelSpacing="spread"
                      label={
                        isFloorLeakReplacement
                          ? `Replace $189 leak with $${dealEvent.stagedOffer.price} (${dealEvent.stagedOffer.id})`
                          : `Include $${dealEvent.stagedOffer.price} counter-offer (${dealEvent.stagedOffer.id})`
                      }
                      description={`+$${dealEvent.stagedOffer.marginDelta} above $${activeSession.marginFloorUsd} floor`}
                      value={mutationOn}
                      onChange={val => onToggleMutation(dealEvent.id, val)}
                    />
                  )}
                </VStack>
              </div>
            )}

            {isAwaitingPass && dealEvent.passRequest && (
              <div style={styles.sectionBlock}>
                <VStack gap={1.5}>
                  <Text type="label" color="secondary">
                    Single-Use Pass Scope
                  </Text>
                  <List density="compact" hasDividers>
                    <ListItem
                      label="Pinned SKU"
                      endContent={
                        <Text type="code" size="2xs">
                          {dealEvent.passRequest.sku}
                        </Text>
                      }
                    />
                    <ListItem
                      label="Spend ceiling"
                      endContent={
                        <Text type="code" size="2xs" hasTabularNumbers>
                          ${dealEvent.passRequest.requestedCap}.00 (1 call)
                        </Text>
                      }
                    />
                    <ListItem
                      label="TTL"
                      endContent={
                        <Text type="code" size="2xs" hasTabularNumbers>
                          {dealEvent.passRequest.ttl}
                        </Text>
                      }
                    />
                  </List>
                </VStack>
              </div>
            )}

            {dealEvent.validations && dealEvent.validations.length > 0 && (
              <div style={styles.sectionBlock}>
                <VStack gap={1.5}>
                  <Text type="label" color="secondary">
                    Policy Checks
                  </Text>
                  <List density="compact" hasDividers>
                    {dealEvent.validations.map(v => (
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
              </div>
            )}

            {/* When read-only browsing (DisplayCo) or settled (Cloudstore), show wrapped hop cards right below */}
            {!isHeldQuote && !isAwaitingPass && (
              <div>
                {activeSession.events.map(ev => (
                  <button
                    key={ev.id}
                    type="button"
                    style={{
                      ...styles.traceCardButton,
                      ...(selectedEvent?.id === ev.id
                        ? styles.traceCardSelected
                        : null),
                    }}
                    onClick={() => {
                      onSelectEvent(ev.id);
                      setPayloadSheetEvent(ev);
                    }}>
                    <VStack gap={1}>
                      <HStack gap={2} vAlign="center">
                        <StackItem size="fill">
                          <Text type="label">
                            {ev.code} · {ev.title}
                          </Text>
                        </StackItem>
                        <Text
                          type="code"
                          size="2xs"
                          color="secondary"
                          hasTabularNumbers>
                          {ev.durationLabel} ·{' '}
                          {shortStatusLabel(ev.deliveryPhase, ev.httpStatus)}
                        </Text>
                      </HStack>
                      <Text type="supporting" color="secondary">
                        {ev.observation}
                      </Text>
                    </VStack>
                  </button>
                ))}
              </div>
            )}
          </VStack>
        )}

        {/* TAB 2: TRACE (Wrapped 2-Line Cards, Zero Horizontal Scroll, Zero Ellipsis) */}
        {activeTab === 'trace' && (
          <VStack gap={0}>
            <div style={styles.sectionBlock}>
              <SegmentedControl
                size="sm"
                layout="fill"
                label="Filter trace"
                value={traceFilter}
                onChange={v => onTraceFilterChange(v as TraceFilterId)}>
                <SegmentedControlItem value="all" label="All" />
                <SegmentedControlItem value="mcp" label="MCP" />
                <SegmentedControlItem value="http" label="HTTP" />
                <SegmentedControlItem value="attention" label="Held" />
              </SegmentedControl>
            </div>

            {filteredTrace.map(ev => {
              const isHeld = ev.deliveryPhase === 'held_at_proxy';
              const isGate = ev.deliveryPhase === 'awaiting_pass';
              const dir =
                ev.direction === 'buyer_to_seller'
                  ? 'Buyer → Seller'
                  : ev.direction === 'buyer_to_gate'
                    ? 'Buyer → Conduit'
                    : 'Seller → Buyer';

              return (
                <button
                  key={ev.id}
                  type="button"
                  data-testid={`mobile-trace-card-${ev.code}`}
                  style={{
                    ...styles.traceCardButton,
                    ...(selectedEvent?.id === ev.id
                      ? styles.traceCardSelected
                      : null),
                  }}
                  onClick={() => {
                    onSelectEvent(ev.id);
                    setPayloadSheetEvent(ev);
                  }}>
                  <VStack gap={1}>
                    <HStack gap={1.5} vAlign="center">
                      {(isHeld || isGate) && (
                        <StatusDot
                          variant={isHeld ? 'warning' : 'accent'}
                          isPulsing={isHeld}
                          label={shortStatusLabel(
                            ev.deliveryPhase,
                            ev.httpStatus,
                          )}
                        />
                      )}
                      <StackItem size="fill">
                        <Text type="label">
                          {ev.code} · {ev.title}
                        </Text>
                      </StackItem>
                      <Text
                        type="code"
                        size="2xs"
                        color={isHeld ? 'primary' : 'secondary'}
                        weight={isHeld ? 'semibold' : 'normal'}
                        hasTabularNumbers>
                        {ev.durationLabel}
                      </Text>
                    </HStack>

                    <Text type="supporting" color="secondary">
                      {ev.protocol} · {dir} — {ev.observation}
                    </Text>
                  </VStack>
                </button>
              );
            })}
          </VStack>
        )}

        {/* TAB 3: WIRE (Mobile Packet Selector + Full Wrapped Payload/Diff) */}
        {activeTab === 'wire' && (
          <div data-testid="wire-surface">
            <div style={styles.sectionBlock}>
              <VStack gap={2}>
                <HStack gap={2} vAlign="center">
                  <StackItem size="fill">
                    <Heading level={5}>Wire Evidence</Heading>
                  </StackItem>
                  <SegmentedControl
                    size="sm"
                    label="Protocol"
                    value={wireProto}
                    onChange={v => setWireProto(v as 'all' | 'MCP' | 'HTTP')}>
                    <SegmentedControlItem value="all" label="All" />
                    <SegmentedControlItem value="MCP" label="MCP" />
                    <SegmentedControlItem value="HTTP" label="HTTP" />
                  </SegmentedControl>
                </HStack>

                <HStack gap={1.5} wrap="wrap">
                  {wireFrames.map(f => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={
                        activeWireFrame?.id === f.id ? 'primary' : 'secondary'
                      }
                      label={`${f.code} · ${f.protocol}`}
                      onClick={() => onSelectEvent(f.id)}
                    />
                  ))}
                </HStack>
              </VStack>
            </div>

            {activeWireFrame && (
              <div style={styles.sectionBlock}>
                <VStack gap={2}>
                  <Text type="code" size="2xs" color="secondary">
                    {activeWireFrame.sourceActor} →{' '}
                    {activeWireFrame.targetActor} · {activeWireFrame.timestamp}
                  </Text>

                  {activeWireFrame.wireDiffJson && (
                    <CodeBlock
                      code={activeWireFrame.wireDiffJson}
                      language="json"
                      isDiff
                      size="sm"
                      width="100%"
                      isWrapped
                      title={`${activeWireFrame.code} · Outbound Diff`}
                    />
                  )}

                  <CodeBlock
                    code={activeWireFrame.rawOriginalJson}
                    language="json"
                    size="sm"
                    width="100%"
                    isWrapped
                    title={`${activeWireFrame.code} · ${activeWireFrame.toolOrEndpoint}`}
                  />
                </VStack>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PASSES (Compact 2-Row Scannable Cards — 3 Passes Fit Without Chopping!) */}
        {activeTab === 'passes' && (
          <div data-testid="passes-surface">
            {passes.map(pass => (
              <div key={pass.id} style={styles.passCard}>
                <VStack gap={1.5}>
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
                    <StackItem size="fill">
                      <Text type="code" size="2xs" weight="semibold">
                        {pass.merchantHost}
                      </Text>
                      <Text type="supporting" size="2xs" color="secondary">
                        {' '}
                        · {pass.status}
                      </Text>
                    </StackItem>

                    {pass.status === 'Awaiting Approval' && (
                      <Button
                        size="sm"
                        variant="primary"
                        label={`Issue $${pass.capUsd}`}
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

                  <Text
                    type="supporting"
                    size="2xs"
                    color="secondary"
                    hasTabularNumbers>
                    {pass.sku} · ${pass.capUsd}.00 cap ({pass.remainingCalls}{' '}
                    call) · {pass.ttl} · {pass.buyerAgent}
                  </Text>
                </VStack>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Persistent 2-Tier Bottom Thumb Dock (100% Thumb Reachable, Spatial Constancy) */}
      <div data-testid="mobile-thumb-dock" style={styles.thumbDock}>
        {(activeTab === 'deal' || activeTab === 'trace') &&
          (heldEvt || passGateEvt) && (
          <div style={styles.actionShelf}>
            {heldEvt ? (
              heldEvt.mutationEnabled !== false ? (
                <HStack gap={2}>
                  <Button
                    width="100%"
                    size="sm"
                    variant="primary"
                    label={`Send $${heldEvt.stagedOffer?.price ?? 209} Offer (${
                      heldEvt.forwardOriginalBlockedReason
                        ? (heldEvt.upstreamOffers?.length ?? 2)
                        : (heldEvt.upstreamOffers?.length ?? 2) + 1
                    })`}
                    onClick={() => {
                      onTransmitModified(heldEvt.id);
                      setActiveTab('deal');
                    }}
                  />
                  <Button
                    width="100%"
                    size="sm"
                    variant="secondary"
                    label={`Forward (${heldEvt.upstreamOffers?.length ?? 2})`}
                    isDisabled={Boolean(heldEvt.forwardOriginalBlockedReason)}
                    onClick={() => {
                      onForwardOriginal(heldEvt.id);
                      setActiveTab('deal');
                    }}
                  />
                </HStack>
              ) : heldEvt.forwardOriginalBlockedReason ? (
                <Button
                  width="100%"
                  size="sm"
                  variant="primary"
                  label={`Enable $${heldEvt.stagedOffer?.price ?? 209} Replacement`}
                  onClick={() => onToggleMutation(heldEvt.id, true)}
                />
              ) : (
                <HStack gap={2}>
                  <Button
                    width="100%"
                    size="sm"
                    variant="primary"
                    label={`Forward Original (${heldEvt.upstreamOffers?.length ?? 2})`}
                    onClick={() => onForwardOriginal(heldEvt.id)}
                  />
                  <Button
                    width="100%"
                    size="sm"
                    variant="secondary"
                    label={`Add $${heldEvt.stagedOffer?.price ?? 209}`}
                    onClick={() => onToggleMutation(heldEvt.id, true)}
                  />
                </HStack>
              )
            ) : passGateEvt ? (
              <HStack gap={2}>
                <Button
                  width="100%"
                  size="sm"
                  variant="primary"
                  label={`Issue Pass ($${passGateEvt.passRequest?.requestedCap ?? 0})`}
                  onClick={() => {
                    onAuthorizePass(passGateEvt.id);
                    setActiveTab('deal');
                  }}
                />
                <Button
                  width="100%"
                  size="sm"
                  variant="destructive"
                  label="Reject"
                  onClick={() => onRejectPass(passGateEvt.id)}
                />
              </HStack>
            ) : null}
          </div>
        )}

        <div style={styles.navShelf}>
          <HStack gap={2} vAlign="center">
            <StackItem size="fill">
              <SegmentedControl
                size="sm"
                layout="fill"
                label="Mobile surface"
                value={activeTab}
                onChange={v => setActiveTab(v as MobileTabId)}>
                <SegmentedControlItem
                  value="deal"
                  label={
                    metrics.proxyHeldCount > 0
                      ? 'Deal (1)'
                      : metrics.awaitingPassCount > 0
                        ? 'Pass (1)'
                        : 'Deal'
                  }
                />
                <SegmentedControlItem value="trace" label="Trace" />
                <SegmentedControlItem value="wire" label="Wire" />
                <SegmentedControlItem value="passes" label="Passes" />
              </SegmentedControl>
            </StackItem>
            <Button
              size="sm"
              variant="ghost"
              label={colorMode === 'dark' ? 'Light' : 'Dark'}
              aria-label={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} mode`}
              onClick={() =>
                onColorModeChange(colorMode === 'dark' ? 'light' : 'dark')
              }
            />
          </HStack>
        </div>
      </div>

      {/* On-Demand Raw Wire JSON Sheet */}
      <BottomSheet
        isOpen={Boolean(payloadSheetEvent)}
        onOpenChange={open => {
          if (!open) setPayloadSheetEvent(null);
        }}
        label="Packet wire payload"
        height="capped"
        padding={0}>
        {payloadSheetEvent && (
          <div style={styles.sheetBody}>
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <StackItem size="fill">
                  <Heading level={5}>
                    {payloadSheetEvent.code} · {payloadSheetEvent.title}
                  </Heading>
                </StackItem>
                <Button
                  size="sm"
                  variant="ghost"
                  label="Close"
                  onClick={() => setPayloadSheetEvent(null)}
                />
              </HStack>

              <Text type="code" size="2xs" color="secondary">
                {payloadSheetEvent.sourceActor} →{' '}
                {payloadSheetEvent.targetActor}
              </Text>

              <Divider />

              {payloadSheetEvent.wireDiffJson ? (
                <CodeBlock
                  code={payloadSheetEvent.wireDiffJson}
                  language="json"
                  isDiff
                  size="sm"
                  width="100%"
                  isWrapped
                  title={`${payloadSheetEvent.code} · Wire Diff`}
                />
              ) : (
                <CodeBlock
                  code={payloadSheetEvent.rawOriginalJson}
                  language="json"
                  size="sm"
                  width="100%"
                  isWrapped
                  title={`${payloadSheetEvent.code} · ${payloadSheetEvent.toolOrEndpoint}`}
                />
              )}
            </VStack>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
