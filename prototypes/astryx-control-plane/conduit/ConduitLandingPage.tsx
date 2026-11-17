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
import {CONDUIT_MARK_DATA_URI} from './conduitMark';
import {conduitTheme} from './conduitTheme';
import type {ScenarioPresetId} from './conduitState';

type WalkthroughTabId = 'quote_hold' | 'checkout_pass' | 'fast_discovery';

interface WalkthroughStory {
  id: WalkthroughTabId;
  tabLabel: string;
  mobileTabLabel: string;
  scenario: ScenarioPresetId;
  headline: string;
  summary: string;
  ctaLabel: string;
  steps: ReadonlyArray<{
    actor: string;
    role: string;
    dot: 'neutral' | 'warning' | 'success' | 'accent';
    title: string;
    detail: string;
    metric: string;
  }>;
}

const WALKTHROUGH_STORIES: ReadonlyArray<WalkthroughStory> = [
  {
    id: 'quote_hold',
    tabLabel: '1. Stop a bad discount ($189 → $209)',
    mobileTabLabel: 'Quotes',
    scenario: 'floor_leak_blocked',
    headline:
      'Your store tries to send an accidental $189 clearance price — Conduit catches it before the buyer bot sees it.',
    summary:
      'Floor rules run on outbound responses in under 2 ms. Nothing below your $198 margin floor can leave the proxy.',
    ctaLabel: 'Try this quote hold in the Control Plane →',
    steps: [
      {
        actor: '01 · Buyer AI Agent',
        role: 'agent-7f2',
        dot: 'neutral',
        title: 'Asks for wireless studio headphones under $210',
        detail:
          'Calls get_offers on Studio Wireless X ($229 MSRP · $198 merchant floor).',
        metric: 'Inbound · 1 ms',
      },
      {
        actor: '02 · Conduit Edge Gate',
        role: 'Paused mid-flight',
        dot: 'warning',
        title: 'Holds $189 leak (-$9 below your $198 floor)',
        detail:
          'Buyer agent has received 0 offers so far. Conduit stages your approved $209 Studio Promo instead.',
        metric: 'Held · 0 leaked',
      },
      {
        actor: '03 · What Leaves Your Store',
        role: 'Operator approved',
        dot: 'success',
        title: 'Releases $209 Studio Promo (+$11 above floor)',
        detail:
          'Margin stays protected and the agent gets a clean, valid offer it can accept immediately.',
        metric: '+$11 margin saved',
      },
    ],
  },
  {
    id: 'checkout_pass',
    tabLabel: '2. Lock checkout ($209 1-use pass)',
    mobileTabLabel: 'Passes',
    scenario: 'post_release_pass',
    headline:
      'No blank checks or reusable checkout tokens — payment only runs with a single-use Ed25519 pass.',
    summary:
      'Even if an AI agent loops or hallucinates a second purchase call, the pass is pinned to one SKU, one cap, and one call.',
    ctaLabel: 'Try pass signing in the Control Plane →',
    steps: [
      {
        actor: '01 · Buyer AI Agent',
        role: 'agent-7f2',
        dot: 'neutral',
        title: 'Locks cart CART-8841 at the agreed $209 quote',
        detail:
          'Requests checkout permission for SKU SWX-BLK-01 with verified SPIFFE identity.',
        metric: 'Cart locked',
      },
      {
        actor: '02 · Conduit Pass Authority',
        role: 'Awaiting signature',
        dot: 'accent',
        title: 'Verifies quote match & single-use replay lock',
        detail:
          'Confirms $209.00 matches delivered offer O03 and binds quota to 1 call · 15m TTL.',
        metric: '1 call · 15m TTL',
      },
      {
        actor: '03 · Scoped Settlement',
        role: 'Ed25519 signed',
        dot: 'success',
        title: 'Executes once, then expires automatically',
        detail:
          'Any replay, SKU swap, or higher dollar amount is rejected at the edge—or revoked in one click.',
        metric: '$209.00 ceiling',
      },
    ],
  },
  {
    id: 'fast_discovery',
    tabLabel: '3. Pass 95% browsing (2 ms)',
    mobileTabLabel: 'Browsing',
    scenario: 'discovery_95pct',
    headline:
      'Routine catalog searches and spec lookups fly straight through with zero operator noise.',
    summary:
      'Conduit fingerprints every visiting agent silently and only opens an approval gate when money or margin is on the line.',
    ctaLabel: 'Inspect read-only traffic in the Control Plane →',
    steps: [
      {
        actor: '01 · Research Agent',
        role: 'research-crawler-19b',
        dot: 'neutral',
        title: 'Reads 27-inch 5K display specs & shipping zones',
        detail:
          'Searches catalog and checks 2-day freight lead times without requesting discounts or checkout.',
        metric: '4 read frames',
      },
      {
        actor: '02 · Conduit Classifier',
        role: 'Shadow observation',
        dot: 'neutral',
        title: 'Fingerprints agent behavior in 2 ms',
        detail:
          'Identifies model family and tool sequence with zero human prompts or approval drawers.',
        metric: '0 held · 2 ms',
      },
      {
        actor: '03 · Uninterrupted Storefront',
        role: 'Forwarded untouched',
        dot: 'success',
        title: 'Fast answers for good bots, full audit trail for you',
        detail:
          'Every frame is logged to your local trace so you see demand patterns before turning on rules.',
        metric: '100% pass-through',
      },
    ],
  },
];

