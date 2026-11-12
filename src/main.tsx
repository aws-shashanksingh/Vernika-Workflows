import {createRoot} from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from './App.tsx';
import './index.css';
import { installWorkspaceStorage, resolveWorkspaceStorageScope } from './services/workspaceStorage';

installWorkspaceStorage();
const root = createRoot(document.getElementById('root')!);
void resolveWorkspaceStorageScope().finally(() => {
  root.render(
    <HelmetProvider>
      <App />
    </HelmetProvider>,
  );
});
