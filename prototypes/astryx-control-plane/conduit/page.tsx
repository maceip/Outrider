// Copyright (c) Meta Platforms, Inc. and affiliates.

import type {Metadata} from 'next';
import {ConduitShowcaseApp} from './ConduitShowcaseApp';

export const metadata: Metadata = {
  title: 'Conduit — Agents Are Already Shopping. Usher Them In Without Losing Money.',
  description:
    'Blocking bots turns away real buyers. Leaving endpoints open bleeds margin. Conduit welcomes AI shoppers on your terms.',
};

export default function ConduitPage() {
  return <ConduitShowcaseApp />;
}
