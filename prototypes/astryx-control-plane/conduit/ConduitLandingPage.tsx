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

interface GalleryPillar {
  id: string;
  restIllustration: ConduitIllustrationId;
  hoverIllustration: ConduitIllustrationId;
  alt: string;
  title: string;
  body: string;
  scenario: ScenarioPresetId;
}

const GALLERY_PILLARS: ReadonlyArray<GalleryPillar> = [
  {
    id: 'browsing',
    restIllustration: 'flowGate',
    hoverIllustration: 'agentSync',
    alt: 'Agent requests routed cleanly through Conduit',
    title: 'Buyers send agents first.',
    body: 'ChatGPT and Claude already compare your specs and stock. 95% of visits pass straight through in 2 ms.',
    scenario: 'discovery_95pct',
  },
  {
    id: 'floor',
    restIllustration: 'priceQuote',
    hoverIllustration: 'offerSelect',
    alt: 'Storefront price quote held above your margin floor',
    title: 'Every quote clears your floor.',
    body: 'Below-floor discounts pause mid-flight before the agent ever sees them, so you counter on your terms.',
    scenario: 'live_hold_r02',
  },
  {
    id: 'checkout',
    restIllustration: 'cardOk',
    hoverIllustration: 'cardBlocked',
    alt: 'Single-use payment pass preventing duplicate charges',
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
    paddingBlockStart: 40,
    paddingBlockEnd: 24,
  },
  heroTextWrap: {
    maxWidth: 780,
    marginInline: 'auto',
  },
  heroSubcopyWrap: {
    maxWidth: 560,
    marginInline: 'auto',
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
    width: '78%',
    height: '74%',
    objectFit: 'contain',
    userSelect: 'none',
    pointerEvents: 'none',
    transition: 'opacity 200ms ease, transform 200ms ease',
  },
  footerWrap: {
    paddingTop: 32,
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
  const [hoveredPillar, setHoveredPillar] = useState<string | null>(null);

  return (
    <Theme theme={conduitTheme} mode={colorMode}>
      <style>{'nextjs-portal { display: none !important; }'}</style>
      <AppShell
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
          <VStack gap={10}>
            {/* Centered Hero (Meta Astryx gallery-hero pattern) */}
            <VStack gap={6} hAlign="center">
              <div style={styles.heroTextWrap}>
                <VStack gap={3} hAlign="center">
                  <Heading
                    level={1}
                    type="display-2"
                    justify="center"
                    textWrap="balance">
                    <span id="hero-heading">
                      Agents are already shopping. Usher them in without losing
                      money.
                    </span>
                  </Heading>
                  <div style={styles.heroSubcopyWrap}>
                    <Text
                      type="body"
                      color="secondary"
                      justify="center"
                      textWrap="balance">
                      Blocking bots turns away real buyers. Leaving endpoints
                      open bleeds margin. Conduit sits at your front door so AI
                      shoppers buy on your terms.
                    </Text>
                  </div>
                </VStack>
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
            </VStack>

            {/* Three Medusa Illustrations (gallery-hero 3-up grid) */}
            <Grid columns={{minWidth: 260, max: 3, repeat: 'fit'}} gap={6}>
              {GALLERY_PILLARS.map(pillar => {
                const isHovered = hoveredPillar === pillar.id;
                return (
                  <button
                    key={pillar.id}
                    id={`hero-pillar-${pillar.id}`}
                    type="button"
                    style={styles.pillarTrigger}
                    onMouseEnter={() => setHoveredPillar(pillar.id)}
                    onMouseLeave={() => setHoveredPillar(null)}
                    onFocus={() => setHoveredPillar(pillar.id)}
                    onBlur={() => setHoveredPillar(null)}
                    onClick={() => onLaunchConsole(pillar.scenario)}>
                    <VStack gap={4}>
                      <div
                        style={{
                          ...styles.illustrationFrame,
                          ...(isHovered ? styles.illustrationFrameActive : null),
                        }}>
                        <img
                          src={
                            CONDUIT_ILLUSTRATIONS[pillar.restIllustration][
                              colorMode
                            ]
                          }
                          alt={pillar.alt}
                          style={{
                            ...styles.illustrationLayer,
                            opacity: isHovered ? 0 : 1,
                            transform: isHovered ? 'scale(0.97)' : 'scale(1)',
                          }}
                        />
                        <img
                          src={
                            CONDUIT_ILLUSTRATIONS[pillar.hoverIllustration][
                              colorMode
                            ]
                          }
                          alt=""
                          aria-hidden="true"
                          style={{
                            ...styles.illustrationLayer,
                            opacity: isHovered ? 1 : 0,
                            transform: isHovered ? 'scale(1.02)' : 'scale(0.97)',
                          }}
                        />
                      </div>

                      <VStack gap={1}>
                        <Heading level={4}>{pillar.title}</Heading>
                        <Text type="supporting" color="secondary">
                          {pillar.body}
                        </Text>
                      </VStack>
                    </VStack>
                  </button>
                );
              })}
            </Grid>

            {/* Quiet footer */}
            <div style={styles.footerWrap}>
              <VStack gap={4}>
                <Divider />
                <HStack gap={3} vAlign="center" wrap="wrap">
                  <StackItem size="fill">
                    <Text type="supporting" color="secondary">
                      Conduit by Outrider · Local Rust binary for macOS,
                      Windows, and Linux
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
            </div>
          </VStack>
        </div>
      </AppShell>
    </Theme>
  );
}
