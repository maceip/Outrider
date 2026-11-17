// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file previewThemes.ts
 * @input generated theme registry + Conduit brand theme
 * @output Selectable theme options + value→theme lookup for the playground
 */

import type {DefinedTheme} from '@astryxdesign/core/theme';
import {themeObjectsFull} from '../../generated/themeRegistry';
import {conduitTheme} from '../conduit/conduitTheme';

interface PlaygroundTheme {
  value: string;
  label: string;
  theme: DefinedTheme;
}

const THEME_LABELS: Record<string, string> = {
  conduit: 'Conduit',
  neutral: 'Default',
  y2k: 'Y2K',
};

function toShortName(packageName: string): string {
  return packageName.replace(/^@astryxdesign\/theme-/, '');
}

function toLabel(_packageName: string, shortName: string): string {
  return (
    THEME_LABELS[shortName] ??
    shortName.charAt(0).toUpperCase() + shortName.slice(1)
  );
}

const UPSTREAM_THEMES: PlaygroundTheme[] = Object.entries(themeObjectsFull)
  .map(([packageName, theme]) => {
    const value = toShortName(packageName);
    return {value, label: toLabel(packageName, value), theme};
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const PLAYGROUND_THEMES: PlaygroundTheme[] = [
  {value: 'conduit', label: 'Conduit', theme: conduitTheme},
  ...UPSTREAM_THEMES,
];

export const PLAYGROUND_THEME_OPTIONS = PLAYGROUND_THEMES.map(
  ({value, label}) => ({value, label}),
);

export const themeByValue: Record<string, DefinedTheme> = Object.fromEntries(
  PLAYGROUND_THEMES.map(t => [t.value, t.theme]),
);

/** Default to Conduit Obsidian & Sage brand theme. */
export const DEFAULT_PLAYGROUND_THEME = 'conduit';
