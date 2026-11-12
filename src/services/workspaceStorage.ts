const scopeStorageKey = 'vernika_workspace_scope';
const originalGetItem = Storage.prototype.getItem;
const originalSetItem = Storage.prototype.setItem;
const originalRemoveItem = Storage.prototype.removeItem;
let workspacePrefix = 'vernika:guest:';

export function installWorkspaceStorage(): void {
  Storage.prototype.getItem = function (key: string) {
    return originalGetItem.call(this, key === scopeStorageKey ? key : `${workspacePrefix}${key}`);
  };
  Storage.prototype.setItem = function (key: string, value: string) {
    originalSetItem.call(this, key === scopeStorageKey ? key : `${workspacePrefix}${key}`, value);
  };
  Storage.prototype.removeItem = function (key: string) {
    originalRemoveItem.call(this, key === scopeStorageKey ? key : `${workspacePrefix}${key}`);
  };
  const savedScope = originalGetItem.call(sessionStorage, scopeStorageKey);
  if (savedScope) setWorkspaceStorageScope(savedScope);
}

export function setWorkspaceStorageScope(scope: string): void {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || 'guest';
  workspacePrefix = `vernika:${safeScope}:`;
  originalSetItem.call(sessionStorage, scopeStorageKey, safeScope);
}

export async function resolveWorkspaceStorageScope(): Promise<void> {
  try {
    const response = await fetch('/api/access/session', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return;
    const session = await response.json();
    if (session.authenticated) {
      setWorkspaceStorageScope(session.workspaceId || session.userId || `admin-${session.username || 'account'}`);
    } else {
      setWorkspaceStorageScope('guest');
    }
  } catch (error) {
    console.error('Could not resolve user workspace storage scope:', error);
  }
}
