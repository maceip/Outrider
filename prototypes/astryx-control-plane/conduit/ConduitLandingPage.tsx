// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useState, type CSSProperties} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {Divider} from '@astryxdesign/core/Divider';
import {Grid} from '@astryxdesign/core/Grid';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Layout';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TopNav, TopNavHeading} from '@astryxdesign/core/TopNav';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {Theme} from '@astryxdesign/core/theme';
import {rtlStyles} from '@astryxdesign/core/utils';
import {ArrowRightIcon} from '@heroicons/react/20/solid';
import {
  CONDUIT_ILLUSTRATIONS,
  type ConduitIllustrationId,
} from './conduitIllustrations';
import {CONDUIT_MARK_DATA_URI} from './conduitMark';
import {conduitTheme} from './conduitTheme';
import type {ScenarioPresetId} from './conduitState';
import heroConsoleDarkAsset from './hero-console-dark.webp';
import heroConsoleLightAsset from './hero-console-light.webp';
import heroMobileDarkAsset from './hero-mobile-dark.webp';
import heroMobileLightAsset from './hero-mobile-light.webp';

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
  ctaLabel: string;
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
    ctaLabel: 'See 2 ms pass-through →',
    scenario: 'discovery_95pct',
  },
  {
    id: 'floor',
    restIllustration: 'offerApprovalFlat',
    hoverIllustration: 'offerApprovalIso',
    alt: 'Unapproved storefront offer skipped in favor of an approved offer',
    title: 'Every quote clears your floor.',
    body: 'Below-floor discounts pause mid-flight before the agent ever sees them, so you counter on your terms.',
    ctaLabel: 'Counter a held quote →',
    scenario: 'live_hold_r02',
  },
  {
    id: 'checkout',
    restIllustration: 'singleChargeFlat',
    hoverIllustration: 'singleChargeIso',
    alt: 'Single-use payment card authorization pass',
    title: 'One pass. One charge.',
    body: 'Checkout runs on a single-use Ed25519 pass pinned to one SKU and one amount—never a blank check.',
    ctaLabel: 'Issue a checkout pass →',
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
  pageBodyDesktop: {
    maxWidth: 1120,
    width: '100%',
    marginInline: 'auto',
    paddingBlockStart: 36,
    paddingBlockEnd: 28,
  },
  pageBodyMobile: {
    width: '100%',
    paddingBlockStart: 16,
    paddingBlockEnd: 24,
  },
  heroHeadlineWrap: {
    maxWidth: 840,
    marginInline: 'auto',
  },
  heroSubheadWrap: {
    maxWidth: 620,
    marginInline: 'auto',
  },
  heroHeadingDesktop: {
    fontSize: 'clamp(2rem, 4.1vw, 3.25rem)',
    lineHeight: 1.12,
    letterSpacing: '-0.025em',
  },
  heroHeadingMobile: {
    fontSize: '1.85rem',
    lineHeight: 1.14,
    letterSpacing: '-0.022em',
  },
  heroSentenceLead: {
    display: 'block',
    fontWeight: 'var(--font-weight-normal)',
  },
  heroSentencePunch: {
    display: 'block',
    fontWeight: 'var(--font-weight-semibold)',
  },
  heroPillarsWrap: {
    width: '100%',
    marginBlockStart: 8,
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
    borderColor: 'var(--color-accent)',
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
  mobilePillarRow: {
    all: 'unset',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    boxSizing: 'border-box',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'var(--color-background-surface)',
    border: 'var(--border-width) solid var(--color-border)',
    cursor: 'pointer',
    textAlign: 'left',
  },
  mobileThumbBox: {
    width: 96,
    height: 68,
    flexShrink: 0,
    borderRadius: 8,
    backgroundColor: 'var(--color-background-body)',
    border: 'var(--border-width) solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mobileThumbImg: {
    width: '88%',
    height: '88%',
    objectFit: 'contain',
  },
  previewSectionDesktop: {
    paddingBlockStart: 56,
  },
  previewSectionMobile: {
    paddingBlockStart: 36,
  },
  previewHeaderWrap: {
    maxWidth: 620,
  },
  heroStageTrigger: {
    all: 'unset',
    display: 'block',
    width: '100%',
    cursor: 'pointer',
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
  footerWrap: {
    paddingBlockStart: 48,
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
  const [hoveredHero, setHoveredHero] = useState(false);
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  const heroScreenshotSrc = isMobile
    ? colorMode === 'dark'
      ? resolveAssetSrc(heroMobileDarkAsset)
      : resolveAssetSrc(heroMobileLightAsset)
    : colorMode === 'dark'
      ? resolveAssetSrc(heroConsoleDarkAsset)
      : resolveAssetSrc(heroConsoleLightAsset);

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <style>{'nextjs-portal { display: none !important; }'}</style>
      <AppShell
        height="auto"
        mobileNav={false}
        contentPadding={isMobile ? 4 : 6}
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
                <Button
                  id="nav-github"
                  size={isMobile ? 'sm' : 'md'}
                  label="GitHub"
                  variant="ghost"
                  href="https://github.com/maceip/Outrider"
                />
                <Button
                  id="nav-download"
                  size={isMobile ? 'sm' : 'md'}
                  label="Releases"
                  variant="secondary"
                  href="https://github.com/maceip/Outrider/releases/latest"
                />
              </>
            }
          />
        }>
        <div
          data-testid="conduit-landing-page"
          style={isMobile ? styles.pageBodyMobile : styles.pageBodyDesktop}>
          {/* Section 1: Hero — Headline + CTAs + 3 Medusa Illustrations */}
          <section aria-labelledby="hero-heading">
            <VStack gap={isMobile ? 4 : 6} hAlign="center">
              <VStack gap={isMobile ? 2 : 3} hAlign="center">
                <div style={styles.heroHeadlineWrap}>
                  <Heading
                    level={1}
                    type="display-1"
                    justify="center"
                    textWrap="balance">
                    <span
                      id="hero-heading"
                      style={
                        isMobile
                          ? styles.heroHeadingMobile
                          : styles.heroHeadingDesktop
                      }>
                      <span style={styles.heroSentenceLead}>
                        Agents are already shopping.
                      </span>
                      <span style={styles.heroSentencePunch}>
                        Usher them in without losing money.
                      </span>
                    </span>
                  </Heading>
                </div>

                <div style={styles.heroSubheadWrap}>
                  <Text
                    type={isMobile ? 'supporting' : 'body'}
                    color="secondary"
                    justify="center">
                    Blocking bots turns away real buyers. Leaving endpoints open
                    bleeds margin. Conduit sits at your front door between both.
                  </Text>
                </div>
              </VStack>

              {isMobile ? (
                <HStack gap={2} width="100%" vAlign="center">
                  <StackItem size="fill">
                    <Button
                      id="hero-launch-console"
                      width="100%"
                      size="md"
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
                  </StackItem>
                  <Button
                    id="hero-download-binary"
                    size="md"
                    variant="secondary"
                    label="Download"
                    href="https://github.com/maceip/Outrider/releases/latest"
                  />
                </HStack>
              ) : (
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
              )}

              <div style={styles.heroPillarsWrap}>
                {isMobile ? (
                  /* Mobile: Compact horizontal rows so ALL 3 Medusa illustrations fit on 1 screen */
                  <VStack gap={2} width="100%">
                    {STORY_STEPS.map(step => (
                      <button
                        key={step.id}
                        id={`hero-pillar-${step.id}`}
                        type="button"
                        style={styles.mobilePillarRow}
                        onClick={() => onLaunchConsole(step.scenario)}>
                        <div style={styles.mobileThumbBox}>
                          <img
                            src={
                              CONDUIT_ILLUSTRATIONS[step.restIllustration][
                                colorMode
                              ]
                            }
                            alt={step.alt}
                            style={styles.mobileThumbImg}
                          />
                        </div>
                        <VStack gap={0.5}>
                          <Text type="label" weight="semibold">
                            {step.title}
                          </Text>
                          <Text
                            type="supporting"
                            size="2xs"
                            color="secondary"
                            maxLines={2}>
                            {step.body}
                          </Text>
                          <Text
                            type="supporting"
                            size="2xs"
                            color="accent"
                            weight="medium">
                            {step.ctaLabel}
                          </Text>
                        </VStack>
                      </button>
                    ))}
                  </VStack>
                ) : (
                  /* Desktop: 3-column interactive Medusa gallery */
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
                          <VStack gap={3}>
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
                                  transform: isHovered
                                    ? 'scale(0.97)'
                                    : 'scale(1)',
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
                                  transform: isHovered
                                    ? 'scale(1)'
                                    : 'scale(0.97)',
                                }}
                              />
                            </div>

                            <VStack gap={1}>
                              <Heading level={4}>{step.title}</Heading>
                              <Text type="supporting" color="secondary">
                                {step.body}
                              </Text>
                              <Text
                                type="supporting"
                                color={isHovered ? 'primary' : 'accent'}
                                weight="medium">
                                {step.ctaLabel}
                              </Text>
                            </VStack>
                          </VStack>
                        </button>
                      );
                    })}
                  </Grid>
                )}
              </div>
            </VStack>
          </section>

          {/* Section 2: Live Control Plane Preview */}
          <section
            aria-labelledby="preview-heading"
            style={
              isMobile
                ? styles.previewSectionMobile
                : styles.previewSectionDesktop
            }>
            <VStack gap={4}>
              <div style={styles.previewHeaderWrap}>
                <VStack gap={1}>
                  <Heading level={2} type="display-3">
                    <span id="preview-heading">
                      Sell to AI shoppers on your terms.
                    </span>
                  </Heading>
                  <Text type="supporting" color="secondary">
                    Tap into a live held quote to counter-offer above your floor
                    and mint a single-use checkout pass.
                  </Text>
                </VStack>
              </div>

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
                    width={isMobile ? 780 : 2200}
                    height={isMobile ? 1688 : 1261}
                    style={styles.heroScreenshot}
                  />
                </div>
              </button>
            </VStack>
          </section>

          {/* Footer — Bottom Light/Dark Mode Switcher */}
          <footer style={styles.footerWrap}>
            <VStack gap={4}>
              <Divider />
              <HStack gap={3} vAlign="center" wrap="wrap">
                <StackItem size="fill">
                  <Text type="supporting" color="secondary">
                    Conduit · Local Rust binary for macOS, Windows, and Linux
                  </Text>
                </StackItem>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Button
                    id="footer-releases"
                    size="sm"
                    variant="ghost"
                    label="Latest Release"
                    href="https://github.com/maceip/Outrider/releases/latest"
                  />
                  <SegmentedControl
                    size="sm"
                    label="Color mode"
                    value={colorMode}
                    onChange={v => onColorModeChange(v as 'dark' | 'light')}>
                    <SegmentedControlItem value="dark" label="Dark" />
                    <SegmentedControlItem value="light" label="Light" />
                  </SegmentedControl>
                </HStack>
              </HStack>
            </VStack>
          </footer>
        </div>
      </AppShell>
    </Theme>
  );
}