const SCENARIO_CARDS: ReadonlyArray<{
  id: ScenarioPresetId;
  step: string;
  title: string;
  merchant: string;
  description: string;
  outcome: string;
}> = [
  {
    id: 'live_hold_r02',
    step: 'Scenario 01',
    title: 'Pause & counter a live quote',
    merchant: 'AudioShop · $229 MSRP',
    description:
      'Hold 2 outbound offers mid-flight, inject a $209 Studio Promo bundle above your $198 floor, and transmit to the buyer bot.',
    outcome: '2 observed → 3 proposed offers',
  },
  {
    id: 'floor_leak_blocked',
    step: 'Scenario 02',
    title: 'Block a below-floor price leak',
    merchant: 'AudioShop · $189 leak caught',
    description:
      'See Conduit intercept an accidental $189 clearance quote (-$9 below floor) and lock raw forwarding with an inline policy reason.',
    outcome: 'Floor enforced · +$11 saved',
  },
  {
    id: 'post_release_pass',
    step: 'Scenario 03',
    title: 'Approve a 1-use checkout pass',
    merchant: 'AudioShop · CART-8841',
    description:
      'Inspect a buyer agent SPIFFE fingerprint and sign an Ed25519 pass pinned to SWX-BLK-01, $209 max, 1 call, and 15m TTL.',
    outcome: 'Single-use Ed25519 capability',
  },
  {
    id: 'discovery_95pct',
    step: 'Scenario 04',
    title: 'Watch 95% read-only browsing',
    merchant: 'DisplayCo · 5K Monitor',
    description:
      'Observe normal catalog and shipping queries flowing through in milliseconds with zero approval gates or right-rail clutter.',
    outcome: '4 frames · 0 held · full width',
  },
];

