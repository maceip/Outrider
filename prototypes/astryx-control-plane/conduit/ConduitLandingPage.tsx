// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {type CSSProperties} from 'react';
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

const HERO_PANELS: ReadonlyArray<{
  id: string;
  step: string;
  illustration: ConduitIllustrationId;
  alt: string;
  title: string;
  body: string;
  cta: string;
  scenario: ScenarioPresetId;
}> = [
  {
    id: 'browsing',
    step: '01 · ALREADY AT YOUR DOOR',
    illustration: 'handshake',
    alt: 'AI agent and storefront exchanging live product requests',
    title: 'Buyers send agents first.',
    body: 'ChatGPT and Claude already compare your specs and stock. Conduit lets 95% of browsing straight through in 2 ms.',
    cta: 'Watch live browsing →',
    scenario: 'discovery_95pct',
  },
  {
    id: 'margin',
    step: '02 · MARGIN NEVER LEAKS',
    illustration: 'quotePrice',
    alt: 'Agent API request resolving to a protected store price card',
    title: 'Every quote clears your floor.',
    body: 'Bots hunt for stacked discounts and price errors. Anything below your floor pauses before the buyer sees it.',
    cta: 'Hold a live quote →',
    scenario: 'floor_leak_blocked',
  },
  {
    id: 'checkout',
    step: '03 · NO BLANK CHECKS',
    illustration: 'paymentCheck',
    alt: 'Scoped payment cards with single-use approval checkmark',
    title: 'One pass. One SKU. One charge.',
    body: 'Checkout requires a single-use Ed25519 pass. Even if an agent loops or retries, it can never overspend.',
    cta: 'Sign a 1-use pass →',
    scenario: 'post_release_pass',
  },
];

