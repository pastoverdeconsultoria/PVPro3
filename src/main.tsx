import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './index.css';
import { App } from './App';

// As fontes vão no pacote (sem CDN) para o app abrir igual sem sinal.
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
