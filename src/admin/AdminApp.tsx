import { FormEvent, useCallback, useEffect, useState } from 'react';
import { LockKeyhole, Plus, RefreshCw, Shield, Trash2, Users } from 'lucide-react';

type Tool = 'blogger' | 'indexer' | 'seo-pdf';
type UserRecord = {
  id: string;
  profile_name: string;
  username: string;
  status: 'active' | 'expired' | 'disabled';
  expires_at: string;
  assigned_tools: Tool[];
};
type AdminSession = {
  authenticated: boolean;
  role?: string;
  username?: string;
};
type Tab = 'users' | 'sessions' | 'logs' | 'keys' | 'usage';
type UsageReport = {
  measuredAt: string;
  rowsByTable: Record<string, number>;
  totalRows: number;
  storageByTable: Array<{
    table_name: string;
    total_bytes: number;
    table_bytes: number;
    index_bytes: number;
  }>;
  totalStorageBytes: number;
};

const toolLabels: Record<Tool, string> = {
  blogger: 'Automated Blogger',
  indexer: 'Blogger SEO Indexer',
  'seo-pdf': 'SEO PDF Studio',
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}

function localDate(value?: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDuration(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [sessions, setSessions] = useState<Record<string, unknown>[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [keys, setKeys] = useState<Record<string, unknown>[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyTool, setKeyTool] = useState<Tool>('blogger');
  const [keyValue, setKeyValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newOtp, setNewOtp] = useState('');
  const [expiresAt, setExpiresAt] = useState(localDate());
  const [assignedTools, setAssignedTools] = useState<Tool[]>(['blogger']);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editOtp, setEditOtp] = useState('');
  const [editProfileName, setEditProfileName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editTools, setEditTools] = useState<Tool[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const current = await request<AdminSession>('/api/access/session');
      setSession(current.authenticated && current.role === 'admin' ? current : null);
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : 'Could not verify session.');
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const loadUsers = useCallback(async () => {
    const records = await request<UserRecord[]>('/api/admin/users');
    setUsers(records);
    setSelectedUserId((previous) => records.some((user) => user.id === previous) ? previous : records[0]?.id || '');
  }, []);

  const loadTab = useCallback(async () => {
    if (!session) return;
    setError('');
    try {
      if (tab === 'users') await loadUsers();
      if (tab === 'sessions') setSessions(await request<Record<string, unknown>[]>('/api/admin/sessions'));
      if (tab === 'logs') setLogs(await request<Record<string, unknown>[]>('/api/admin/logs'));
      if (tab === 'usage') setUsage(await request<UsageReport>('/api/admin/usage'));
      if (tab === 'keys' && selectedUserId) {
        setKeys(await request<Record<string, unknown>[]>(`/api/admin/users/${selectedUserId}/keys`));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load admin data.');
    }
  }, [session, tab, selectedUserId, loadUsers]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  const toggleTool = (tool: Tool, selected: Tool[], update: (next: Tool[]) => void) => {
    update(selected.includes(tool) ? selected.filter((item) => item !== tool) : [...selected, tool]);
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await request<{ challengeId: string }>('/api/access/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, tool: 'blogger' }),
      });
      setChallengeId(result.challengeId);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await request('/api/access/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, otp }),
      });
      sessionStorage.removeItem('vernika_session');
      await refreshSession();
      setPassword('');
      setOtp('');
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : 'OTP verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setStatusMessage('');
    setCreating(true);
    try {
      await request('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          profile_name: profileName,
          username: newUsername,
          password: newPassword,
          otp: newOtp,
          expires_at: new Date(expiresAt).toISOString(),
          assigned_tools: assignedTools,
        }),
      });
      setProfileName('');
      setNewUsername('');
      setNewPassword('');
      setNewOtp('');
      setStatusMessage('Account created.');
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create account.');
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (user: UserRecord) => {
    setEditingUser(user);
    setEditProfileName(user.profile_name);
    setEditUsername(user.username);
    setEditExpiry(localDate(user.expires_at));
    setEditTools(user.assigned_tools);
    setEditPassword('');
    setEditOtp('');
    setStatusMessage('');
  };

  const saveUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setError('');
    try {
      await request(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          profile_name: editProfileName,
          username: editUsername,
          expires_at: new Date(editExpiry).toISOString(),
          assigned_tools: editTools,
          ...(editPassword ? { password: editPassword } : {}),
          ...(editOtp ? { otp: editOtp } : {}),
        }),
      });
      setStatusMessage('Account updated.');
      setEditingUser(null);
      await loadUsers();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update account.');
    }
  };

  const changeStatus = async (user: UserRecord) => {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadUsers();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update account status.');
    }
  };

  const renewUser = async (user: UserRecord) => {
    const currentExpiry = Date.parse(user.expires_at);
    const baseTime = Number.isFinite(currentExpiry) ? Math.max(Date.now(), currentExpiry) : Date.now();
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ expires_at: new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString() }),
      });
      setStatusMessage(`${user.profile_name} renewed for 30 days.`);
      await loadUsers();
    } catch (renewError) {
      setError(renewError instanceof Error ? renewError.message : 'Could not renew account.');
    }
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUserId) return;
    try {
      await request(`/api/admin/users/${selectedUserId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ name: keyName, tool: keyTool, value: keyValue }),
      });
      setKeyName('');
      setKeyValue('');
      setStatusMessage('Credential saved encrypted.');
      await loadTab();
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not save credential.');
    }
  };

  const removeKey = async (keyId: string) => {
    if (!selectedUserId) return;
    try {
      await request(`/api/admin/users/${selectedUserId}/keys/${keyId}`, { method: 'DELETE' });
      await loadTab();
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not delete credential.');
    }
  };

  const cleanupExpiredData = async () => {
    if (!window.confirm('Delete expired or revoked login sessions and expired login-attempt records? Customer accounts, activity logs, credentials, and tool data will not be deleted.')) return;
    setError('');
    setStatusMessage('');
    try {
      const result = await request<{ deleted: Record<string, number> }>('/api/admin/cleanup', { method: 'POST' });
      setStatusMessage(`Cleanup complete: ${Object.values(result.deleted).reduce((sum, count) => sum + count, 0)} obsolete security records removed.`);
      await loadTab();
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : 'Cleanup failed.');
    }
  };

  const logout = async () => {
    await request('/api/access/logout', { method: 'POST' });
    setSession(null);
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-500">Verifying admin session...</div>;

  if (!session) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-950 px-4 text-slate-100">
        <form onSubmit={challengeId ? submitOtp : submitLogin} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7">
          <div className="flex items-center gap-3"><Shield className="h-6 w-6 text-sky-400" /><h1 className="text-xl font-bold">Vernika Admin</h1></div>
          <p className="text-sm text-slate-400">Admin access for account and credential management.</p>
          {error && <p role="alert" className="rounded-lg bg-rose-950 p-3 text-sm text-rose-300">{error}</p>}
          {!challengeId ? (
            <>
              <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Admin username" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Admin password" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
            </>
          ) : (
            <input autoFocus inputMode="numeric" required minLength={6} maxLength={10} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="Verification OTP" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
          )}
          <button disabled={busy} className="w-full rounded-lg bg-sky-600 p-3 font-semibold disabled:opacity-50">{busy ? 'Please wait...' : challengeId ? 'Verify OTP' : 'Continue'}</button>
          <a href="/" className="block text-center text-xs text-slate-400 hover:text-white">Return to Vernika</a>
        </form>
      </main>
    );
  }

  const selectedUser = users.find((user) => user.id === selectedUserId);
  const dataRows = tab === 'sessions' ? sessions : logs;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div><p className="text-xs uppercase tracking-[0.2em] text-sky-400">Vernika Workflows</p><h1 className="text-xl font-bold">Administration</h1></div>
          <div className="flex items-center gap-3 text-sm"><span>{session.username}</span><button onClick={logout} className="rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800">Log out</button></div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <nav className="mb-6 flex flex-wrap gap-2">
          {(['users', 'sessions', 'logs', 'keys', 'usage'] as Tab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-4 py-2 text-sm capitalize ${tab === item ? 'bg-sky-600 text-white' : 'border border-slate-800 text-slate-300 hover:bg-slate-900'}`}>{item === 'keys' ? 'Credentials' : item}</button>
          ))}
          <button onClick={() => void loadTab()} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm"><RefreshCw className="h-4 w-4" />Refresh</button>
        </nav>
        {error && <p role="alert" className="mb-4 rounded-lg border border-rose-900 bg-rose-950/60 p-3 text-sm text-rose-300">{error}</p>}
        {statusMessage && <p role="status" className="mb-4 rounded-lg border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-300">{statusMessage}</p>}

        {tab === 'users' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="flex items-center gap-2 border-b border-slate-800 p-4"><Users className="h-4 w-4 text-sky-400" /><h2 className="font-semibold">Customer accounts</h2><span className="ml-auto text-xs text-slate-500">{users.length} accounts</span></div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/60 text-xs uppercase text-slate-500"><tr><th className="p-3">Profile</th><th className="p-3">Username</th><th className="p-3">Tools</th><th className="p-3">Status / Expiry</th><th className="p-3">Actions</th></tr></thead>
                  <tbody>{users.map((user) => <tr key={user.id} className={`border-t border-slate-800 ${user.id === selectedUserId ? 'bg-sky-950/30' : ''}`}>
                    <td className="p-3"><button onClick={() => setSelectedUserId(user.id)} className="font-medium hover:text-sky-300">{user.profile_name}</button></td>
                    <td className="p-3 font-mono text-xs">{user.username}</td>
                    <td className="max-w-52 p-3 text-xs text-slate-400">{user.assigned_tools.map((tool) => toolLabels[tool]).join(', ')}</td>
                    <td className="p-3"><span className={user.status === 'active' && Date.parse(user.expires_at) > Date.now() ? 'text-emerald-400' : 'text-amber-400'}>{user.status === 'active' && Date.parse(user.expires_at) <= Date.now() ? 'expired' : user.status}</span><span className="block text-xs text-slate-500">{new Date(user.expires_at).toLocaleDateString()}</span></td>
                    <td className="whitespace-nowrap p-3"><button onClick={() => startEditing(user)} className="mr-3 text-xs text-sky-300">Edit</button><button onClick={() => void renewUser(user)} className="mr-3 text-xs text-emerald-300">Renew 30d</button><button onClick={() => void changeStatus(user)} className="text-xs text-amber-300">{user.status === 'active' ? 'Disable' : 'Activate'}</button></td>
                  </tr>)}</tbody>
                </table>
                {!users.length && <p className="p-5 text-sm text-slate-500">No customer accounts have been created.</p>}
              </div>
              {editingUser && <form onSubmit={saveUser} className="space-y-3 border-t border-slate-800 p-4">
                <h3 className="font-semibold">Edit {editingUser.profile_name}</h3>
                <div className="grid gap-3 sm:grid-cols-2"><input required value={editProfileName} onChange={(event) => setEditProfileName(event.target.value)} placeholder="Profile name" className="rounded-lg border border-slate-700 bg-slate-950 p-2" /><input required value={editUsername} onChange={(event) => setEditUsername(event.target.value)} placeholder="Username" className="rounded-lg border border-slate-700 bg-slate-950 p-2" /><input type="datetime-local" required value={editExpiry} onChange={(event) => setEditExpiry(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2" /><input type="password" minLength={12} value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder="New password (optional, 12+)" className="rounded-lg border border-slate-700 bg-slate-950 p-2" /><input type="password" inputMode="numeric" minLength={6} maxLength={10} value={editOtp} onChange={(event) => setEditOtp(event.target.value.replace(/\D/g, ''))} placeholder="New OTP (optional)" className="rounded-lg border border-slate-700 bg-slate-950 p-2" /></div>
                <div className="flex flex-wrap gap-3">{(Object.keys(toolLabels) as Tool[]).map((tool) => <label key={tool} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editTools.includes(tool)} onChange={() => toggleTool(tool, editTools, setEditTools)} />{toolLabels[tool]}</label>)}</div>
                <div className="flex gap-2"><button className="rounded-lg bg-sky-600 px-4 py-2 text-sm">Save changes</button><button type="button" onClick={() => setEditingUser(null)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Cancel</button></div>
              </form>}
            </section>

            <form onSubmit={createUser} className="h-fit space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-sky-400" /><h2 className="font-semibold">Create account</h2></div>
              <input required value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Profile name" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              <input required autoComplete="off" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder="Login username" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              <input required type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Password (12+ characters)" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              <input required type="password" inputMode="numeric" minLength={6} maxLength={10} value={newOtp} onChange={(event) => setNewOtp(event.target.value.replace(/\D/g, ''))} placeholder="One-time login OTP (6-10 digits)" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              <label className="block text-xs text-slate-400">Access expires<input required type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label>
              <div className="space-y-2"><p className="text-xs text-slate-400">Assigned tools</p>{(Object.keys(toolLabels) as Tool[]).map((tool) => <label key={tool} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assignedTools.includes(tool)} onChange={() => toggleTool(tool, assignedTools, setAssignedTools)} />{toolLabels[tool]}</label>)}</div>
              <button disabled={creating} className="w-full rounded-lg bg-sky-600 p-3 font-semibold disabled:opacity-50">{creating ? 'Creating...' : 'Create customer'}</button>
            </form>
          </div>
        )}

        {tab === 'keys' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 font-semibold">Saved credential references</h2>
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"><option value="">Select profile</option>{users.map((user) => <option key={user.id} value={user.id}>{user.profile_name} ({user.username})</option>)}</select>
              <ul className="space-y-2">{keys.map((key) => <li key={String(key.id)} className="flex items-center justify-between rounded-lg border border-slate-800 p-3 text-sm"><span>{String(key.tool)} / {String(key.name)}</span><button onClick={() => void removeKey(String(key.id))} aria-label="Delete saved credential" className="text-rose-300"><Trash2 className="h-4 w-4" /></button></li>)}</ul>
              <p className="mt-3 text-xs text-slate-500">Values are never returned to the browser after saving.</p>
            </section>
            <form onSubmit={saveKey} className="h-fit space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="font-semibold">Add or replace credential</h2>
              <p className="text-xs text-slate-400">Use the exact identifier for each integration: Blogger — GOOGLE_REFRESH_TOKEN, GEMINI_API_KEY, DEEPSEEK_API_KEY, POLLINATIONS_API_KEY, or n8n-config; Indexer — GOOGLE_SERVICE_ACCOUNT_JSON; PDF Studio — GOOGLE_SERVICE_ACCOUNT_JSON, GITHUB_TOKEN, or INDEXNOW_KEY.</p>
              <select value={keyTool} onChange={(event) => setKeyTool(event.target.value as Tool)} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3">{(Object.keys(toolLabels) as Tool[]).map((tool) => <option value={tool} key={tool}>{toolLabels[tool]}</option>)}</select>
              <input required value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Exact credential identifier" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
              <textarea required value={keyValue} onChange={(event) => setKeyValue(event.target.value)} placeholder="Secret or JSON credential value" rows={6} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs" />
              <button disabled={!selectedUserId} className="w-full rounded-lg bg-sky-600 p-3 font-semibold disabled:opacity-50"><LockKeyhole className="mr-2 inline h-4 w-4" />Encrypt and save</button>
            </form>
          </div>
        )}

        {tab === 'usage' && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Database usage</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {usage ? `Approximate row counts · measured ${new Date(usage.measuredAt).toLocaleString()}` : 'Loading table counts...'}
                </p>
              </div>
              <button onClick={() => void cleanupExpiredData()} className="rounded-lg border border-amber-700/70 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/50">
                Clean expired security records
              </button>
            </div>
            {usage && (
              <>
                <p className="mt-5 text-2xl font-semibold">{formatBytes(usage.totalStorageBytes)} <span className="text-sm font-normal text-slate-400">tracked table storage</span></p>
                <p className="mt-1 text-xs text-slate-500">{usage.totalRows.toLocaleString()} rows across tracked tables</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {usage.storageByTable.map((row) => (
                    <div key={row.table_name} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-400">{row.table_name}</p>
                      <p className="mt-1 font-mono text-lg">{formatBytes(row.total_bytes)}</p>
                      <p className="text-[11px] text-slate-500">{formatBytes(row.table_bytes)} data · {formatBytes(row.index_bytes)} indexes</p>
                    </div>
                  ))}
                  {Object.entries(usage.rowsByTable).map(([table, count]) => (
                    <div key={table} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-400">{table.replaceAll('_', ' ')} rows</p>
                      <p className="mt-1 font-mono text-lg">{count.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-500">The safe cleanup removes only expired/revoked sessions and expired login-attempt records. It does not remove customer accounts, activity history, saved credentials, or tool data. Counts are not an estimate of bytes or Supabase billing usage.</p>
              </>
            )}
          </section>
        )}

        {(tab === 'sessions' || tab === 'logs') && (
          <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase text-slate-500"><tr>{Object.keys(dataRows[0] || { user: '', event: '', device: '', ip: '', date: '' }).map((key) => <th className="p-3" key={key}>{key === 'duration_seconds' ? 'Duration' : key.replaceAll('_', ' ')}</th>)}</tr></thead>
              <tbody>{dataRows.map((row, index) => <tr className="border-t border-slate-800" key={String(row.id || index)}>{Object.entries(row).map(([key, value]) => <td className="max-w-xs p-3 text-xs" key={key}>{key === 'duration_seconds' ? formatDuration(value) : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')}</td>)}</tr>)}</tbody>
            </table>
            {!dataRows.length && <p className="p-5 text-sm text-slate-500">No records available.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