const ARCHITECTURE_BLOCKS: ReadonlyArray<{
  code: string;
  illustration: ConduitIllustrationId;
  alt: string;
  title: string;
  body: string;
}> = [
  {
    code: 'INLINE EDGE GATE · < 2 MS',
    illustration: 'routingGate',
    alt: 'Traffic routing gate separating routine lookups from held quotes',
    title: 'Watch first. Enforce what matters.',
    body: 'Every agent is fingerprinted on the first frame. Spec lookups pass untouched; risky quotes wait for your counter-offer.',
  },
  {
    code: 'TAMPER-EVIDENT AUDIT · ED25519',
    illustration: 'signedPass',
    alt: 'Envelope opening to reveal a cryptographically signed receipt',
    title: 'Every visit leaves a signed receipt.',
    body: 'From first lookup to checkout pass, you keep a verifiable record of who knocked, what you quoted, and what settled.',
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
    step: '01 · QUOTE COUNTER',
    title: 'Counter a live quote',
    merchant: 'AudioShop · $229 MSRP',
    description:
      'Hold 2 outbound offers mid-flight and counter at $209—safely above your $198 floor.',
    outcome: '2 observed → 3 proposed',
  },
  {
    id: 'floor_leak_blocked',
    step: '02 · FLOOR GUARD',
    title: 'Stop a $189 floor leak',
    merchant: 'AudioShop · -$9 caught',
    description:
      'Intercept an accidental below-floor clearance quote before the buyer bot ever sees it.',
    outcome: '+$11 margin saved',
  },
  {
    id: 'post_release_pass',
    step: '03 · SPENDING PASS',
    title: 'Sign a 1-use checkout pass',
    merchant: 'CART-8841 · $209 cap',
    description:
      'Pin settlement to SKU SWX-BLK-01, one call, and a 15-minute window.',
    outcome: '1 call · 0 replay risk',
  },
  {
    id: 'discovery_95pct',
    step: '04 · OPEN FRONT DOOR',
    title: 'Pass 95% catalog browsing',
    merchant: 'DisplayCo · 2 ms',
    description:
      'Let real buyer research fly straight through with zero CAPTCHAs or operator prompts.',
    outcome: '4 frames · 0 held',
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
    paddingTop: '56px',
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
  subBandLedeWrap: {
    maxWidth: 580,
  },
  illustrationStage: {
    width: '100%',
    height: 152,
    borderRadius: 8,
    backgroundColor: 'var(--color-background-muted)',
    border: 'var(--border-width) solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  illustrationImg: {
    width: 228,
    height: 140,
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
  },
  architectureSurface: {
    padding: 'var(--spacing-5)',
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 12,
  },
  installVisualStage: {
    width: '100%',
    height: 136,
    borderRadius: 8,
    backgroundColor: 'var(--color-background-surface)',
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

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <div data-testid="conduit-landing-page" style={styles.pageRoot}>
        <style>{'nextjs-portal { display: none !important; }'}</style>

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
                    label="Releases"
                    href="https://github.com/maceip/Outrider/releases/latest"
                  />
                )}

                <Button
                  id="nav-launch-console"
                  size="sm"
                  variant="primary"
                  label={isMobile ? 'Open Demo →' : 'Open Control Plane →'}
                  onClick={() => onLaunchConsole('live_hold_r02')}
                />
              </HStack>
            </HStack>
          </div>
        </header>

        {/* Main landing content */}
        <main style={styles.mainContainer}>
          <VStack gap={0}>
            {/* HERO */}
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
                      label="Open Live Control Plane →"
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

                {/* 3-panel illustrated story */}
                <Grid
                  columns={{minWidth: 270, max: 3, repeat: 'fit'}}
                  gap={4}>
                  {HERO_PANELS.map(panel => (
                    <ClickableCard
                      key={panel.id}
                      id={`hero-panel-${panel.id}`}
                      variant="outlined"
                      padding="md"
                      onClick={() => onLaunchConsole(panel.scenario)}>
                      <VStack gap={3}>
                        <div style={styles.illustrationStage}>
                          <img
                            src={
                              CONDUIT_ILLUSTRATIONS[panel.illustration][
                                colorMode
                              ]
                            }
                            alt={panel.alt}
                            width={228}
                            height={140}
                            style={styles.illustrationImg}
                          />
                        </div>

                        <VStack gap={1}>
                          <Text type="code" size="2xs" color="accent">
                            {panel.step}
                          </Text>
                          <Heading level={4}>{panel.title}</Heading>
                        </VStack>

                        <Text type="supporting" color="secondary">
                          {panel.body}
                        </Text>

                        <Divider />

                        <Text type="supporting" weight="semibold">
                          {panel.cta}
                        </Text>
                      </VStack>
                    </ClickableCard>
                  ))}
                </Grid>
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
                    HOW CONDUIT DECIDES
                  </Text>
                  <Heading level={2}>
                    <span id="how-heading">
                      Slowed down, never thrown out.
                    </span>
                  </Heading>
                  <div style={styles.subBandLedeWrap}>
                    <Text type="body" color="secondary">
                      You can&apos;t price or permit what you can&apos;t see.
                      Conduit sits at your front door with zero new protocol for
                      agents to adopt.
                    </Text>
                  </div>
                </VStack>

                <Grid columns={{minWidth: 300, max: 2, repeat: 'fit'}} gap={4}>
                  {ARCHITECTURE_BLOCKS.map(block => (
                    <div
                      key={block.code}
                      style={styles.architectureSurface}>
                      <VStack gap={3}>
                        <div style={styles.illustrationStage}>
                          <img
                            src={
                              CONDUIT_ILLUSTRATIONS[block.illustration][
                                colorMode
                              ]
                            }
                            alt={block.alt}
                            width={228}
                            height={140}
                            style={styles.illustrationImg}
                          />
                        </div>

                        <VStack gap={1}>
                          <Text type="code" size="2xs" color="accent">
                            {block.code}
                          </Text>
                          <Heading level={4}>{block.title}</Heading>
                        </VStack>

                        <Text type="supporting" color="secondary">
                          {block.body}
                        </Text>
                      </VStack>
                    </div>
                  ))}
                </Grid>
              </VStack>
            </section>

            {/* LIVE SCENARIO LAUNCHER */}
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
                      Step inside a live agent visit.
                    </span>
                  </Heading>
                </VStack>

                <Grid columns={{minWidth: 260, max: 2, repeat: 'fit'}} gap={3}>
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
                            Open →
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
                      LOCAL BY DEFAULT
                    </Text>
                    <Heading level={2}>
                      <span id="install-heading">
                        Your hardware. Your floor. Zero middlemen.
                      </span>
                    </Heading>
                    <Text type="body" color="secondary">
                      Ships inside Outrider as a single native Rust binary.
                      Pricing floors and signing keys never leave your machine.
                    </Text>
                  </VStack>

                  <MetadataList
                    columns="single"
                    label={{position: 'start', width: 110}}>
                    <MetadataListItem label="Binary">
                      <Text type="supporting">
                        Native Rust · macOS, Windows, Linux
                      </Text>
                    </MetadataListItem>
                    <MetadataListItem label="Budget">
                      <Text type="supporting" hasTabularNumbers>
                        &lt; 2 ms inline · fail-open edge switch
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
                  <div style={styles.installVisualStage}>
                    <img
                      src={CONDUIT_ILLUSTRATIONS.localTerminal[colorMode]}
                      alt="Local machine inspecting live agent traffic"
                      width={210}
                      height={128}
                      style={styles.illustrationImg}
                    />
                  </div>

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
                      label="Open Live Control Plane →"
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
                  label="Live Control Plane"
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
