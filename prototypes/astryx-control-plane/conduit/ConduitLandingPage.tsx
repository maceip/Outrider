// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState, type CSSProperties} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Heading, Text} from '@astryxdesign/core/Text';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {Theme} from '@astryxdesign/core/theme';
import {
  CONDUIT_ILLUSTRATIONS,
  type ConduitIllustrationId,
} from './conduitIllustrations';
import {CONDUIT_MARK_DATA_URI} from './conduitMark';
import {conduitTheme} from './conduitTheme';
import type {ScenarioPresetId} from './conduitState';

type StoreProtectionMode = 'protected' | 'unprotected';
type TrafficStageMode = 'browse' | 'negotiate';
type QuoteStageMode = 'counter_209' | 'leak_179';
type PassStageMode = 'first_call' | 'bot_retry' | 'ttl_15m';
type VisitorId = 'chatgpt' | 'claude' | 'coupon_bot' | 'procurement';
type InstallMode = 'binary' | 'cargo';

interface LiveVisitor {
  id: VisitorId;
  agent: string;
  intent: string;
  latency: string;
  verdict: string;
  dot: 'success' | 'warning' | 'accent';
  illustration: ConduitIllustrationId;
  headline: string;
  detail: string;
  marginNote: string;
  scenario: ScenarioPresetId;
}

const LIVE_VISITORS: ReadonlyArray<LiveVisitor> = [
  {
    id: 'chatgpt',
    agent: 'ChatGPT Shopping',
    intent: 'Compare 5K display specs',
    latency: '2.0 ms',
    verdict: 'Passed',
    dot: 'success',
    illustration: 'agentSync',
    headline: 'Real buyer researching specs — answered in 2 ms.',
    detail:
      'No CAPTCHA, no bot block. Your catalog stays in the shortlist while Conduit logs the visit silently.',
    marginNote: '0 friction · 100% pass-through',
    scenario: 'discovery_95pct',
  },
  {
    id: 'coupon_bot',
    agent: 'CouponHunter-v4',
    intent: 'Stack promos to $179.99',
    latency: 'Held',
    verdict: 'Countered $209',
    dot: 'warning',
    illustration: 'offerSelect',
    headline: 'Below-floor $179.99 caught — countered at $209.',
    detail:
      'The bot never sees the accidental clearance leak. Conduit swaps in your approved $209 Studio Promo above your $198 floor.',
    marginNote: '+$11.00 above $198 floor',
    scenario: 'floor_leak_blocked',
  },
  {
    id: 'procurement',
    agent: 'Acme Procurement',
    intent: 'Buy 1× Studio Wireless X',
    latency: 'Signed',
    verdict: '1-use pass',
    dot: 'accent',
    illustration: 'cardOk',
    headline: 'Verified buyer — issued a 1-call $209 pass.',
    detail:
      'Ed25519 pass pins checkout to SKU SWX-BLK-01, $209 ceiling, 1 call, and a 15-minute expiry.',
    marginNote: '$209.00 settled · 0 replay risk',
    scenario: 'post_release_pass',
  },
  {
    id: 'claude',
    agent: 'Claude Desktop',
    intent: 'Check 2-day Austin stock',
    latency: '1.8 ms',
    verdict: 'Passed',
    dot: 'success',
    illustration: 'flowGate',
    headline: 'Inventory check routed down the fast lane.',
    detail:
      'Read-only MCP tool calls bypass human review automatically so real buyers get instant answers.',
    marginNote: 'Fast lane · 0 operator noise',
    scenario: 'live_hold_r02',
  },
];

const INSTALL_SNIPPETS: Record<InstallMode, string> = {
  binary: `# Download native app (macOS · Windows · Linux) and launch:
outrider --web --port 9090`,
  cargo: `# Build single Rust binary locally from source:
cargo build --release -p proxyfor --bin outrider
./target/release/outrider --web`,
};

