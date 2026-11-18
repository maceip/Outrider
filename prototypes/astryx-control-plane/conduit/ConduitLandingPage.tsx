// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState, type CSSProperties} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TopNav, TopNavHeading} from '@astryxdesign/core/TopNav';
import {Theme} from '@astryxdesign/core/theme';
import {rtlStyles} from '@astryxdesign/core/utils';
import {ArrowRightIcon} from '@heroicons/react/20/solid';
import {MoonIcon, SunIcon} from '@heroicons/react/24/outline';
import {
  CONDUIT_ILLUSTRATIONS,
  type ConduitIllustrationId,
} from './conduitIllustrations';
import {CONDUIT_MARK_DATA_URI} from './conduitMark';
import {conduitTheme} from './conduitTheme';
import type {ScenarioPresetId} from './conduitState';
import heroConsoleDarkAsset from './hero-console-dark.webp';
import heroConsoleLightAsset from './hero-console-light.webp';

function resolveAssetSrc(asset: string | {src: string}): string {
  return typeof asset === 'string' ? asset : asset.src;
}

interface StoryStep {
  id: string;
  restIllustration: ConduitIllustrationId;
  hoverIllustration: ConduitIllustrationId;
  alt: string;
  title: string;
  body: string;
  scenario: ScenarioPresetId;
}

const STORY_STEPS: ReadonlyArray<StoryStep> = [
  {
    id: 'browsing',
    restIllustration: 'storefrontQueryFlat',
    hoverIllustration: 'storefrontQueryIso',
    alt: 'AI agent querying a storefront product listing',
    title: 'Buyers send agents first.',
    body: 'ChatGPT and Claude already compare your specs and stock. 95% of visits pass straight through in 2 ms.',
    scenario: 'discovery_95pct',
  },
  {
    id: 'floor',
    restIllustration: 'offerApprovalFlat',
    hoverIllustration: 'offerApprovalIso',
    alt: 'Unapproved storefront offer skipped in favor of an approved offer',
    title: 'Every quote clears your floor.',
    body: 'Below-floor discounts pause mid-flight before the agent ever sees them, so you counter on your terms.',
    scenario: 'live_hold_r02',
  },
  {
    id: 'checkout',
    restIllustration: 'singleChargeFlat',
    hoverIllustration: 'singleChargeIso',
    alt: 'Single-use payment card authorization pass',
    title: 'One pass. One charge.',
    body: 'Checkout runs on a single-use Ed25519 pass pinned to one SKU and one amount—never a blank check.',
    scenario: 'post_release_pass',
  },
];

