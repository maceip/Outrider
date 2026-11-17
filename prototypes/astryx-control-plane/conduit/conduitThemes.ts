// Copyright (c) Meta Platforms, Inc. and affiliates.

import type {DefinedTheme} from "@astryxdesign/core/theme";
import {neutralTheme} from "@astryxdesign/theme-neutral/built";
import {matchaTheme} from "@astryxdesign/theme-matcha/built";
import {stoneTheme} from "@astryxdesign/theme-stone/built";
import {gothicTheme} from "@astryxdesign/theme-gothic/built";
import {chocolateTheme} from "@astryxdesign/theme-chocolate/built";
import {y2kTheme} from "@astryxdesign/theme-y2k/built";
import {conduitTheme} from "./conduitTheme";

export const CONDUIT_THEMES: ReadonlyArray<{
  value: string;
  label: string;
  theme: DefinedTheme;
}> = [
  {value: "conduit", label: "Conduit", theme: conduitTheme},
  {value: "neutral", label: "Default", theme: neutralTheme},
  {value: "matcha", label: "Matcha", theme: matchaTheme},
  {value: "stone", label: "Stone", theme: stoneTheme},
  {value: "gothic", label: "Gothic", theme: gothicTheme},
  {value: "chocolate", label: "Chocolate", theme: chocolateTheme},
  {value: "y2k", label: "Y2K", theme: y2kTheme},
];

export const CONDUIT_THEME_OPTIONS = CONDUIT_THEMES.map(({value, label}) => ({
  value,
  label,
}));

export const conduitThemeByValue: Record<string, DefinedTheme> =
  Object.fromEntries(CONDUIT_THEMES.map(t => [t.value, t.theme]));

export const DEFAULT_CONDUIT_THEME = "conduit";
