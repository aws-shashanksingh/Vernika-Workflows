import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installWorkspaceStorage, resolveWorkspaceStorageScope } from '../../../src/services/workspaceStorage';

installWorkspaceStorage();
const root = createRoot(document.getElementById('root')!);
void resolveWorkspaceStorageScope().finally(() => root.render(<App />));