const INSTALL_SNIPPET = `# Prebuilt apps: macOS · Windows · Linux
# Or build locally from source:
cargo build --release -p proxyfor --bin outrider
./target/release/outrider --web`;

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
    maxWidth: 1160,
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
    maxWidth: 1160,
    width: '100%',
    marginInline: 'auto',
    padding: '0 var(--spacing-5)',
    boxSizing: 'border-box',
    flex: 1,
  },
  heroSection: {
    paddingTop: '56px',
    paddingBottom: '64px',
  },
  sectionBand: {
    paddingTop: '64px',
    paddingBottom: '64px',
    borderTop: 'var(--border-width) solid var(--color-border)',
  },
  heroLedeWrap: {
    maxWidth: 680,
  },
  walkthroughSurface: {
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--radius-container)',
    overflow: 'hidden',
  },
  walkthroughHeader: {
    padding: 'var(--spacing-4) var(--spacing-5)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  },
  walkthroughStepCell: {
    padding: 'var(--spacing-4) var(--spacing-5)',
    backgroundColor: 'var(--color-background-card)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--radius-control)',
  },
  walkthroughBody: {
    padding: 'var(--spacing-5)',
  },
  walkthroughFooter: {
    padding: 'var(--spacing-3) var(--spacing-5)',
    borderTop: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-muted)',
  },
  pillarRule: {
    paddingTop: 'var(--spacing-4)',
    borderTop: 'var(--border-width) solid var(--color-border-emphasized)',
  },
  footerBar: {
    borderTop: 'var(--border-width) solid var(--color-border)',
    backgroundColor: 'var(--color-background-surface)',
  },
  footerInner: {
    maxWidth: 1160,
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
  const [activeTab, setActiveTab] = useState<WalkthroughTabId>('quote_hold');
  const isMobile = useMediaQuery('(max-width: 768px)');

  const activeStory =
    WALKTHROUGH_STORIES.find(s => s.id === activeTab) ?? WALKTHROUGH_STORIES[0];

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <div data-testid="conduit-landing-page" style={styles.pageRoot}>
        <style>{'nextjs-portal { display: none !important; }'}</style>

        {/* Top navigation bar */}
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
                        <a href="#how-it-works" style={styles.navLink}>
                          How it works
                        </a>
                        <a href="#scenarios" style={styles.navLink}>
                          Live scenarios
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
                    label="GitHub Releases"
                    href="https://github.com/maceip/Outrider/releases/latest"
                  />
                )}

                <Button
                  id="nav-launch-console"
                  size="sm"
                  variant="primary"
                  label={
                    isMobile ? 'Open Demo →' : 'Launch Control Plane →'
                  }
                  onClick={() => onLaunchConsole('live_hold_r02')}
                />
              </HStack>
            </HStack>
          </div>
        </header>

        {/* Main marketing content */}
        <main style={styles.mainContainer}>
          <VStack gap={0}>
            {/* HERO */}
            <section
              aria-labelledby="hero-heading"
              style={styles.heroSection}>
              <VStack gap={8}>
                <VStack gap={4}>
                  <Text type="label" color="secondary">
                    AGENTIC COMMERCE CONTROL PLANE · LOCAL RUST PROXY
                  </Text>

                  <Heading level={1} type="display-2" textWrap="balance">
                    <span id="hero-heading">
                      Stop bad AI discounts before they leave your store.
                    </span>
                  </Heading>

                  <div style={styles.heroLedeWrap}>
                    <Text type="body" color="secondary" textWrap="pretty">
                      AI shopping agents now browse your catalog, negotiate
                      quotes, and check out automatically. Conduit sits in front
                      of your store endpoints so normal browsing passes in 2 ms,
                      risky prices pause mid-flight for your approval, and
                      checkout requires a single-use spending pass.
                    </Text>
                  </div>

                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <Button
                      id="hero-launch-console"
                      size="lg"
                      variant="primary"
                      label="Launch Interactive Control Plane →"
                      onClick={() => onLaunchConsole('live_hold_r02')}
                    />
                    <Button
                      id="hero-download-binary"
                      size="lg"
                      variant="secondary"
                      label="Download Local App (macOS · Win · Linux)"
                      href="https://github.com/maceip/Outrider/releases/latest"
                    />
                  </HStack>
                </VStack>

                {/* Interactive 5-second visual walkthrough */}
                <div
                  data-testid="hero-interactive-walkthrough"
                  style={styles.walkthroughSurface}>
                  <div style={styles.walkthroughHeader}>
                    <VStack gap={3}>
                      <HStack gap={3} vAlign="center" wrap="wrap">
                        <StackItem size="fill">
                          <Text type="label" color="secondary">
                            SEE ONE AGENT VISIT IN 5 SECONDS
                          </Text>
                        </StackItem>
                        <SegmentedControl
                          size="sm"
                          label="Example agent visit"
                          value={activeTab}
                          onChange={v =>
                            setActiveTab(v as WalkthroughTabId)
                          }>
                          {WALKTHROUGH_STORIES.map(story => (
                            <SegmentedControlItem
                              key={story.id}
                              value={story.id}
                              label={
                                isMobile
                                  ? story.mobileTabLabel
                                  : story.tabLabel
                              }
                            />
                          ))}
                        </SegmentedControl>
                      </HStack>

                      <VStack gap={1}>
                        <Heading level={4}>{activeStory.headline}</Heading>
                        <Text type="supporting" color="secondary">
                          {activeStory.summary}
                        </Text>
                      </VStack>
                    </VStack>
                  </div>

                  <div style={styles.walkthroughBody}>
                    <Grid
                      columns={{minWidth: 240, max: 3, repeat: 'fit'}}
                      gap={3}>
                      {activeStory.steps.map(step => (
                        <div
                          key={step.actor}
                          style={styles.walkthroughStepCell}>
                          <VStack gap={2}>
                            <HStack gap={2} vAlign="center">
                              <StackItem size="fill">
                                <Text type="label" color="secondary">
                                  {step.actor}
                                </Text>
                              </StackItem>
                              <Text
                                type="code"
                                size="2xs"
                                color="secondary"
                                hasTabularNumbers>
                                {step.role}
                              </Text>
                            </HStack>

                            <HStack gap={2} vAlign="center">
                              <StatusDot
                                variant={step.dot}
                                label={step.actor}
                              />
                              <Heading level={5}>{step.title}</Heading>
                            </HStack>

                            <Text type="supporting" color="secondary">
                              {step.detail}
                            </Text>

                            <Divider />

                            <Text
                              type="code"
                              size="2xs"
                              color="accent"
                              hasTabularNumbers>
                              {step.metric}
                            </Text>
                          </VStack>
                        </div>
                      ))}
                    </Grid>
                  </div>

                  <div style={styles.walkthroughFooter}>
                    <HStack gap={3} vAlign="center" wrap="wrap">
                      <StackItem size="fill">
                        <Text type="supporting" color="secondary">
                          Interactive browser simulation — toggle mutation
                          rules, inspect MCP JSON-RPC diffs, and release or
                          reject live frames.
                        </Text>
                      </StackItem>
                      <Button
                        id="walkthrough-try-scenario"
                        size="sm"
                        variant="primary"
                        label={activeStory.ctaLabel}
                        onClick={() => onLaunchConsole(activeStory.scenario)}
                      />
                    </HStack>
                  </div>
                </div>
              </VStack>
            </section>

            {/* HOW IT WORKS */}
            <section
              id="how-it-works"
              aria-labelledby="how-heading"
              style={styles.sectionBand}>
              <VStack gap={6}>
                <VStack gap={2}>
                  <Text type="label" color="secondary">
                    HOW CONDUIT WORKS
                  </Text>
                  <Heading level={2}>
                    <span id="how-heading">
                      Three gates between an AI agent and your margin
                    </span>
                  </Heading>
                  <Text type="body" color="secondary">
                    You cannot price, permit, or block what you cannot see.
                    Conduit sits directly in front of your MCP and HTTP
                    endpoints without asking buyer agents to adopt a new
                    protocol.
                  </Text>
                </VStack>

                <Grid columns={{minWidth: 260, max: 3, repeat: 'fit'}} gap={6}>
                  <div style={styles.pillarRule}>
                    <VStack gap={2}>
                      <Text type="code" size="2xs" color="accent">
                        01 · FINGERPRINT IN 2 MS
                      </Text>
                      <Heading level={4}>
                        Know which AI agent is knocking
                      </Heading>
                      <Text type="supporting" color="secondary">
                        Identify model families, prompting frameworks, and
                        tool-call habits from the first request. The 95% of
                        traffic that only browses specs passes straight through
                        with zero friction.
                      </Text>
                    </VStack>
                  </div>

                  <div style={styles.pillarRule}>
                    <VStack gap={2}>
                      <Text type="code" size="2xs" color="accent">
                        02 · PAUSE &amp; COUNTER QUOTES
                      </Text>
                      <Heading level={4}>
                        Enforce your margin floor mid-flight
                      </Heading>
                      <Text type="supporting" color="secondary">
                        Hold outbound offers before they reach the buyer agent.
                        Block accidental below-floor discounts automatically or
                        append a higher-value bundle on the fly.
                      </Text>
                    </VStack>
                  </div>

                  <div style={styles.pillarRule}>
                    <VStack gap={2}>
                      <Text type="code" size="2xs" color="accent">
                        03 · SCOPED CHECKOUT PASSES
                      </Text>
                      <Heading level={4}>
                        Issue a 1-call pass, never a blank check
                      </Heading>
                      <Text type="supporting" color="secondary">
                        Gate payment behind an operator-signed Ed25519 pass
                        pinned to one SKU, one dollar ceiling, one call, and a
                        15-minute timer—with instant one-click revocation.
                      </Text>
                    </VStack>
                  </div>
                </Grid>
              </VStack>
            </section>

            {/* LIVE SCENARIO PICKER */}
            <section
              id="scenarios"
              aria-labelledby="scenarios-heading"
              style={styles.sectionBand}>
              <VStack gap={5}>
                <VStack gap={2}>
                  <Text type="label" color="secondary">
                    INTERACTIVE CONTROL PLANE
                  </Text>
                  <Heading level={2}>
                    <span id="scenarios-heading">
                      Jump straight into a live scenario
                    </span>
                  </Heading>
                  <Text type="body" color="secondary">
                    Pick any moment below to open the full Conduit MCP Control
                    Plane preloaded with that merchant session.
                  </Text>
                </VStack>

                <Grid columns={{minWidth: 250, max: 2, repeat: 'fit'}} gap={3}>
                  {SCENARIO_CARDS.map(item => (
                    <ClickableCard
                      key={item.id}
                      id={`scenario-card-${item.id}`}
                      variant="outlined"
                      padding="md"
                      onClick={() => onLaunchConsole(item.id)}>
                      <VStack gap={2}>
                        <HStack gap={2} vAlign="center">
                          <StackItem size="fill">
                            <Text type="code" size="2xs" color="accent">
                              {item.step}
                            </Text>
                          </StackItem>
                          <Text type="supporting" color="secondary">
                            {item.merchant}
                          </Text>
                        </HStack>

                        <Heading level={4}>{item.title}</Heading>

                        <Text type="supporting" color="secondary">
                          {item.description}
                        </Text>

                        <Divider />

                        <HStack gap={2} vAlign="center">
                          <StackItem size="fill">
                            <Text
                              type="code"
                              size="2xs"
                              color="secondary"
                              hasTabularNumbers>
                              {item.outcome}
                            </Text>
                          </StackItem>
                          <Text type="supporting" weight="semibold">
                            Open in Control Plane →
                          </Text>
                        </HStack>
                      </VStack>
                    </ClickableCard>
                  ))}
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
                      PRIVATE LOCAL DEPLOYMENT
                    </Text>
                    <Heading level={2}>
                      <span id="install-heading">
                        Runs on your machine. Private by default.
                      </span>
                    </Heading>
                    <Text type="body" color="secondary">
                      Conduit ships inside Outrider as a single native Rust
                      binary for macOS, Windows, and Linux. Your pricing floors,
                      customer payloads, and Ed25519 signing keys stay on your
                      own hardware—never routed through a third-party cloud.
                    </Text>
                  </VStack>

                  <MetadataList
                    columns="single"
                    label={{position: 'start', width: 132}}>
                    <MetadataListItem label="Runtime">
                      <Text type="supporting">
                        Native Rust single binary (macOS · Windows · Linux)
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Proxy budget">
                      <Text type="supporting" hasTabularNumbers>
                        &lt; 2 ms inline observation · fail-open edge switch
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Protocols">
                      <Text type="supporting">
                        MCP JSON-RPC, HTTPS, WebSocket, HAR export
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Latest release">
                      <Text type="code" size="2xs">
                        Outrider v0.5.19
                      </Text>
                    </MetadataListItem>
                  </MetadataList>
                </VStack>

                <VStack gap={3}>
                  <Text type="label" color="secondary">
                    START LOCALLY IN 30 SECONDS
                  </Text>
                  <CodeBlock
                    language="bash"
                    code={INSTALL_SNIPPET}
                    showLineNumbers={false}
                  />
                  <HStack gap={2} wrap="wrap">
                    <Button
                      id="install-launch-console"
                      size="sm"
                      variant="primary"
                      label="Launch Browser Control Plane →"
                      onClick={() => onLaunchConsole('live_hold_r02')}
                    />
                    <Button
                      id="install-view-github"
                      size="sm"
                      variant="secondary"
                      label="View GitHub Repository"
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
                    Conduit · Outrider Agentic Commerce Control Plane
                  </Text>
                </HStack>
              </StackItem>

              <HStack gap={3} vAlign="center" wrap="wrap">
                <Button
                  id="footer-launch-console"
                  size="sm"
                  variant="ghost"
                  label="Interactive Control Plane"
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