const styles: Record<string, CSSProperties> = {
  pageRoot: {
    minHeight: '100dvh',
    width: '100%',
    backgroundColor: 'var(--color-background-body)',
    color: 'var(--color-text-primary)',
    display: 'flex',
    flexDirection: 'column',
  },
  stickyNav: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    backgroundColor: 'var(--color-background-surface)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
  navInner: {
    maxWidth: 1140,
    marginInline: 'auto',
    padding: 'var(--spacing-3) var(--spacing-5)',
  },
  brandMark: {
    width: 22,
    height: 22,
    objectFit: 'contain',
    flexShrink: 0,
  },
  navLink: {
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: 'var(--text-supporting-size)',
  },
  mainContainer: {
    maxWidth: 1140,
    width: '100%',
    marginInline: 'auto',
    padding: '0 var(--spacing-5)',
    boxSizing: 'border-box',
    flex: 1,
  },
  heroSection: {
    paddingTop: '52px',
    paddingBottom: '64px',
  },
  sectionBand: {
    paddingTop: '64px',
    paddingBottom: '64px',
    borderTop: 'var(--border-width) solid var(--color-border)',
  },
  heroLedeWrap: {
    maxWidth: 600,
  },
  simulatorShell: {
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  simulatorHeader: {
    padding: 'var(--spacing-3) var(--spacing-5)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
  },
  simulatorBody: {
    padding: 'var(--spacing-4) var(--spacing-5)',
  },
  simulatorFooter: {
    padding: 'var(--spacing-3) var(--spacing-5)',
    borderTop: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
  },
  stageCard: {
    padding: 'var(--spacing-4)',
    backgroundColor: 'var(--color-background-card)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 'var(--spacing-3)',
  },
  interactiveCanvas: {
    position: 'relative',
    width: '100%',
    height: 158,
    borderRadius: 8,
    backgroundColor: 'var(--color-background-muted)',
    border: 'var(--border-width) solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
    userSelect: 'none',
    transition: 'border-color 160ms ease, transform 160ms ease',
  },
  canvasTopBar: {
    position: 'absolute',
    top: 8,
    left: 10,
    right: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    pointerEvents: 'none',
  },
  canvasHint: {
    position: 'absolute',
    bottom: 6,
    right: 10,
    pointerEvents: 'none',
    opacity: 0.72,
  },
  illustrationImg: {
    width: 236,
    height: 132,
    objectFit: 'contain',
    display: 'block',
    marginTop: 8,
    transition: 'transform 180ms ease, opacity 180ms ease',
  },
  visitorDetailPane: {
    padding: 'var(--spacing-5)',
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 'var(--spacing-4)',
  },
  visitorIllustrationBox: {
    position: 'relative',
    width: '100%',
    height: 176,
    borderRadius: 8,
    backgroundColor: 'var(--color-background-muted)',
    border: 'var(--border-width) solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  footerBar: {
    borderTop: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  footerInner: {
    maxWidth: 1140,
    marginInline: 'auto',
    padding: 'var(--spacing-5)',
  },
};

export interface ConduitLandingPageProps {
  colorMode: 'dark' | 'light';
  onColorModeChange: (mode: 'dark' | 'light') => void;
  onLaunchConsole: (scenario?: ScenarioPresetId) => void;
}

export function ConduitLandingPage({
  colorMode,
  onColorModeChange,
  onLaunchConsole,
}: ConduitLandingPageProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [protectionMode, setProtectionMode] =
    useState<StoreProtectionMode>('protected');
  const [trafficMode, setTrafficMode] = useState<TrafficStageMode>('browse');
  const [quoteMode, setQuoteMode] = useState<QuoteStageMode>('counter_209');
  const [passMode, setPassMode] = useState<PassStageMode>('first_call');
  const [selectedVisitorId, setSelectedVisitorId] =
    useState<VisitorId>('coupon_bot');
  const [installMode, setInstallMode] = useState<InstallMode>('binary');

  const handleProtectionSwitch = (mode: StoreProtectionMode) => {
    setProtectionMode(mode);
    if (mode === 'unprotected') {
      setTrafficMode('negotiate');
      setQuoteMode('leak_179');
      setPassMode('bot_retry');
    } else {
      setTrafficMode('browse');
      setQuoteMode('counter_209');
      setPassMode('first_call');
    }
  };

  // Stage 1 derived state
  const stage1Illustration: ConduitIllustrationId =
    trafficMode === 'browse' ? 'agentSync' : 'flowGate';
  const stage1Status =
    protectionMode === 'unprotected'
      ? 'Unchecked bot scrape'
      : trafficMode === 'browse'
        ? '2 ms fast lane'
        : 'Gate armed (< 2 ms)';
  const stage1Dot: 'success' | 'warning' | 'accent' =
    protectionMode === 'unprotected'
      ? 'warning'
      : trafficMode === 'browse'
        ? 'success'
        : 'accent';
  const stage1Copy =
    protectionMode === 'unprotected'
      ? 'Bots hammer promos with zero visibility — or get CAPTCHA-blocked alongside real buyers.'
      : trafficMode === 'browse'
        ? 'ChatGPT & Claude already shop for real buyers. 95% of catalog reads fly straight through.'
        : 'Price negotiation detected on frame 1 — Conduit routes outbound offers through your floor gate.';

  // Stage 2 derived state
  const effectiveQuote =
    protectionMode === 'unprotected' ? 'leak_179' : quoteMode;
  const stage2Illustration: ConduitIllustrationId =
    effectiveQuote === 'leak_179' ? 'priceQuote' : 'offerSelect';
  const stage2Status =
    protectionMode === 'unprotected'
      ? '$179.99 LEAKED (-$18)'
      : effectiveQuote === 'leak_179'
        ? '$179.99 HELD AT EDGE'
        : '$209.00 APPROVED (+$11)';
  const stage2Dot: 'success' | 'warning' =
    effectiveQuote === 'leak_179' ? 'warning' : 'success';
  const stage2Copy =
    protectionMode === 'unprotected'
      ? 'Stacked promo leak escapes at $179.99 — $18.01 below your $198 margin floor.'
      : effectiveQuote === 'leak_179'
        ? 'Accidental $179.99 held mid-flight before the buyer bot sees it. Click to counter at $209.'
        : 'Your $209 Studio Promo wins the sale safely — $11.00 above your $198 floor.';

  // Stage 3 derived state
  const stage3Illustration: ConduitIllustrationId =
    protectionMode === 'unprotected'
      ? 'cardBlocked'
      : passMode === 'first_call'
        ? 'cardOk'
        : passMode === 'bot_retry'
          ? 'cardBlocked'
          : 'cardClock';
  const stage3Status =
    protectionMode === 'unprotected'
      ? '2× LOOP CHARGE RISK'
      : passMode === 'first_call'
        ? '1ST CALL SETTLED ✓'
        : passMode === 'bot_retry'
          ? '2ND CALL BLOCKED ×'
          : '15M AUTO-EXPIRY';
  const stage3Dot: 'success' | 'warning' | 'accent' =
    protectionMode === 'unprotected'
      ? 'warning'
      : passMode === 'first_call'
        ? 'success'
        : 'accent';
  const stage3Copy =
    protectionMode === 'unprotected'
      ? 'Reusable checkout session lets a looping agent double-submit or swap SKUs.'
      : passMode === 'first_call'
        ? 'Ed25519 pass settles $209 once for SKU SWX-BLK-01, then drops quota to 0.'
        : passMode === 'bot_retry'
          ? 'Agent retries checkout — rejected instantly at the edge. $0 extra charged.'
          : 'Unspent passes expire automatically in 15 minutes or revoke in one click.';

  const activeVisitor =
    LIVE_VISITORS.find(v => v.id === selectedVisitorId) ?? LIVE_VISITORS[0];

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <div data-testid="conduit-landing-page" style={styles.pageRoot}>
        <style>{`
          nextjs-portal { display: none !important; }
          .conduit-stage-canvas:hover {
            border-color: var(--color-border-emphasized) !important;
          }
          .conduit-stage-canvas:hover img {
            transform: scale(1.025);
          }
        `}</style>

        {/* Sticky top navigation */}
        <header style={styles.stickyNav}>
          <div style={styles.navInner}>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <HStack gap={4} vAlign="center" wrap="wrap">
                  <HStack gap={2} vAlign="center">
                    <img
                      src={CONDUIT_MARK_DATA_URI}
                      alt="Conduit emblem"
                      width={22}
                      height={22}
                      style={styles.brandMark}
                    />
                    <Heading level={4}>Conduit</Heading>
                    <Text type="supporting" color="secondary">
                      by Outrider
                    </Text>
                  </HStack>

                  {!isMobile && (
                    <nav aria-label="Product sections">
                      <HStack gap={4} vAlign="center">
                        <a href="#simulator" style={styles.navLink}>
                          Interactive demo
                        </a>
                        <a href="#how-it-works" style={styles.navLink}>
                          Live visitors
                        </a>
                        <a href="#install" style={styles.navLink}>
                          Local install
                        </a>
                      </HStack>
                    </nav>
                  )}
                </HStack>
              </StackItem>

              <HStack gap={2} vAlign="center" wrap="wrap">
                <SegmentedControl
                  size="sm"
                  label="Color mode"
                  value={colorMode}
                  onChange={v => onColorModeChange(v as 'dark' | 'light')}>
                  <SegmentedControlItem value="dark" label="Dark" />
                  <SegmentedControlItem value="light" label="Light" />
                </SegmentedControl>

                {!isMobile && (
                  <Button
                    id="nav-download-release"
                    size="sm"
                    variant="ghost"
                    label="Releases"
                    href="https://github.com/maceip/Outrider/releases/latest"
                  />
                )}

                <Button
                  id="nav-launch-console"
                  size="sm"
                  variant="primary"
                  label={isMobile ? 'Control Plane →' : 'Open Control Plane →'}
                  onClick={() => onLaunchConsole('live_hold_r02')}
                />
              </HStack>
            </HStack>
          </div>
        </header>

        {/* Main landing content */}
        <main style={styles.mainContainer}>
          <VStack gap={0}>
            {/* HERO + INTERACTIVE STOREFRONT SIMULATOR */}
            <section
              aria-labelledby="hero-heading"
              style={styles.heroSection}>
              <VStack gap={8}>
                <VStack gap={4}>
                  <Text type="label" color="secondary">
                    KNOWN · SCOPED · WELCOME
                  </Text>

                  <Heading level={1} type="display-2" textWrap="balance">
                    <span id="hero-heading">
                      Agents are already shopping. Usher them in without losing
                      money.
                    </span>
                  </Heading>

                  <div style={styles.heroLedeWrap}>
                    <Text type="body" color="secondary" textWrap="pretty">
                      Blocking bots turns away real buyers. Leaving endpoints
                      open bleeds margin. Conduit welcomes AI shoppers on your
                      terms.
                    </Text>
                  </div>

                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <Button
                      id="hero-launch-console"
                      size="lg"
                      variant="primary"
                      label="Open Full Control Plane →"
                      onClick={() => onLaunchConsole('live_hold_r02')}
                    />
                    <Button
                      id="hero-download-binary"
                      size="lg"
                      variant="secondary"
                      label="Download Local App"
                      href="https://github.com/maceip/Outrider/releases/latest"
                    />
                  </HStack>
                </VStack>

                {/* Interactive Storefront Simulator */}
                <div id="simulator" style={styles.simulatorShell}>
                  <div style={styles.simulatorHeader}>
                    <HStack gap={3} vAlign="center" wrap="wrap">
                      <StackItem size="fill">
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <StatusDot
                            variant={
                              protectionMode === 'protected'
                                ? 'success'
                                : 'warning'
                            }
                            label="Storefront mode"
                          />
                          <Text type="code" size="2xs" hasTabularNumbers>
                            STUDIO WIRELESS X · $229 MSRP · $198 FLOOR
                          </Text>
                        </HStack>
                      </StackItem>

                      <SegmentedControl
                        size="sm"
                        label="Storefront protection mode"
                        value={protectionMode}
                        onChange={v =>
                          handleProtectionSwitch(v as StoreProtectionMode)
                        }>
                        <SegmentedControlItem
                          value="protected"
                          label={
                            isMobile ? 'Conduit ON' : 'Conduit ON (+$11 margin)'
                          }
                        />
                        <SegmentedControlItem
                          value="unprotected"
                          label={
                            isMobile
                              ? 'Unprotected'
                              : 'Unprotected (-$18 leak)'
                          }
                        />
                      </SegmentedControl>
                    </HStack>
                  </div>

                  <div style={styles.simulatorBody}>
                    <Grid
                      columns={{minWidth: 270, max: 3, repeat: 'fit'}}
                      gap={3}>
                      {/* Interactive Stage 01 */}
                      <div style={styles.stageCard}>
                        <VStack gap={3}>
                          <div
                            id="stage-canvas-traffic"
                            role="button"
                            tabIndex={0}
                            aria-label="Toggle agent traffic type"
                            className="conduit-stage-canvas"
                            style={styles.interactiveCanvas}
                            onClick={() => {
                              setProtectionMode('protected');
                              setTrafficMode(m =>
                                m === 'browse' ? 'negotiate' : 'browse',
                              );
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setProtectionMode('protected');
                                setTrafficMode(m =>
                                  m === 'browse' ? 'negotiate' : 'browse',
                                );
                              }
                            }}>
                            <div style={styles.canvasTopBar}>
                              <HStack gap={1} vAlign="center">
                                <StatusDot
                                  variant={stage1Dot}
                                  label={stage1Status}
                                />
                                <Text
                                  type="code"
                                  size="2xs"
                                  color="secondary"
                                  hasTabularNumbers>
                                  {stage1Status}
                                </Text>
                              </HStack>
                            </div>

                            <img
                              src={
                                CONDUIT_ILLUSTRATIONS[stage1Illustration][
                                  colorMode
                                ]
                              }
                              alt="Agent and storefront live traffic diagram"
                              width={236}
                              height={132}
                              style={styles.illustrationImg}
                            />

                            <div style={styles.canvasHint}>
                              <Text type="code" size="2xs" color="secondary">
                                click to toggle
                              </Text>
                            </div>
                          </div>

                          <SegmentedControl
                            size="sm"
                            label="Traffic type"
                            value={trafficMode}
                            onChange={v => {
                              setProtectionMode('protected');
                              setTrafficMode(v as TrafficStageMode);
                            }}>
                            <SegmentedControlItem
                              value="browse"
                              label="Browse (2 ms)"
                            />
                            <SegmentedControlItem
                              value="negotiate"
                              label="Price Hunt"
                            />
                          </SegmentedControl>

                          <VStack gap={1}>
                            <Text type="code" size="2xs" color="accent">
                              01 · ALREADY AT YOUR DOOR
                            </Text>
                            <Heading level={4}>
                              Buyers send agents first.
                            </Heading>
                            <Text type="supporting" color="secondary">
                              {stage1Copy}
                            </Text>
                          </VStack>
                        </VStack>
                      </div>

                      {/* Interactive Stage 02 */}
                      <div style={styles.stageCard}>
                        <VStack gap={3}>
                          <div
                            id="stage-canvas-quote"
                            role="button"
                            tabIndex={0}
                            aria-label="Toggle quote floor protection"
                            className="conduit-stage-canvas"
                            style={styles.interactiveCanvas}
                            onClick={() => {
                              setProtectionMode('protected');
                              setQuoteMode(m =>
                                m === 'leak_179' ? 'counter_209' : 'leak_179',
                              );
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setProtectionMode('protected');
                                setQuoteMode(m =>
                                  m === 'leak_179' ? 'counter_209' : 'leak_179',
                                );
                              }
                            }}>
                            <div style={styles.canvasTopBar}>
                              <HStack gap={1} vAlign="center">
                                <StatusDot
                                  variant={stage2Dot}
                                  label={stage2Status}
                                />
                                <Text
                                  type="code"
                                  size="2xs"
                                  color="secondary"
                                  hasTabularNumbers>
                                  {stage2Status}
                                </Text>
                              </HStack>
                            </div>

                            <img
                              src={
                                CONDUIT_ILLUSTRATIONS[stage2Illustration][
                                  colorMode
                                ]
                              }
                              alt="Outbound store quote floor enforcement diagram"
                              width={236}
                              height={132}
                              style={styles.illustrationImg}
                            />

                            <div style={styles.canvasHint}>
                              <Text type="code" size="2xs" color="secondary">
                                click to counter
                              </Text>
                            </div>
                          </div>

                          <SegmentedControl
                            size="sm"
                            label="Quote state"
                            value={effectiveQuote}
                            onChange={v => {
                              setProtectionMode('protected');
                              setQuoteMode(v as QuoteStageMode);
                            }}>
                            <SegmentedControlItem
                              value="leak_179"
                              label="$179 Leak"
                            />
                            <SegmentedControlItem
                              value="counter_209"
                              label="$209 Floor ✓"
                            />
                          </SegmentedControl>

                          <VStack gap={1}>
                            <Text type="code" size="2xs" color="accent">
                              02 · MARGIN NEVER LEAKS
                            </Text>
                            <Heading level={4}>
                              Every quote clears your floor.
                            </Heading>
                            <Text type="supporting" color="secondary">
                              {stage2Copy}
                            </Text>
                          </VStack>
                        </VStack>
                      </div>

                      {/* Interactive Stage 03 */}
                      <div style={styles.stageCard}>
                        <VStack gap={3}>
                          <div
                            id="stage-canvas-pass"
                            role="button"
                            tabIndex={0}
                            aria-label="Cycle single-use pass states"
                            className="conduit-stage-canvas"
                            style={styles.interactiveCanvas}
                            onClick={() => {
                              setProtectionMode('protected');
                              setPassMode(m =>
                                m === 'first_call'
                                  ? 'bot_retry'
                                  : m === 'bot_retry'
                                    ? 'ttl_15m'
                                    : 'first_call',
                              );
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setProtectionMode('protected');
                                setPassMode(m =>
                                  m === 'first_call'
                                    ? 'bot_retry'
                                    : m === 'bot_retry'
                                      ? 'ttl_15m'
                                      : 'first_call',
                                );
                              }
                            }}>
                            <div style={styles.canvasTopBar}>
                              <HStack gap={1} vAlign="center">
                                <StatusDot
                                  variant={stage3Dot}
                                  label={stage3Status}
                                />
                                <Text
                                  type="code"
                                  size="2xs"
                                  color="secondary"
                                  hasTabularNumbers>
                                  {stage3Status}
                                </Text>
                              </HStack>
                            </div>

                            <img
                              src={
                                CONDUIT_ILLUSTRATIONS[stage3Illustration][
                                  colorMode
                                ]
                              }
                              alt="Scoped payment card capability state"
                              width={236}
                              height={132}
                              style={styles.illustrationImg}
                            />

                            <div style={styles.canvasHint}>
                              <Text type="code" size="2xs" color="secondary">
                                click to test retry
                              </Text>
                            </div>
                          </div>

                          <SegmentedControl
                            size="sm"
                            label="Checkout pass state"
                            value={passMode}
                            onChange={v => {
                              setProtectionMode('protected');
                              setPassMode(v as PassStageMode);
                            }}>
                            <SegmentedControlItem
                              value="first_call"
                              label="1st Call"
                            />
                            <SegmentedControlItem
                              value="bot_retry"
                              label="Bot Retry"
                            />
                            <SegmentedControlItem
                              value="ttl_15m"
                              label="15m TTL"
                            />
                          </SegmentedControl>

                          <VStack gap={1}>
                            <Text type="code" size="2xs" color="accent">
                              03 · NO BLANK CHECKS
                            </Text>
                            <Heading level={4}>
                              One pass. One SKU. One charge.
                            </Heading>
                            <Text type="supporting" color="secondary">
                              {stage3Copy}
                            </Text>
                          </VStack>
                        </VStack>
                      </div>
                    </Grid>
                  </div>

                  <div style={styles.simulatorFooter}>
                    <HStack gap={3} vAlign="center" wrap="wrap">
                      <StackItem size="fill">
                        <Text
                          type="code"
                          size="2xs"
                          color={
                            protectionMode === 'protected'
                              ? 'accent'
                              : 'secondary'
                          }
                          hasTabularNumbers>
                          {protectionMode === 'protected'
                            ? 'NET RESULT: Buyer welcomed · $209.00 collected (+$11.00 above floor) · 0 replay risk'
                            : 'NET RESULT: $179.99 leaked (-$18.01 below floor) · Duplicate retry exposed'}
                        </Text>
                      </StackItem>

                      <Button
                        id="simulator-open-console"
                        size="sm"
                        variant="primary"
                        label="Inspect Live Trace in Control Plane →"
                        onClick={() =>
                          onLaunchConsole(
                            protectionMode === 'unprotected' ||
                              effectiveQuote === 'leak_179'
                              ? 'floor_leak_blocked'
                              : passMode !== 'first_call'
                                ? 'post_release_pass'
                                : 'live_hold_r02',
                          )
                        }
                      />
                    </HStack>
                  </div>
                </div>
              </VStack>
            </section>

            {/* INTERACTIVE LIVE VISITOR FEED */}
            <section
              id="how-it-works"
              aria-labelledby="how-heading"
              style={styles.sectionBand}>
              <VStack gap={6}>
                <VStack gap={2}>
                  <Text type="label" color="secondary">
                    SLOWED DOWN · NEVER THROWN OUT
                  </Text>
                  <Heading level={2}>
                    <span id="how-heading">
                      Click any visiting agent to watch Conduit decide.
                    </span>
                  </Heading>
                </VStack>

                <Grid columns={{minWidth: 300, max: 2, repeat: 'fit'}} gap={4}>
                  {/* Left: Interactive 4-visitor selector */}
                  <VStack gap={2}>
                    {LIVE_VISITORS.map(visitor => {
                      const active = visitor.id === activeVisitor.id;
                      return (
                        <ClickableCard
                          key={visitor.id}
                          id={`visitor-card-${visitor.id}`}
                          variant={active ? 'filled' : 'outlined'}
                          padding="md"
                          onClick={() => setSelectedVisitorId(visitor.id)}>
                          <HStack gap={3} vAlign="center">
                            <StatusDot
                              variant={visitor.dot}
                              label={visitor.verdict}
                            />
                            <StackItem size="fill">
                              <VStack gap={0}>
                                <Heading level={5}>{visitor.agent}</Heading>
                                <Text type="supporting" color="secondary">
                                  {visitor.intent}
                                </Text>
                              </VStack>
                            </StackItem>
                            <VStack gap={0} hAlign="end">
                              <Text
                                type="code"
                                size="2xs"
                                color="accent"
                                hasTabularNumbers>
                                {visitor.verdict}
                              </Text>
                              <Text
                                type="code"
                                size="2xs"
                                color="secondary"
                                hasTabularNumbers>
                                {visitor.latency}
                              </Text>
                            </VStack>
                          </HStack>
                        </ClickableCard>
                      );
                    })}
                  </VStack>

                  {/* Right: Live decision stage */}
                  <div style={styles.visitorDetailPane}>
                    <VStack gap={3}>
                      <div style={styles.visitorIllustrationBox}>
                        <div style={styles.canvasTopBar}>
                          <Text type="code" size="2xs" color="secondary">
                            {activeVisitor.agent}
                          </Text>
                          <Text
                            type="code"
                            size="2xs"
                            color="accent"
                            hasTabularNumbers>
                            {activeVisitor.marginNote}
                          </Text>
                        </div>

                        <img
                          src={
                            CONDUIT_ILLUSTRATIONS[activeVisitor.illustration][
                              colorMode
                            ]
                          }
                          alt={activeVisitor.headline}
                          width={256}
                          height={144}
                          style={styles.illustrationImg}
                        />
                      </div>

                      <VStack gap={1}>
                        <Heading level={4}>{activeVisitor.headline}</Heading>
                        <Text type="supporting" color="secondary">
                          {activeVisitor.detail}
                        </Text>
                      </VStack>
                    </VStack>

                    <VStack gap={3}>
                      <Divider />
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <StackItem size="fill">
                          <Text type="code" size="2xs" color="secondary">
                            Signed Ed25519 receipt logged locally
                          </Text>
                        </StackItem>
                        <Button
                          id="visitor-open-scenario"
                          size="sm"
                          variant="primary"
                          label="Replay in Control Plane →"
                          onClick={() =>
                            onLaunchConsole(activeVisitor.scenario)
                          }
                        />
                      </HStack>
                    </VStack>
                  </div>
                </Grid>
              </VStack>
            </section>

            {/* LOCAL INSTALL */}
            <section
              id="install"
              aria-labelledby="install-heading"
              style={styles.sectionBand}>
              <Grid columns={{minWidth: 300, max: 2, repeat: 'fit'}} gap={6}>
                <VStack gap={4}>
                  <VStack gap={2}>
                    <Text type="label" color="secondary">
                      LOCAL BY DEFAULT
                    </Text>
                    <Heading level={2}>
                      <span id="install-heading">
                        Your hardware. Your floor. Zero middlemen.
                      </span>
                    </Heading>
                    <Text type="body" color="secondary">
                      One native Rust binary. Pricing floors and signing keys
                      never leave your machine.
                    </Text>
                  </VStack>

                  <MetadataList
                    columns="single"
                    label={{position: 'start', width: 100}}>
                    <MetadataListItem label="Binary">
                      <Text type="supporting">
                        Native Rust · macOS, Windows, Linux
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Budget">
                      <Text type="supporting" hasTabularNumbers>
                        &lt; 2 ms inline · fail-open switch
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Release">
                      <Text type="code" size="2xs">
                        Outrider v0.5.19
                      </Text>
                    </MetadataListItem>
                  </MetadataList>
                </VStack>

                <VStack gap={3}>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <StackItem size="fill">
                      <Text type="label" color="secondary">
                        RUN LOCALLY IN 30 SECONDS
                      </Text>
                    </StackItem>
                    <SegmentedControl
                      size="sm"
                      label="Install method"
                      value={installMode}
                      onChange={v => setInstallMode(v as InstallMode)}>
                      <SegmentedControlItem value="binary" label="Binary" />
                      <SegmentedControlItem value="cargo" label="Cargo" />
                    </SegmentedControl>
                  </HStack>

                  <CodeBlock
                    language="bash"
                    code={INSTALL_SNIPPETS[installMode]}
                    showLineNumbers={false}
                  />

                  <HStack gap={2} wrap="wrap">
                    <Button
                      id="install-launch-console"
                      size="sm"
                      variant="primary"
                      label="Open Full Control Plane →"
                      onClick={() => onLaunchConsole('live_hold_r02')}
                    />
                    <Button
                      id="install-view-github"
                      size="sm"
                      variant="secondary"
                      label="GitHub Repository"
                      href="https://github.com/maceip/Outrider"
                    />
                  </HStack>
                </VStack>
              </Grid>
            </section>
          </VStack>
        </main>

        {/* Footer */}
        <footer style={styles.footerBar}>
          <div style={styles.footerInner}>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <img
                    src={CONDUIT_MARK_DATA_URI}
                    alt=""
                    width={18}
                    height={18}
                    style={styles.brandMark}
                  />
                  <Text type="supporting" color="secondary">
                    Conduit · Known. Scoped. Welcome.
                  </Text>
                </HStack>
              </StackItem>

              <HStack gap={3} vAlign="center" wrap="wrap">
                <Button
                  id="footer-launch-console"
                  size="sm"
                  variant="ghost"
                  label="Control Plane"
                  onClick={() => onLaunchConsole('live_hold_r02')}
                />
                <Button
                  id="footer-github"
                  size="sm"
                  variant="ghost"
                  label="GitHub"
                  href="https://github.com/maceip/Outrider"
                />
                <Button
                  id="footer-releases"
                  size="sm"
                  variant="ghost"
                  label="Releases"
                  href="https://github.com/maceip/Outrider/releases/latest"
                />
              </HStack>
            </HStack>
          </div>
        </footer>
      </div>
    </Theme>
  );
}
