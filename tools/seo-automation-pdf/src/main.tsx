import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installWorkspaceStorage, resolveWorkspaceStorageScope } from '../../../src/services/workspaceStorage';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/seo-pdf/sw.js', { scope: '/seo-pdf/' }).catch((error) => {
      // Ignore service worker registration errors inside restricted preview iframes
      console.warn('PDF Studio service worker registration failed:', error);
    });
  });
}

installWorkspaceStorage();
const root = createRoot(document.getElementById('root')!);
void resolveWorkspaceStorageScope().finally(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
