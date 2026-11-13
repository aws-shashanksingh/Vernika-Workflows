import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileText,
  KeyRound,
  LockKeyhole,
  Moon,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Sun,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Check,
} from 'lucide-react';

type Tool = 'blogger' | 'indexer' | 'seo-pdf';
type CleanupScope = 'security' | 'logs' | 'unused_keys' | 'data' | 'all';
type Tab = 'active-users' | 'new-user' | 'users' | 'database' | 'storage' | 'logs' | 'keys' | 'security';

type HealthResponse = {
  checks: {
    supabaseUrl: boolean;
    supabaseServerKey: boolean;
    adminUsername: boolean;
    adminPassword: boolean;
    adminOtp: boolean;
    sessionSecret: boolean;
    credentialEncryptionKey: boolean;
    loginSchema: boolean;
  };
  readyForAdminLogin: boolean;
};

type UserRecord = {
  id: string;
  profile_name: string;
  username: string;
  status: 'active' | 'expired' | 'disabled';
  expires_at: string;
  assigned_tools: Tool[];
  created_at?: string;
  updated_at?: string;
};

type AdminSession = {
  authenticated: boolean;
  role?: string;
  username?: string;
};

type SessionRecord = {
  id: string;
  user_id: string;
  device_info?: string;
  ip_address?: string;
  created_at: string;
  last_active_at?: string;
  expires_at: string;
  revoked_at?: string | null;
  duration_seconds?: number;
  workflow_users?:
    | {
        id?: string;
        profile_name?: string;
        username?: string;
        status?: string;
        expires_at?: string;
        assigned_tools?: Tool[];
      }
    | Array<{
        id?: string;
        profile_name?: string;
        username?: string;
        status?: string;
        expires_at?: string;
        assigned_tools?: Tool[];
      }>
    | null;
};

type LogRecord = {
  id: string;
  user_id?: string | null;
  event_type: string;
  ip_address?: string;
  device_info?: string;
  details?: Record<string, unknown> | null;
  created_at: string;
  workflow_users?: { profile_name?: string; username?: string } | Array<{ profile_name?: string; username?: string }> | null;
};

type CredentialRecord = {
  id: string;
  tool: Tool;
  name: string;
  created_at?: string;
  updated_at?: string;
};

type GlobalSecretRecord = {
  id: string;
  user_id: string;
  tool: Tool;
  name: string;
  created_at?: string;
  updated_at?: string;
  profile_name: string;
  username: string;
  user_status: string;
  is_unused: boolean;
};

type GlobalServiceAccountRecord = {
  id: string;
  user_id: string;
  project_name: string;
  client_email: string;
  daily_count: number;
  last_reset_date: string;
  is_active: boolean;
  admin_managed: boolean;
  created_at?: string;
  updated_at?: string;
  profile_name: string;
  username: string;
  is_unused: boolean;
};

type SecurityOverview = {
  activeSessionsCount: number;
  lockedAttempts: Array<{
    id: string;
    attempts: number;
    locked_until: string | null;
    expires_at: string;
    created_at: string;
  }>;
  overdueActiveUsers: Array<{
    id: string;
    profile_name: string;
    username: string;
    status: string;
    expires_at: string;
  }>;
  expiringSoonUsers: Array<{
    id: string;
    profile_name: string;
    username: string;
    status: string;
    expires_at: string;
  }>;
};

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
  unusedSecretsCount?: number;
  inactiveServiceAccountsCount?: number;
};

type UserStorageBreakdown = UserRecord & {
  secretsCount: number;
  sessionsCount: number;
  logsCount: number;
  serviceAccountsCount: number;
  estimatedBytes: number;
};

type DatabaseTableSummary = {
  table_name: string;
  row_count: number;
  error?: string | null;
};

const toolLabels: Record<Tool, string> = {
  blogger: 'Automated Blogger',
  indexer: 'Blogger SEO Indexer',
  'seo-pdf': 'SEO PDF Studio',
};

const toolCredentialOptions: Record<Tool, string[]> = {
  blogger: ['GOOGLE_REFRESH_TOKEN', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'POLLINATIONS_API_KEY', 'n8n-config'],
  indexer: ['GOOGLE_SERVICE_ACCOUNT_JSON'],
  'seo-pdf': ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GITHUB_TOKEN', 'INDEXNOW_KEY'],
};

const navTabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: 'active-users', label: 'Active Users', icon: UserCheck },
  { id: 'new-user', label: 'New User', icon: UserPlus },
  { id: 'users', label: 'Manage Users', icon: Users },
  { id: 'database', label: 'Database Manager', icon: Database },
  { id: 'storage', label: 'Storage Usage', icon: Activity },
  { id: 'logs', label: 'Device & Logs Tree', icon: FileText },
  { id: 'keys', label: 'Keys Vault', icon: KeyRound },
  { id: 'security', label: 'Security Center', icon: ShieldAlert },
];

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

