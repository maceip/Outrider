// Copyright (c) Meta Platforms, Inc. and affiliates.

import type {Metadata} from 'next';
import {ConduitShowcaseApp} from './ConduitShowcaseApp';

export const metadata: Metadata = {
  title: 'Conduit — Agentic Commerce Control Plane',
  description:
    'See every AI shopping agent visiting your store, stop below-floor discounts mid-flight, and gate checkout behind single-use Ed25519 passes.',
};

export default function ConduitPage() {
  return <ConduitShowcaseApp />;
}