const styles: Record<string, CSSProperties> = {
  brandMark: {
    width: 22,
    height: 22,
    objectFit: 'contain',
    display: 'block',
  },
  pageBody: {
    maxWidth: 1120,
    width: '100%',
    marginInline: 'auto',
    paddingBlockStart: 44,
    paddingBlockEnd: 28,
  },
  heroHeadlineWrap: {
    maxWidth: 840,
    marginInline: 'auto',
  },
  heroHeadingOverride: {
    fontSize: 'clamp(2rem, 4.1vw, 3.25rem)',
    lineHeight: 1.12,
    letterSpacing: '-0.025em',
  },
  heroSentenceLead: {
    display: 'block',
    fontWeight: 'var(--font-weight-normal)',
  },
  heroSentencePunch: {
    display: 'block',
    fontWeight: 'var(--font-weight-semibold)',
  },
  heroStageTrigger: {
    all: 'unset',
    display: 'block',
    width: '100%',
    cursor: 'pointer',
    marginBlockStart: 12,
  },
  heroWindowFrame: {
    width: '100%',
    padding: 6,
    borderRadius: 14,
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border-emphasized)',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)',
    transition: 'border-color 180ms ease, transform 180ms ease',
    boxSizing: 'border-box',
  },
  heroWindowFrameHover: {
    borderColor: 'var(--color-accent)',
    transform: 'translateY(-2px)',
  },
  heroScreenshot: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: 9,
    border: 'var(--border-width) solid var(--color-border)',
  },
  storySection: {
    paddingBlockStart: 88,
  },
  storyIntroWrap: {
    maxWidth: 580,
  },
  pillarTrigger: {
    all: 'unset',
    display: 'block',
    width: '100%',
    cursor: 'pointer',
    textAlign: 'left',
  },
  illustrationFrame: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16 / 10',
    borderRadius: 12,
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transition: 'border-color 180ms ease, transform 180ms ease',
  },
  illustrationFrameActive: {
    borderColor: 'var(--color-border-emphasized)',
    transform: 'translateY(-2px)',
  },
  illustrationLayer: {
    position: 'absolute',
    width: '84%',
    height: '80%',
    objectFit: 'contain',
    userSelect: 'none',
    pointerEvents: 'none',
    transition: 'opacity 220ms ease, transform 220ms ease',
  },
  footerWrap: {
    paddingBlockStart: 64,
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
  const [hoveredHero, setHoveredHero] = useState(false);
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  const heroScreenshotSrc =
    colorMode === 'dark'
      ? resolveAssetSrc(heroConsoleDarkAsset)
      : resolveAssetSrc(heroConsoleLightAsset);

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <style>{'nextjs-portal { display: none !important; }'}</style>
      <AppShell
        height="auto"
        mobileNav={false}
        contentPadding={6}
        topNav={
          <TopNav
            label="Conduit navigation"
            heading={
              <TopNavHeading
                heading="Conduit"
                logo={
                  <img
                    src={CONDUIT_MARK_DATA_URI}
                    alt=""
                    width={22}
                    height={22}
                    style={styles.brandMark}
                  />
                }
                headingHref="#"
              />
            }
            endContent={
              <>
                <IconButton
                  id="nav-toggle-theme"
                  label={
                    colorMode === 'dark'
                      ? 'Switch to light mode'
                      : 'Switch to dark mode'
                  }
                  tooltip={colorMode === 'dark' ? 'Light mode' : 'Dark mode'}
                  variant="ghost"
                  icon={
                    <Icon
                      icon={colorMode === 'dark' ? SunIcon : MoonIcon}
                      size="sm"
                    />
                  }
                  onClick={() =>
                    onColorModeChange(colorMode === 'dark' ? 'light' : 'dark')
                  }
                />
                <Button
                  id="nav-github"
                  label="GitHub"
                  variant="ghost"
                  href="https://github.com/maceip/Outrider"
                />
                <Button
                  id="nav-launch-console"
                  label="Control Plane"
                  variant="primary"
                  onClick={() => onLaunchConsole('live_hold_r02')}
                />
              </>
            }
          />
        }>
        <div data-testid="conduit-landing-page" style={styles.pageBody}>
          {/* Section 1: Hero — Headline + CTAs + Singular Product Hero Image */}
          <section aria-labelledby="hero-heading">
            <VStack gap={6} hAlign="center">
              <div style={styles.heroHeadlineWrap}>
                <Heading
                  level={1}
                  type="display-1"
                  justify="center"
                  textWrap="balance">
                  <span id="hero-heading" style={styles.heroHeadingOverride}>
                    <span style={styles.heroSentenceLead}>
                      Agents are already shopping.
                    </span>
                    <span style={styles.heroSentencePunch}>
                      Usher them in without losing money.
                    </span>
                  </span>
                </Heading>
              </div>

              <HStack gap={3} wrap="wrap" hAlign="center">
                <Button
                  id="hero-launch-console"
                  size="lg"
                  variant="primary"
                  label="Open Control Plane"
                  endContent={
                    <Icon
                      icon={ArrowRightIcon}
                      size="sm"
                      color="inherit"
                      xstyle={rtlStyles.mirror}
                    />
                  }
                  onClick={() => onLaunchConsole('live_hold_r02')}
                />
                <Button
                  id="hero-download-binary"
                  size="lg"
                  variant="secondary"
                  label="Download App"
                  href="https://github.com/maceip/Outrider/releases/latest"
                />
              </HStack>

              <button
                id="hero-product-preview"
                type="button"
                aria-label="Open live Conduit Control Plane session"
                style={styles.heroStageTrigger}
                onMouseEnter={() => setHoveredHero(true)}
                onMouseLeave={() => setHoveredHero(false)}
                onFocus={() => setHoveredHero(true)}
                onBlur={() => setHoveredHero(false)}
                onClick={() => onLaunchConsole('live_hold_r02')}>
                <div
                  style={{
                    ...styles.heroWindowFrame,
                    ...(hoveredHero ? styles.heroWindowFrameHover : null),
                  }}>
                  <img
                    src={heroScreenshotSrc}
                    alt="Conduit Control Plane holding an outbound merchant quote above the SKU margin floor"
                    width={2200}
                    height={1261}
                    style={styles.heroScreenshot}
                  />
                </div>
              </button>
            </VStack>
          </section>

          {/* Section 2: Below the Fold — Flush-left editorial thesis + 3-step visual story */}
          <section
            aria-labelledby="story-heading"
            style={styles.storySection}>
            <VStack gap={7}>
              <div style={styles.storyIntroWrap}>
                <VStack gap={2}>
                  <Heading level={2} type="display-3">
                    <span id="story-heading">
                      Sell to AI shoppers on your terms.
                    </span>
                  </Heading>
                  <Text type="body" color="secondary">
                    Blocking bots turns away real buyers. Leaving endpoints open
                    bleeds margin. Conduit sits at your front door between both.
                  </Text>
                </VStack>
              </div>

              <Grid columns={{minWidth: 260, max: 3, repeat: 'fit'}} gap={6}>
                {STORY_STEPS.map(step => {
                  const isHovered = hoveredStep === step.id;
                  return (
                    <button
                      key={step.id}
                      id={`hero-pillar-${step.id}`}
                      type="button"
                      style={styles.pillarTrigger}
                      onMouseEnter={() => setHoveredStep(step.id)}
                      onMouseLeave={() => setHoveredStep(null)}
                      onFocus={() => setHoveredStep(step.id)}
                      onBlur={() => setHoveredStep(null)}
                      onClick={() => onLaunchConsole(step.scenario)}>
                      <VStack gap={4}>
                        <div
                          style={{
                            ...styles.illustrationFrame,
                            ...(isHovered
                              ? styles.illustrationFrameActive
                              : null),
                          }}>
                          <img
                            src={
                              CONDUIT_ILLUSTRATIONS[step.restIllustration][
                                colorMode
                              ]
                            }
                            alt={step.alt}
                            style={{
                              ...styles.illustrationLayer,
                              opacity: isHovered ? 0 : 1,
                              transform: isHovered ? 'scale(0.97)' : 'scale(1)',
                            }}
                          />
                          <img
                            src={
                              CONDUIT_ILLUSTRATIONS[step.hoverIllustration][
                                colorMode
                              ]
                            }
                            alt=""
                            aria-hidden="true"
                            style={{
                              ...styles.illustrationLayer,
                              opacity: isHovered ? 1 : 0,
                              transform: isHovered ? 'scale(1)' : 'scale(0.97)',
                            }}
                          />
                        </div>

                        <VStack gap={1}>
                          <Heading level={4}>{step.title}</Heading>
                          <Text type="supporting" color="secondary">
                            {step.body}
                          </Text>
                        </VStack>
                      </VStack>
                    </button>
                  );
                })}
              </Grid>
            </VStack>
          </section>

          {/* Footer */}
          <footer style={styles.footerWrap}>
            <VStack gap={4}>
              <Divider />
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <Text type="supporting" color="secondary">
                    Conduit by Outrider · Local Rust binary for macOS, Windows,
                    and Linux
                  </Text>
                </StackItem>
                <Button
                  id="footer-releases"
                  size="sm"
                  variant="ghost"
                  label="v0.5.19 Releases"
                  href="https://github.com/maceip/Outrider/releases/latest"
                />
              </HStack>
            </VStack>
          </footer>
        </div>
      </AppShell>
    </Theme>
  );
}
