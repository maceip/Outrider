// Copyright (c) Meta Platforms, Inc. and affiliates.

import {defineSyntaxTheme, defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';

const conduitSyntax = defineSyntaxTheme({
  name: 'conduit-obsidian-sage',
  tokens: {
    keyword: ['#4A5B2F', '#BBD499'],
    string: ['#3B6245', '#9CC4A7'],
    comment: ['#6C7582', '#6E7785'],
    number: ['#6B6329', '#CFC782'],
    function: ['#335675', '#93B4D1'],
    type: ['#4A5B2F', '#A8C284'],
    variable: ['#161A1F', '#E6EAF0'],
    operator: ['#525B65', '#939BA8'],
    constant: ['#6B6329', '#CFC782'],
    tag: ['#4A5B2F', '#A8C284'],
    attribute: ['#335675', '#93B4D1'],
    property: ['#2C4E3E', '#A8C284'],
    punctuation: ['#6C7582', '#7D8694'],
    background: ['#F4F6F4', '#0E1015'],
  },
});

/**
 * Conduit Theme — derived directly from the Conduit / Outrider brand icons:
 * - Surfaces: cool obsidian / gunmetal carbon (#0B0C0F → #121419 → #171A21) from `sv.gif`
 * - Brand accent: anodized celadon / botanical sage (#A8C284 / #4A5B2F) from `sse_2@v2x.webp`
 * - Secondary metallic status: subtle brushed champagne-citrine (#C4BA74) from `sv.gif`
 */
export const conduitTheme = defineTheme({
  name: 'conduit',
  extends: neutralTheme,
  syntax: conduitSyntax,
  tokens: {
    // Cool obsidian carbon dark surfaces & crisp architectural mist light surfaces
    '--color-background-body': ['#F2F4F2', '#0B0C0F'],
    '--color-background-surface': ['#F9FAF9', '#121419'],
    '--color-background-card': ['#FFFFFF', '#171A21'],
    '--color-background-popover': ['#FFFFFF', '#1B1F27'],
    '--color-background-muted': ['#ECEFEC', '#191D24'],

    // Celadon / Botanical Sage brand accent from sse_2@v2x.webp
    '--color-accent': ['#4A5B2F', '#A8C284'],
    '--color-on-accent': ['#FFFFFF', '#10150B'],
    '--color-accent-muted': ['#E1EAD6', '#A8C28424'],
    '--color-text-accent': ['#3F4F27', '#BBD499'],
    '--color-icon-accent': ['#4A5B2F', '#A8C284'],
    '--focus-outline-color': 'var(--color-accent)',

    // Cool high-contrast text & icons (zero warm brown Undertones)
    '--color-text-primary': ['#111518', '#EFF2F6'],
    '--color-text-secondary': ['#525B65', '#939BA8'],
    '--color-text-disabled': ['#8E96A0', '#505864'],
    '--color-icon-primary': ['#111518', '#EFF2F6'],
    '--color-icon-secondary': ['#525B65', '#939BA8'],
    '--color-icon-disabled': ['#8E96A0', '#505864'],

    // Gunmetal hairline borders & overlays
    '--color-border': ['#11151817', '#E6ECF217'],
    '--color-border-emphasized': ['#B8C2BA', '#363E4A'],
    '--color-neutral': ['#1115180F', '#E6ECF214'],
    '--color-overlay': ['#0B0C0F80', '#060709CC'],
    '--color-overlay-hover': ['#1115180A', '#E6ECF20D'],
    '--color-overlay-pressed': ['#11151814', '#E6ECF21A'],

    // Harmonized status palette (no muddy brown/yellow washes)
    '--color-success': ['#3F6A28', '#8EB368'],
    '--color-success-muted': ['#E3EEDB', '#1A2318'],
    '--color-text-success': ['#33581F', '#AED08A'],
    '--color-on-success': ['#FFFFFF', '#0E140B'],
    '--color-on-success-muted': ['#243F15', '#C6E0AA'],

    // Brushed champagne-citrine dot from sv.gif (#BAB463) on clean cool slate muted surface
    '--color-warning': ['#847C1A', '#C2BA68'],
    '--color-warning-muted': ['#EFEFDE', '#1B1F26'],
    '--color-text-warning': ['#5E5814', '#D4CD84'],
    '--color-on-warning': '#11120B',
    '--color-on-warning-muted': ['#2B290B', '#E5E0AA'],

    '--color-info': ['#3B5C76', '#82A6C2'],
    '--color-info-muted': ['#E3ECF3', '#182028'],
    '--color-text-info': ['#2C475D', '#A8C5DC'],
    '--color-on-info': ['#FFFFFF', '#0D1318'],
    '--color-on-info-muted': ['#1F3445', '#C4DAE9'],

    '--color-error': ['#B43C3C', '#E07070'],
    '--color-error-muted': ['#F5E4E4', '#26191C'],
    '--color-text-error': ['#962D2D', '#ECA0A0'],
    '--color-on-error': ['#FFFFFF', '#180B0B'],
    '--color-on-error-muted': ['#6E1F1F', '#F4C2C2'],
  },
});