function localDate(value?: string | number) {
  const date = typeof value === 'number'
    ? new Date(Date.now() + value)
    : value
      ? new Date(value)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function generateSecurePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function generateSecureOtp(digits = 6): string {
  const bytes = new Uint32Array(digits);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => String(b % 10)).join('');
}

function formatDuration(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
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

function resolveUserRelation(relation: SessionRecord['workflow_users']) {
  const entry = Array.isArray(relation) ? relation[0] : relation;
  return {
    id: entry?.id || '',
    profileName: entry?.profile_name || '',
    username: entry?.username || '',
    status: entry?.status || '',
    expiresAt: entry?.expires_at || '',
    assignedTools: Array.isArray(entry?.assigned_tools) ? entry.assigned_tools : [],
  };
}

function formatLogDetails(details: Record<string, unknown> | null | undefined): string {
  if (!details || typeof details !== 'object') return '--';
  const entries = Object.entries(details).filter(([, val]) => val !== undefined && val !== null && val !== '');
  if (!entries.length) return '--';
  return entries
    .map(([key, val]) => {
      const label = key.replaceAll('_', ' ');
      const rendered = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `${label}: ${rendered}`;
    })
    .join(' | ');
}

function getEffectiveUserStatus(user: UserRecord): 'active' | 'expiring' | 'expired' | 'disabled' {
  if (user.status === 'disabled') return 'disabled';
  const expiryMs = Date.parse(user.expires_at);
  if (user.status === 'expired' || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    return 'expired';
  }
  if (expiryMs - Date.now() <= 2 * 24 * 60 * 60 * 1000) {
    return 'expiring';
  }
  return 'active';
}

export default function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [tab, setTab] = useState<Tab>('active-users');
  const [busy, setBusy] = useState(false);

  // Theme support
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('vernika_admin_theme') as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('vernika_admin_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Shared core records
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [activeUsers, setActiveUsers] = useState<SessionRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);

  // Database manager state
  const [dbTables, setDbTables] = useState<DatabaseTableSummary[]>([]);
  const [selectedDbTable, setSelectedDbTable] = useState<string>('workflow_users');
  const [dbRecords, setDbRecords] = useState<Record<string, unknown>[]>([]);
  const [dbSearch, setDbSearch] = useState('');

  // Storage breakdown state
  const [storageBreakdown, setStorageBreakdown] = useState<UserStorageBreakdown[]>([]);

  // Logs tree state
  const [expandedUsersInTree, setExpandedUsersInTree] = useState<Record<string, boolean>>({});
  const [logTreeSearch, setLogTreeSearch] = useState('');

  // Keys state
  const [selectedUserId, setSelectedUserId] = useState('');
  const [keys, setKeys] = useState<CredentialRecord[]>([]);
  const [globalSecrets, setGlobalSecrets] = useState<GlobalSecretRecord[]>([]);
  const [globalServiceAccounts, setGlobalServiceAccounts] = useState<GlobalServiceAccountRecord[]>([]);
  const [keyAuditFilter, setKeyAuditFilter] = useState<'all' | 'unused' | 'secrets' | 'service_accounts'>('all');
  const [keyTool, setKeyTool] = useState<Tool>('blogger');
  const [keyName, setKeyName] = useState<string>(toolCredentialOptions.blogger[0]);
  const [keyValue, setKeyValue] = useState('');

  // New user creation state
  const [profileName, setProfileName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newOtp, setNewOtp] = useState('');
  const [expiresAt, setExpiresAt] = useState(localDate());
  const [assignedTools, setAssignedTools] = useState<Tool[]>(['blogger']);
  const [createdSummary, setCreatedSummary] = useState<{
    id: string;
    profileName: string;
    username: string;
    password: string;
    otp: string;
    expiresAt: string;
    tools: Tool[];
  } | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Existing user management filters & editing
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'active' | 'expiring' | 'expired' | 'disabled'>('all');
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editProfileName, setEditProfileName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editOtp, setEditOtp] = useState('');
  const [editStatus, setEditStatus] = useState<UserRecord['status']>('active');
  const [editExpiry, setEditExpiry] = useState('');
  const [editTools, setEditTools] = useState<Tool[]>([]);
  const [renewMonths, setRenewMonths] = useState<Record<string, number>>({});

  // Security & Usage confirmations
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [cleanupScope, setCleanupScope] = useState<CleanupScope>('security');
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const current = await request<AdminSession>('/api/access/session');
      if (current.authenticated && current.role === 'admin') {
        setSession(current);
      } else {
        setSession(null);
        const healthData = await request<HealthResponse>('/api/access/health').catch(() => null);
        setHealth(healthData);
      }
    } catch (sessionError) {
      setError(sessionError instanceof Error ? sessionError.message : 'Could not verify admin session.');
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
    setSelectedUserId((previous) => (records.some((user) => user.id === previous) ? previous : records[0]?.id || ''));
    return records;
  }, []);

  const loadTab = useCallback(async () => {
    if (!session) return;
    setError('');
    try {
      if (tab === 'active-users') {
        const [activeList, userList, usageData] = await Promise.all([
          request<SessionRecord[]>('/api/admin/active-users'),
          loadUsers(),
          request<UsageReport>('/api/admin/usage').catch(() => null),
        ]);
        setActiveUsers(activeList);
        if (userList) setUsers(userList);
        if (usageData) setUsage(usageData);
      } else if (tab === 'new-user') {
        await loadUsers();
      } else if (tab === 'users') {
        await loadUsers();
      } else if (tab === 'database') {
        const [tables, recs, userList] = await Promise.all([
          request<DatabaseTableSummary[]>('/api/admin/database/tables'),
          request<{ data: Record<string, unknown>[] }>(`/api/admin/database/records?table=${selectedDbTable}`),
          loadUsers(),
        ]);
        setDbTables(tables);
        setDbRecords(recs.data || []);
        if (userList) setUsers(userList);
      } else if (tab === 'storage') {
        const [breakdown, usageData] = await Promise.all([
          request<UserStorageBreakdown[]>('/api/admin/users/storage-breakdown'),
          request<UsageReport>('/api/admin/usage').catch(() => null),
        ]);
        setStorageBreakdown(breakdown);
        if (usageData) setUsage(usageData);
      } else if (tab === 'logs') {
        const [logsData, userList] = await Promise.all([
          request<LogRecord[]>('/api/admin/logs'),
          loadUsers(),
        ]);
        setLogs(logsData);
        if (userList) setUsers(userList);
      } else if (tab === 'keys') {
        const currentUsers = await loadUsers();
        const targetId = selectedUserId && currentUsers.some((u) => u.id === selectedUserId)
          ? selectedUserId
          : currentUsers[0]?.id || '';
        const [allKeysData, userKeysData] = await Promise.all([
          request<{ secrets: GlobalSecretRecord[]; serviceAccounts: GlobalServiceAccountRecord[] }>('/api/admin/keys'),
          targetId ? request<CredentialRecord[]>(`/api/admin/users/${targetId}/keys`) : Promise.resolve([]),
        ]);
        setGlobalSecrets(allKeysData.secrets || []);
        setGlobalServiceAccounts(allKeysData.serviceAccounts || []);
        setKeys(userKeysData);
      } else if (tab === 'security') {
        const [secData, sessionsData] = await Promise.all([
          request<SecurityOverview>('/api/admin/security'),
          request<SessionRecord[]>('/api/admin/sessions'),
        ]);
        setSecurityOverview(secData);
        setSessions(sessionsData);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load admin data.');
    }
  }, [session, tab, selectedUserId, selectedDbTable, loadUsers]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  // Load table records when selectedDbTable changes
  useEffect(() => {
    if (!session || tab !== 'database' || !selectedDbTable) return;
    request<{ data: Record<string, unknown>[] }>(`/api/admin/database/records?table=${selectedDbTable}&search=${encodeURIComponent(dbSearch)}`)
      .then((res) => setDbRecords(res.data || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load table records.'));
  }, [session, tab, selectedDbTable, dbSearch]);

  const toggleTool = (tool: Tool, selected: Tool[], update: (next: Tool[]) => void) => {
    update(selected.includes(tool) ? selected.filter((item) => item !== tool) : [...selected, tool]);
  };

  const handleKeyToolChange = (nextTool: Tool) => {
    setKeyTool(nextTool);
    setKeyName(toolCredentialOptions[nextTool][0]);
  };

  const handleKeyJsonFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setKeyValue(content.trim());
      setStatusMessage(`Loaded ${file.name} into credential value.`);
    } catch {
      setError('Could not read the selected JSON file.');
    } finally {
      event.target.value = '';
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await request<{ challengeId: string }>('/api/access/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, portal: 'admin' }),
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
      setChallengeId('');
      setOtp('');
      await refreshSession();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const logoutAdmin = async () => {
    await request('/api/access/logout', { method: 'POST' }).catch(() => {});
    setSession(null);
    setUsername('');
    setPassword('');
    setOtp('');
    setChallengeId('');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-200">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="font-medium text-sm">Loading Administration Console...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Admin Console</h1>
                <p className="text-xs text-slate-400">Secure Administrative Gateway</p>
              </div>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-950/50 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {health && !health.readyForAdminLogin && (
            <div className="mb-4 p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs space-y-1">
              <p className="font-semibold">Configuration Notice:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-200/80">
                {!health.checks.supabaseUrl && <li>Missing SUPABASE_URL</li>}
                {!health.checks.supabaseServerKey && <li>Missing SUPABASE_SERVICE_ROLE_KEY</li>}
                {!health.checks.adminPassword && <li>Missing ADMIN_PASSWORD in environment</li>}
                {!health.checks.adminOtp && <li>Missing or invalid ADMIN_OTP (6-10 digits)</li>}
                {!health.checks.loginSchema && <li>Database tables not created (run migration SQL)</li>}
              </ul>
            </div>
          )}

          {!challengeId ? (
            <form onSubmit={submitLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Admin Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Enter admin username"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Enter admin password"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl font-medium text-sm transition shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {busy ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitOtp} className="space-y-4">
              <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-300">
                Enter your administrative verification code (OTP) configured in environment variables.
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Verification Code (OTP)</label>
                <input
                  type="text"
                  required
                  maxLength={10}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm tracking-widest text-center font-mono focus:outline-none focus:border-indigo-500"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl font-medium text-sm transition shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {busy ? 'Verifying...' : 'Verify Code'}
              </button>
              <button
                type="button"
                onClick={() => setChallengeId('')}
                className="w-full py-2 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-200 ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'}`}>
      {/* Top Header */}
      <header className={`border-b sticky top-0 z-30 backdrop-blur-md ${theme === 'dark' ? 'bg-slate-900/80 border-slate-800' : 'bg-white/80 border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-600/30">
              V
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">Admin Console</h1>
              <p className={`text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                Signed in as <span className="font-semibold">{session.username}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`p-2 rounded-xl border transition ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={logoutAdmin}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium border transition ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Sub-header */}
      <nav className={`border-b overflow-x-auto ${theme === 'dark' ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-200'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-2 py-2.5">
          {navTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : theme === 'dark'
                      ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {statusMessage && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage('')} className="text-emerald-400 hover:text-emerald-200 font-bold">dismiss</button>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-500/30 text-red-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-200 font-bold">dismiss</button>
          </div>
        )}

        {/* TAB 1: ACTIVE USERS */}
        {tab === 'active-users' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Active Sessions</p>
                <p className="text-2xl font-bold mt-1 text-indigo-500">{activeUsers.length}</p>
              </div>
              <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Total Registered Users</p>
                <p className="text-2xl font-bold mt-1 text-emerald-500">{users.length}</p>
              </div>
              <div className={`p-5 rounded-2xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Database Rows</p>
                <p className="text-2xl font-bold mt-1 text-amber-500">{usage?.totalRows || 0}</p>
              </div>
            </div>

            <div className={`rounded-2xl border overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className="px-6 py-4 border-b border-inherit flex items-center justify-between">
                <h2 className="text-sm font-semibold">Active User Sessions</h2>
                <button
                  onClick={() => void loadTab()}
                  className={`p-2 rounded-xl border transition ${theme === 'dark' ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950/50 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <tr>
                      <th className="px-6 py-3.5 font-semibold">Profile</th>
                      <th className="px-6 py-3.5 font-semibold">Username</th>
                      <th className="px-6 py-3.5 font-semibold">IP Address</th>
                      <th className="px-6 py-3.5 font-semibold">Device</th>
                      <th className="px-6 py-3.5 font-semibold">Session Duration</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-slate-200'}`}>
                    {!activeUsers.length ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                          No active user sessions found.
                        </td>
                      </tr>
                    ) : (
                      activeUsers.map((item) => {
                        const u = resolveUserRelation(item.workflow_users);
                        return (
                          <tr key={item.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                            <td className="px-6 py-4 font-medium">{u.profileName || 'Unnamed'}</td>
                            <td className="px-6 py-4 font-mono text-indigo-400">{u.username || 'unknown'}</td>
                            <td className="px-6 py-4 font-mono">{item.ip_address || '127.0.0.1'}</td>
                            <td className="px-6 py-4 text-slate-400 truncate max-w-xs">{item.device_info || 'Web Client'}</td>
                            <td className="px-6 py-4 font-medium">{formatDuration(item.duration_seconds)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: NEW USER */}
        {tab === 'new-user' && (
          <div className="max-w-2xl mx-auto">
            <div className={`p-8 rounded-2xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <h2 className="text-base font-bold mb-1">Create Customer User Profile</h2>
              <p className={`text-xs mb-6 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                New user profiles automatically inherit default keys and configurations.
              </p>

              {createdSummary ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs">
                    Account created successfully! Credentials automatically saved.
                  </div>
                  <div className={`p-4 rounded-xl font-mono text-xs space-y-2 ${theme === 'dark' ? 'bg-slate-950' : 'bg-slate-50 border border-slate-200'}`}>
                    <div><span className="text-slate-400">Profile:</span> {createdSummary.profileName}</div>
                    <div><span className="text-slate-400">Username:</span> {createdSummary.username}</div>
                    <div><span className="text-slate-400">Password:</span> {createdSummary.password}</div>
                    <div><span className="text-slate-400">OTP Code:</span> {createdSummary.otp}</div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`Username: ${createdSummary.username}\nPassword: ${createdSummary.password}\nOTP: ${createdSummary.otp}`);
                      setCopiedSummary(true);
                      setTimeout(() => setCopiedSummary(false), 2000);
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-xs transition flex items-center justify-center gap-2"
                  >
                    {copiedSummary ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedSummary ? 'Copied to Clipboard' : 'Copy Credentials'}</span>
                  </button>
                  <button
                    onClick={() => {
                      setCreatedSummary(null);
                      setProfileName('');
                      setNewUsername('');
                    }}
                    className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-200 transition"
                  >
                    Create Another Account
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setError('');
                    setBusy(true);
                    try {
                      const res = await request<UserRecord>('/api/admin/users', {
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
                      setCreatedSummary({
                        id: res.id,
                        profileName,
                        username: newUsername,
                        password: newPassword,
                        otp: newOtp,
                        expiresAt,
                        tools: assignedTools,
                      });
                      setStatusMessage('User created and credentials seeded successfully.');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not create user.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1">Profile Name / Company</label>
                      <input
                        type="text"
                        required
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        placeholder="Acme Corp"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Username / Email</label>
                      <input
                        type="text"
                        required
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        placeholder="user@acme.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium">Password (12+ chars)</label>
                        <button
                          type="button"
                          onClick={() => setNewPassword(generateSecurePassword())}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300"
                        >
                          Generate
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        minLength={12}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-mono border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium">OTP Code (6-10 digits)</label>
                        <button
                          type="button"
                          onClick={() => setNewOtp(generateSecureOtp())}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300"
                        >
                          Generate
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        maxLength={10}
                        value={newOtp}
                        onChange={(e) => setNewOtp(e.target.value)}
                        className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-mono tracking-widest border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1">Account Expiry Date</label>
                    <input
                      type="datetime-local"
                      required
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-2">Assigned Tools</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {(['blogger', 'indexer', 'seo-pdf'] as Tool[]).map((tool) => (
                        <button
                          key={tool}
                          type="button"
                          onClick={() => toggleTool(tool, assignedTools, setAssignedTools)}
                          className={`p-3 rounded-xl border text-left text-xs font-medium transition ${
                            assignedTools.includes(tool)
                              ? 'border-indigo-500 bg-indigo-600/10 text-indigo-400'
                              : theme === 'dark' ? 'border-slate-800 bg-slate-950 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}
                        >
                          {toolLabels[tool]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !assignedTools.length}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-xs transition shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                  >
                    {busy ? 'Creating User...' : 'Create Account & Seed Keys'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: USERS MANAGEMENT */}
        {tab === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users..."
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
                {(['all', 'active', 'expiring', 'expired', 'disabled'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setUserFilter(filter)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition ${
                      userFilter === filter
                        ? 'bg-indigo-600 text-white'
                        : theme === 'dark' ? 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className={`rounded-2xl border overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950/50 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <tr>
                      <th className="px-6 py-3.5 font-semibold">Profile Name</th>
                      <th className="px-6 py-3.5 font-semibold">Username</th>
                      <th className="px-6 py-3.5 font-semibold">Status</th>
                      <th className="px-6 py-3.5 font-semibold">Expires At</th>
                      <th className="px-6 py-3.5 font-semibold">Assigned Tools</th>
                      <th className="px-6 py-3.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-slate-200'}`}>
                    {users
                      .filter((u) => {
                        const eff = getEffectiveUserStatus(u);
                        if (userFilter !== 'all' && eff !== userFilter) return false;
                        if (userSearch) {
                          const q = userSearch.toLowerCase();
                          return u.profile_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
                        }
                        return true;
                      })
                      .map((u) => {
                        const eff = getEffectiveUserStatus(u);
                        return (
                          <tr key={u.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                            <td className="px-6 py-4 font-medium">{u.profile_name}</td>
                            <td className="px-6 py-4 font-mono text-indigo-400">{u.username}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                eff === 'active'
                                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                                  : eff === 'expiring'
                                    ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                                    : 'bg-red-950/60 text-red-400 border border-red-500/30'
                              }`}>
                                {eff}
                              </span>
                            </td>
                            <td className="px-6 py-4">{new Date(u.expires_at).toLocaleString()}</td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1">
                                {u.assigned_tools.map((t) => (
                                  <span key={t} className="px-2 py-0.5 rounded bg-indigo-600/10 text-indigo-400 text-[10px]">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right space-x-2">
                              <button
                                onClick={() => {
                                  setEditingUser(u);
                                  setEditProfileName(u.profile_name);
                                  setEditUsername(u.username);
                                  setEditStatus(u.status);
                                  setEditExpiry(localDate(u.expires_at));
                                  setEditTools(u.assigned_tools);
                                  setEditPassword('');
                                  setEditOtp('');
                                }}
                                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
                              >
                                Edit
                              </button>
                              <button
                                onClick={async () => {
                                  if (!confirm(`Disable account for ${u.username}?`)) return;
                                  try {
                                    await request(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                                    setStatusMessage(`Disabled user ${u.username}`);
                                    await loadUsers();
                                  } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Could not disable user.');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium transition"
                              >
                                Disable
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Edit User Modal */}
            {editingUser && (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className={`max-w-lg w-full rounded-2xl border p-6 space-y-4 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-2xl'}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold">Edit User Account</h3>
                    <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-200">X</button>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await request(`/api/admin/users/${editingUser.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            profile_name: editProfileName,
                            username: editUsername,
                            status: editStatus,
                            expires_at: new Date(editExpiry).toISOString(),
                            assigned_tools: editTools,
                            ...(editPassword ? { password: editPassword } : {}),
                            ...(editOtp ? { otp: editOtp } : {}),
                          }),
                        });
                        setStatusMessage('User updated successfully.');
                        setEditingUser(null);
                        await loadUsers();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Could not update user.');
                      }
                    }}
                    className="space-y-3 text-xs"
                  >
                    <div>
                      <label className="block font-medium mb-1">Profile Name</label>
                      <input
                        type="text"
                        value={editProfileName}
                        onChange={(e) => setEditProfileName(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Username</label>
                      <input
                        type="text"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className={`w-full px-3 py-2 rounded-xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium mb-1">New Password (optional)</label>
                        <input
                          type="text"
                          placeholder="Leave blank to keep"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          className={`w-full px-3 py-2 rounded-xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">New OTP (optional)</label>
                        <input
                          type="text"
                          placeholder="Leave blank to keep"
                          value={editOtp}
                          onChange={(e) => setEditOtp(e.target.value)}
                          className={`w-full px-3 py-2 rounded-xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium mb-1">Status</label>
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as UserRecord['status'])}
                          className={`w-full px-3 py-2 rounded-xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        >
                          <option value="active">Active</option>
                          <option value="expired">Expired</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Expires At</label>
                        <input
                          type="datetime-local"
                          value={editExpiry}
                          onChange={(e) => setEditExpiry(e.target.value)}
                          className={`w-full px-3 py-2 rounded-xl border ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Assigned Tools</label>
                      <div className="flex gap-2">
                        {(['blogger', 'indexer', 'seo-pdf'] as Tool[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => toggleTool(t, editTools, setEditTools)}
                            className={`px-3 py-1.5 rounded-lg border font-medium ${
                              editTools.includes(t)
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-3">
                      <button
                        type="button"
                        onClick={() => setEditingUser(null)}
                        className="px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: DATABASE MANAGER */}
        {tab === 'database' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {dbTables.map((tbl) => (
                <button
                  key={tbl.table_name}
                  onClick={() => setSelectedDbTable(tbl.table_name)}
                  className={`p-4 rounded-2xl border text-left transition ${
                    selectedDbTable === tbl.table_name
                      ? 'border-indigo-500 bg-indigo-600/10'
                      : theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800/50' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-[11px] text-slate-400 font-mono truncate">{tbl.table_name}</p>
                  <p className="text-xl font-bold mt-1 text-indigo-500">{tbl.row_count}</p>
                </button>
              ))}
            </div>

            <div className={`rounded-2xl border overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className="px-6 py-4 border-b border-inherit flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-sm font-bold font-mono">Table: {selectedDbTable}</h2>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={dbSearch}
                      onChange={(e) => setDbSearch(e.target.value)}
                      placeholder="Filter records..."
                      className={`w-full pl-10 pr-4 py-2 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                    />
                  </div>
                  <button
                    onClick={() => {
                      request<{ data: Record<string, unknown>[] }>(`/api/admin/database/records?table=${selectedDbTable}`)
                        .then((res) => setDbRecords(res.data || []))
                        .catch((err) => setError(err.message));
                    }}
                    className={`p-2 rounded-xl border transition ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[550px]">
                {!dbRecords.length ? (
                  <div className="p-12 text-center text-slate-400 text-xs">No records found in this table.</div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className={`sticky top-0 border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                      <tr>
                        {Object.keys(dbRecords[0] || {}).map((col) => (
                          <th key={col} className="px-6 py-3 font-mono font-semibold">{col}</th>
                        ))}
                        <th className="px-6 py-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-slate-200'}`}>
                      {dbRecords.map((row, idx) => {
                        const rowId = String(row.id || idx);
                        return (
                          <tr key={rowId} className={`transition ${theme === 'dark' ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                            {Object.entries(row).map(([col, val]) => (
                              <td key={col} className="px-6 py-3 font-mono text-[11px] max-w-xs truncate">
                                {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')}
                              </td>
                            ))}
                            <td className="px-6 py-3 text-right">
                              {row.id ? (
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Delete record ID ${String(row.id)} from ${selectedDbTable}?`)) return;
                                    try {
                                      await request('/api/admin/database/records', {
                                        method: 'DELETE',
                                        body: JSON.stringify({ table: selectedDbTable, id: row.id }),
                                      });
                                      setStatusMessage(`Deleted record from ${selectedDbTable}`);
                                      setDbRecords(dbRecords.filter((r) => r.id !== row.id));
                                    } catch (err) {
                                      setError(err instanceof Error ? err.message : 'Could not delete record.');
                                    }
                                  }}
                                  className="p-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 transition"
                                  title="Delete record"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <span className="text-slate-500 text-[10px]">No ID</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: STORAGE USAGE */}
        {tab === 'storage' && (
          <div className="space-y-6">
            <div className={`p-6 rounded-2xl border flex items-center justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div>
                <h2 className="text-base font-bold">User-by-User Storage & Usage Analytics</h2>
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                  Estimated disk footprint, secret counts, session histories, and activity logs per user profile.
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Total Estimated Footprint</p>
                <p className="text-xl font-bold text-indigo-500">
                  {formatBytes(storageBreakdown.reduce((sum, u) => sum + u.estimatedBytes, 0))}
                </p>
              </div>
            </div>

            <div className={`rounded-2xl border overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`border-b ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                    <tr>
                      <th className="px-6 py-3.5 font-semibold">Profile Name</th>
                      <th className="px-6 py-3.5 font-semibold">Username</th>
                      <th className="px-6 py-3.5 font-semibold">Secrets</th>
                      <th className="px-6 py-3.5 font-semibold">Sessions</th>
                      <th className="px-6 py-3.5 font-semibold">Activity Logs</th>
                      <th className="px-6 py-3.5 font-semibold">Service Accounts</th>
                      <th className="px-6 py-3.5 font-semibold text-right">Estimated Storage</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${theme === 'dark' ? 'divide-slate-800' : 'divide-slate-200'}`}>
                    {!storageBreakdown.length ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-slate-400">No user storage data available.</td>
                      </tr>
                    ) : (
                      storageBreakdown.map((item) => (
                        <tr key={item.id} className={`transition ${theme === 'dark' ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}>
                          <td className="px-6 py-4 font-medium">{item.profile_name}</td>
                          <td className="px-6 py-4 font-mono text-indigo-400">{item.username}</td>
                          <td className="px-6 py-4 font-mono">{item.secretsCount}</td>
                          <td className="px-6 py-4 font-mono">{item.sessionsCount}</td>
                          <td className="px-6 py-4 font-mono">{item.logsCount}</td>
                          <td className="px-6 py-4 font-mono">{item.serviceAccountsCount}</td>
                          <td className="px-6 py-4 font-mono font-semibold text-right text-indigo-400">
                            {formatBytes(item.estimatedBytes)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: DEVICE & LOGS TREE */}
        {tab === 'logs' && (
          <div className="space-y-6">
            <div className={`p-6 rounded-2xl border flex flex-col sm:flex-row gap-4 items-center justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <div>
                <h2 className="text-base font-bold">Grouped User Device & Activity Logs Tree</h2>
                <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                  Expand any user node to inspect all associated device activity, IP addresses, and event logs.
                </p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={logTreeSearch}
                  onChange={(e) => setLogTreeSearch(e.target.value)}
                  placeholder="Filter logs in tree..."
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>
            </div>

            <div className="space-y-3">
              {users.map((u) => {
                const userLogs = logs.filter((l) => {
                  const rel = Array.isArray(l.workflow_users) ? l.workflow_users[0] : l.workflow_users;
                  // Match by user_id or username
                  return l.user_id === u.id || rel?.username === u.username;
                }).filter((l) => {
                  if (!logTreeSearch) return true;
                  const q = logTreeSearch.toLowerCase();
                  return l.event_type.toLowerCase().includes(q) || (l.ip_address && l.ip_address.includes(q)) || (l.device_info && l.device_info.toLowerCase().includes(q));
                });

                const isExpanded = Boolean(expandedUsersInTree[u.id]);

                return (
                  <div key={u.id} className={`rounded-2xl border overflow-hidden transition ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <button
                      onClick={() => setExpandedUsersInTree({ ...expandedUsersInTree, [u.id]: !isExpanded })}
                      className={`w-full px-6 py-4 flex items-center justify-between text-left transition ${theme === 'dark' ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-indigo-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        <div>
                          <span className="font-bold text-sm">{u.profile_name}</span>
                          <span className={`ml-2 text-xs font-mono ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>({u.username})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded-full bg-indigo-600/10 text-indigo-400 text-xs font-semibold">
                          {userLogs.length} Log Entries
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className={`border-t px-6 py-4 space-y-3 ${theme === 'dark' ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50'}`}>
                        {!userLogs.length ? (
                          <p className="text-xs text-slate-400 py-2">No activity logs recorded for this user profile.</p>
                        ) : (
                          <div className="space-y-2">
                            {userLogs.map((log) => (
                              <div key={log.id} className={`p-3 rounded-xl border text-xs space-y-1 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                                <div className="flex items-center justify-between font-medium">
                                  <span className="text-indigo-400 font-bold uppercase tracking-wider text-[11px]">{log.event_type}</span>
                                  <span className="text-slate-400 text-[11px]">{new Date(log.created_at).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-4 text-slate-400 text-[11px] font-mono">
                                  <span>IP: {log.ip_address || '127.0.0.1'}</span>
                                  <span className="truncate max-w-md">Device: {log.device_info || 'Web Client'}</span>
                                </div>
                                {log.details && (
                                  <div className={`mt-1 p-2 rounded-lg font-mono text-[11px] ${theme === 'dark' ? 'bg-slate-950 text-slate-300' : 'bg-slate-100 text-slate-700'}`}>
                                    {formatLogDetails(log.details)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 7: KEYS VAULT */}
        {tab === 'keys' && (
          <div className="space-y-6">
            <div className={`p-6 rounded-2xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
              <h2 className="text-base font-bold mb-4">Manage User Credentials & Service Accounts</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Select User Profile</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.profile_name} ({u.username})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Tool Integration</label>
                  <select
                    value={keyTool}
                    onChange={(e) => handleKeyToolChange(e.target.value as Tool)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                  >
                    <option value="blogger">Automated Blogger</option>
                    <option value="indexer">Blogger SEO Indexer</option>
                    <option value="seo-pdf">SEO PDF Studio</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Credential Key Name</label>
                  <select
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                  >
                    {toolCredentialOptions[keyTool].map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Upload JSON Key File (Optional)</label>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleKeyJsonFile}
                    className={`w-full px-3 py-2 rounded-xl text-xs border file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-xs font-medium mb-1">Credential Value / Secret</label>
                <textarea
                  rows={3}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  placeholder="Paste token or JSON credential..."
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-mono border focus:outline-none focus:border-indigo-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}
                />
              </div>

              <button
                onClick={async () => {
                  if (!selectedUserId || !keyName || !keyValue) {
                    setError('Select a user, credential name, and provide a value.');
                    return;
                  }
                  setError('');
                  try {
                    await request(`/api/admin/users/${selectedUserId}/keys`, {
                      method: 'POST',
                      body: JSON.stringify({ tool: keyTool, name: keyName, value: keyValue }),
                    });
                    setStatusMessage(`Securely saved credential ${keyName}`);
                    setKeyValue('');
                    const updated = await request<CredentialRecord[]>(`/api/admin/users/${selectedUserId}/keys`);
                    setKeys(updated);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not save credential.');
                  }
                }}
                className="mt-4 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-xs transition shadow-lg shadow-indigo-600/20"
              >
                Securely Save Credential
              </button>
            </div>
          </div>
        )}

        {/* TAB 8: SECURITY CENTER */}
        {tab === 'security' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`p-6 rounded-2xl border flex items-center justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div>
                  <h3 className="text-sm font-bold">Revoke All Active Sessions</h3>
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Immediately terminate all active user sessions across all clients.</p>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm('Revoke all active user sessions?')) return;
                    try {
                      const res = await request<{ revoked: number }>('/api/admin/security/revoke-all', { method: 'POST' });
                      setStatusMessage(`Revoked ${res.revoked} active sessions.`);
                      await loadTab();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not revoke sessions.');
                    }
                  }}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium text-xs transition"
                >
                  Revoke All
                </button>
              </div>

              <div className={`p-6 rounded-2xl border flex items-center justify-between ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                <div>
                  <h3 className="text-sm font-bold">Clear Login Attempt Locks</h3>
                  <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Clear rate-limit locks and failed login blocks.</p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await request<{ cleared: number }>('/api/admin/security/clear-attempts', { method: 'POST' });
                      setStatusMessage(`Cleared ${res.cleared} rate-limit locks.`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not clear locks.');
                    }
                  }}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-xs transition"
                >
                  Clear Locks
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
