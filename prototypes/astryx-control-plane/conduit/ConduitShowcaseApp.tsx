// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import React, {useCallback, useEffect, useState} from 'react';
import type {ScenarioPresetId} from './conduitState';
import {ConduitLandingPage} from './ConduitLandingPage';
import {ConduitWorkbench} from './ConduitWorkbench';

const VALID_SCENARIOS: ReadonlySet<string> = new Set([
  'live_hold_r02',
  'floor_leak_blocked',
  'post_release_pass',
  'discovery_95pct',
]);

function readRouteFromLocation(): {
  view: 'landing' | 'console';
  scenario: ScenarioPresetId;
} {
  if (typeof window === 'undefined') {
    return {view: 'landing', scenario: 'live_hold_r02'};
  }
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  const rawScenario = params.get('scenario') ?? 'live_hold_r02';
  const scenario: ScenarioPresetId = VALID_SCENARIOS.has(rawScenario)
    ? (rawScenario as ScenarioPresetId)
    : 'live_hold_r02';

  if (params.get('view') === 'console' || hash === '#console') {
    return {view: 'console', scenario};
  }
  return {view: 'landing', scenario};
}

export function ConduitShowcaseApp() {
  const [route, setRoute] = useState<{
    view: 'landing' | 'console';
    scenario: ScenarioPresetId;
    launchKey: number;
  }>(() => ({...readRouteFromLocation(), launchKey: 0}));
  const [colorMode, setColorMode] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = colorMode;
    }
  }, [colorMode]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(prev => ({
        ...readRouteFromLocation(),
        launchKey: prev.launchKey + 1,
      }));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleLaunchConsole = useCallback(
    (scenario: ScenarioPresetId = 'live_hold_r02') => {
      if (typeof window !== 'undefined') {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('view', 'console');
        nextUrl.searchParams.set('scenario', scenario);
        nextUrl.hash = '';
        window.history.pushState({}, '', nextUrl.toString());
        window.scrollTo(0, 0);
      }
      setRoute(prev => ({
        view: 'console',
        scenario,
        launchKey: prev.launchKey + 1,
      }));
    },
    [],
  );

  const handleBackToLanding = useCallback(() => {
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('view');
      nextUrl.searchParams.delete('scenario');
      nextUrl.hash = '';
      window.history.pushState({}, '', nextUrl.toString());
      window.scrollTo(0, 0);
    }
    setRoute(prev => ({
      view: 'landing',
      scenario: 'live_hold_r02',
      launchKey: prev.launchKey + 1,
    }));
  }, []);

  if (route.view === 'console') {
    return (
      <ConduitWorkbench
        key={`${route.scenario}-${route.launchKey}`}
        initialScenario={route.scenario}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        onBackToOverview={handleBackToLanding}
      />
    );
  }

  return (
    <ConduitLandingPage
      colorMode={colorMode}
      onColorModeChange={setColorMode}
      onLaunchConsole={handleLaunchConsole}
    />
  );
}
