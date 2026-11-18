import './styles.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {LayerProvider} from '@astryxdesign/core/Layer';
import {ConduitShowcaseApp} from '../conduit/ConduitShowcaseApp';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <LayerProvider>
        <ConduitShowcaseApp />
      </LayerProvider>
    </React.StrictMode>,
  );
}
