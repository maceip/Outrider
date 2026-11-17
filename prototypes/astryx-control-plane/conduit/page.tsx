// Copyright (c) Meta Platforms, Inc. and affiliates.

import type {Metadata} from 'next';
import {ConduitWorkbench} from './ConduitWorkbench';

export const metadata: Metadata = {
  title: 'Conduit MCP Control Plane',
  description:
    'Astryx interactive mock of the Conduit MCP Merchant Control Plane with 2-zone Observatory and contextual Quote Approval.',
};

export default function ConduitPage() {
  return <ConduitWorkbench />;
}
