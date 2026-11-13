import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Database,
  FileText,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

type Tool = 'blogger' | 'indexer' | 'seo-pdf';
type CleanupScope = 'security' | 'logs' | 'unused_keys' | 'data' | 'all';
type Tab = 'active-users' | 'new-user' | 'users' | 'keys' | 'logs' | 'security' | 'usage';

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
  { id: 'keys', label: 'Keys & Integrations', icon: KeyRound },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'security', label: 'Security', icon: ShieldAlert },
  { id: 'usage', label: 'Storage & Data', icon: Database },
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

  // Shared core records
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [activeUsers, setActiveUsers] = useState<SessionRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);

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
  const [creating, setCreating] = useState(false);
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

  // Logs filter
  const [logSearch, setLogSearch] = useState('');
  const [logEventFilter, setLogEventFilter] = useState('all');

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
      } else if (tab === 'logs') {
        setLogs(await request<LogRecord[]>('/api/admin/logs'));
      } else if (tab === 'security') {
        const [secData, sessionsData] = await Promise.all([
          request<SecurityOverview>('/api/admin/security'),
          request<SessionRecord[]>('/api/admin/sessions'),
        ]);
        setSecurityOverview(secData);
        setSessions(sessionsData);
      } else if (tab === 'usage') {
        setUsage(await request<UsageReport>('/api/admin/usage'));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load admin data.');
    }
  }, [session, tab, selectedUserId, loadUsers]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  useEffect(() => {
    if (!session || tab !== 'keys' || !selectedUserId) return;
    request<CredentialRecord[]>(`/api/admin/users/${selectedUserId}/keys`)
      .then(setKeys)
      .catch((keyError) => setError(keyError instanceof Error ? keyError.message : 'Could not load user keys.'));
  }, [session, tab, selectedUserId]);

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
      sessionStorage.removeItem('vernika_session');
      sessionStorage.removeItem('vernika_tab_tool');
      await refreshSession();
      setPassword('');
      setOtp('');
      setChallengeId('');
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
    const snapshotPassword = newPassword;
    const snapshotOtp = newOtp;
    const snapshotTools = [...assignedTools];
    const snapshotExpiry = new Date(expiresAt).toISOString();
    try {
      const created = await request<UserRecord>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          profile_name: profileName,
          username: newUsername,
          password: snapshotPassword,
          otp: snapshotOtp,
          expires_at: snapshotExpiry,
          assigned_tools: snapshotTools,
        }),
      });
      setCreatedSummary({
        id: created.id,
        profileName: created.profile_name,
        username: created.username,
        password: snapshotPassword,
        otp: snapshotOtp,
        expiresAt: created.expires_at,
        tools: snapshotTools,
      });
      setCopiedSummary(false);
      setSelectedUserId(created.id);
      setProfileName('');
      setNewUsername('');
      setNewPassword('');
      setNewOtp('');
      setExpiresAt(localDate());
      setStatusMessage(`Customer account "${created.profile_name}" created.`);
      await loadUsers();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create account.');
    } finally {
      setCreating(false);
    }
  };

  const copyCreatedCredentials = async () => {
    if (!createdSummary) return;
    const toolNames = createdSummary.tools.map((t) => toolLabels[t]).join(', ');
    const text = [
      `Profile: ${createdSummary.profileName}`,
      `Username: ${createdSummary.username}`,
      `Password: ${createdSummary.password}`,
      `OTP: ${createdSummary.otp}`,
      `Tools: ${toolNames}`,
      `Expires: ${new Date(createdSummary.expiresAt).toLocaleString()}`,
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedSummary(true);
  };

  const startEditing = (user: UserRecord) => {
    setEditingUser(user);
    setEditProfileName(user.profile_name);
    setEditUsername(user.username);
    setEditStatus(user.status);
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
      const parsedExpiryMs = Date.parse(editExpiry);
      const bodyPayload: Record<string, unknown> = {
        profile_name: editProfileName,
        username: editUsername,
        status: editStatus,
        assigned_tools: editTools,
        ...(editPassword ? { password: editPassword } : {}),
        ...(editOtp ? { otp: editOtp } : {}),
      };
      if (Number.isFinite(parsedExpiryMs) && parsedExpiryMs > Date.now()) {
        bodyPayload.expires_at = new Date(parsedExpiryMs).toISOString();
      }
      await request(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify(bodyPayload),
      });
      setStatusMessage(`Account "${editProfileName}" updated.`);
      setEditingUser(null);
      await loadTab();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update account.');
    }
  };

  const changeStatus = async (user: UserRecord) => {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    setError('');
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setStatusMessage(`${user.profile_name} marked ${nextStatus}.`);
      await loadTab();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update account status.');
    }
  };

  const markExpired = async (user: Pick<UserRecord, 'id' | 'profile_name'>) => {
    setError('');
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'expired' }),
      });
      setStatusMessage(`${user.profile_name} marked expired and active sessions revoked.`);
      await loadTab();
    } catch (expireError) {
      setError(expireError instanceof Error ? expireError.message : 'Could not mark account expired.');
    }
  };

  const renewUser = async (user: Pick<UserRecord, 'id' | 'profile_name' | 'expires_at'>, months: number) => {
    const currentExpiry = Date.parse(user.expires_at);
    const baseTime = Number.isFinite(currentExpiry) ? Math.max(Date.now(), currentExpiry) : Date.now();
    const durationMs = months * 30 * 24 * 60 * 60 * 1000;
    setError('');
    try {
      await request(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expires_at: new Date(baseTime + durationMs).toISOString(),
          status: 'active',
        }),
      });
      setStatusMessage(`${user.profile_name} renewed for ${months} month${months === 1 ? '' : 's'} and set to active.`);
      await loadTab();
    } catch (renewError) {
      setError(renewError instanceof Error ? renewError.message : 'Could not renew account.');
    }
  };

  const revokeSession = async (sessionId: string) => {
    setError('');
    setStatusMessage('');
    try {
      await request(`/api/admin/sessions/${sessionId}/revoke`, { method: 'POST' });
      setStatusMessage('Session revoked.');
      await loadTab();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke session.');
    }
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUserId) return;
    setError('');
    try {
      await request(`/api/admin/users/${selectedUserId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ name: keyName, tool: keyTool, value: keyValue }),
      });
      setKeyValue('');
      setStatusMessage(`Encrypted credential "${keyName}" saved for ${toolLabels[keyTool]}.`);
      await loadTab();
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not save credential.');
    }
  };

  const removeKey = async (keyId: string) => {
    if (!selectedUserId) return;
    setError('');
    try {
      await request(`/api/admin/users/${selectedUserId}/keys/${keyId}`, { method: 'DELETE' });
      setStatusMessage('Credential removed.');
      await loadTab();
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not delete credential.');
    }
  };

  const deleteGlobalSecret = async (keyId: string) => {
    setError('');
    try {
      await request(`/api/admin/keys/secret/${keyId}`, { method: 'DELETE' });
      setStatusMessage('Saved key deleted from encrypted storage.');
      await loadTab();
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : 'Could not delete saved key.');
    }
  };

  const deleteGlobalServiceAccount = async (id: string) => {
    setError('');
    try {
      await request(`/api/admin/keys/service-account/${id}`, { method: 'DELETE' });
      setStatusMessage('Service account deleted.');
      await loadTab();
    } catch (saError) {
      setError(saError instanceof Error ? saError.message : 'Could not delete service account.');
    }
  };

  const clearAttempts = async (id?: string) => {
    setError('');
    try {
      const result = await request<{ cleared: number }>('/api/admin/security/clear-attempts', {
        method: 'POST',
        body: JSON.stringify(id ? { id } : {}),
      });
      setStatusMessage(`Cleared ${result.cleared} login attempt record${result.cleared === 1 ? '' : 's'}.`);
      await loadTab();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Could not clear lockouts.');
    }
  };

  const revokeAllSessions = async () => {
    setError('');
    try {
      const result = await request<{ revoked: number }>('/api/admin/security/revoke-all', { method: 'POST' });
      setStatusMessage(`Revoked ${result.revoked} active session${result.revoked === 1 ? '' : 's'}.`);
      setConfirmRevokeAll(false);
      await loadTab();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke all sessions.');
    }
  };

  const syncOverdueAccounts = async () => {
    setError('');
    try {
      const result = await request<{ expiredCount: number }>('/api/admin/security/sync-expired', { method: 'POST' });
      setStatusMessage(`Synchronized ${result.expiredCount} overdue account${result.expiredCount === 1 ? '' : 's'} to expired.`);
      await loadTab();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Could not sync overdue accounts.');
    }
  };

  const cleanupExpiredData = async () => {
    setError('');
    setStatusMessage('');
    try {
      const result = await request<{ scope: CleanupScope; deleted: Record<string, number> }>('/api/admin/cleanup', {
        method: 'POST',
        body: JSON.stringify({ scope: cleanupScope }),
      });
      const total = Object.values(result.deleted || {}).reduce((sum, count) => sum + Number(count || 0), 0);
      setStatusMessage(`Cleanup complete (${result.scope}): ${total} records removed.`);
      setConfirmCleanup(false);
      await loadTab();
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : 'Cleanup failed.');
    }
  };

  const logout = async () => {
    await request('/api/access/logout', { method: 'POST' });
    sessionStorage.removeItem('vernika_session');
    sessionStorage.removeItem('vernika_tab_tool');
    setSession(null);
  };

  // Computed views
  const expiringUsers = useMemo(
    () =>
      users.filter((user) => {
        if (user.status !== 'active') return false;
        const diff = Date.parse(user.expires_at) - Date.now();
        return diff > 0 && diff <= 2 * 24 * 60 * 60 * 1000;
      }),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((user) => {
      const effective = getEffectiveUserStatus(user);
      if (userFilter !== 'all' && effective !== userFilter) return false;
      if (!query) return true;
      return (
        user.profile_name.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query) ||
        user.assigned_tools.some((t) => toolLabels[t].toLowerCase().includes(query))
      );
    });
  }, [users, userSearch, userFilter]);

  const uniqueLogEvents = useMemo(
    () => Array.from(new Set(logs.map((entry) => entry.event_type))).sort(),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const query = logSearch.trim().toLowerCase();
    return logs.filter((entry) => {
      if (logEventFilter !== 'all' && entry.event_type !== logEventFilter) return false;
      if (!query) return true;
      const rel = resolveUserRelation(entry.workflow_users);
      return (
        rel.profileName.toLowerCase().includes(query) ||
        rel.username.toLowerCase().includes(query) ||
        entry.event_type.toLowerCase().includes(query) ||
        (entry.ip_address || '').toLowerCase().includes(query) ||
        (entry.device_info || '').toLowerCase().includes(query) ||
        formatLogDetails(entry.details).toLowerCase().includes(query)
      );
    });
  }, [logs, logSearch, logEventFilter]);

  const filteredGlobalSecrets = useMemo(() => {
    if (keyAuditFilter === 'service_accounts') return [];
    if (keyAuditFilter === 'unused') return globalSecrets.filter((s) => s.is_unused);
    return globalSecrets;
  }, [globalSecrets, keyAuditFilter]);

  const filteredServiceAccounts = useMemo(() => {
    if (keyAuditFilter === 'secrets') return [];
    if (keyAuditFilter === 'unused') return globalServiceAccounts.filter((sa) => sa.is_unused);
    return globalServiceAccounts;
  }, [globalServiceAccounts, keyAuditFilter]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-400">
        Verifying administrator session...
      </div>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-950 px-4 py-10 text-slate-100">
        <div className="w-full max-w-md space-y-4">
          <form
            onSubmit={challengeId ? submitOtp : submitLogin}
            className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400">
                  Vernika Workflows
                </p>
                <h1 className="text-xl font-bold">Admin Console</h1>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              Restricted administrator access for customer provisioning, tool licensing, encrypted keys, and security logs.
            </p>
            {error && (
              <p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/70 p-3 text-sm text-rose-300">
                {error}
              </p>
            )}
            {!challengeId ? (
              <>
                <input
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Admin username"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Admin password"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
                />
              </>
            ) : (
              <div className="space-y-2">
                <input
                  autoFocus
                  inputMode="numeric"
                  required
                  minLength={6}
                  maxLength={10}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                  placeholder="Administrator OTP (6-10 digits)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm tracking-widest"
                />
                <button
                  type="button"
                  onClick={() => {
                    setChallengeId('');
                    setOtp('');
                    setError('');
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Use another account
                </button>
              </div>
            )}
            <button
              disabled={busy}
              className="w-full rounded-lg bg-sky-600 p-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? 'Please wait...' : challengeId ? 'Verify OTP & Enter Console' : 'Continue'}
            </button>
            <a href="/" className="block text-center text-xs text-slate-400 hover:text-white">
              Return to customer landing page
            </a>
          </form>

          {health && !health.readyForAdminLogin && (
            <div className="rounded-xl border border-amber-900/70 bg-amber-950/30 p-4 text-xs text-amber-200">
              <div className="flex items-center gap-2 font-semibold text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                <span>Environment readiness notice</span>
              </div>
              <p className="mt-1 text-amber-200/80">
                Missing required server configuration before admin login can succeed:
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px]">
                {Object.entries(health.checks).map(([key, ok]) => (
                  <li key={key} className={ok ? 'text-emerald-300' : 'text-rose-300'}>
                    {ok ? '[OK]' : '[MISSING]'} {key}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400">
                Vernika Workflows
              </p>
              <h1 className="text-xl font-bold">Administration &amp; License Console</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-300">
              Admin: {session.username}
            </span>
            <button
              onClick={logout}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <nav className="mb-6 flex flex-wrap items-center gap-2">
          {navTabs.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-sky-600 text-white shadow'
                    : 'border border-slate-800 bg-slate-900/60 text-slate-300 hover:bg-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => void loadTab()}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refresh</span>
          </button>
        </nav>

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-rose-900 bg-rose-950/60 p-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        {statusMessage && (
          <p role="status" className="mb-4 rounded-lg border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-300">
            {statusMessage}
          </p>
        )}

        {/* 1. ACTIVE USERS */}
        {tab === 'active-users' && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs text-slate-400">Active Sessions Online</p>
                <p className="mt-1 text-2xl font-bold text-emerald-400">{activeUsers.length}</p>
                <p className="mt-1 text-[11px] text-slate-500">Single-device sessions live</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs text-slate-400">Customer Accounts</p>
                <p className="mt-1 text-2xl font-bold text-white">{users.length}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {users.filter((u) => getEffectiveUserStatus(u) === 'active' || getEffectiveUserStatus(u) === 'expiring').length} active subscriptions
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs text-slate-400">Expiring Within 2 Days</p>
                <p className="mt-1 text-2xl font-bold text-amber-400">{expiringUsers.length}</p>
                <p className="mt-1 text-[11px] text-slate-500">Eligible for quick renewal</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs text-slate-400">Tracked Storage</p>
                <p className="mt-1 text-2xl font-bold text-sky-400">
                  {usage ? formatBytes(usage.totalStorageBytes) : '--'}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {usage ? `${usage.totalRows.toLocaleString()} total rows` : 'Loading usage...'}
                </p>
              </div>
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 p-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  <h2 className="font-semibold">Live Active Customer Sessions</h2>
                </div>
                <span className="text-xs text-slate-400">{activeUsers.length} online</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Customer Profile</th>
                      <th className="p-3">Assigned Tools</th>
                      <th className="p-3">Device / Browser</th>
                      <th className="p-3">IP Address</th>
                      <th className="p-3">Logged In</th>
                      <th className="p-3">Last Active</th>
                      <th className="p-3">Time Spent</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeUsers.map((row) => {
                      const rel = resolveUserRelation(row.workflow_users);
                      return (
                        <tr key={row.id} className="border-t border-slate-800">
                          <td className="p-3 text-xs">
                            <span className="font-semibold text-white">{rel.profileName || 'Unknown'}</span>
                            {rel.username && (
                              <span className="block font-mono text-[11px] text-slate-400">{rel.username}</span>
                            )}
                          </td>
                          <td className="p-3 text-xs text-slate-300">
                            {rel.assignedTools.length
                              ? rel.assignedTools.map((t) => toolLabels[t]).join(', ')
                              : '--'}
                          </td>
                          <td className="max-w-xs p-3 text-xs text-slate-300">{row.device_info || '--'}</td>
                          <td className="p-3 font-mono text-xs text-slate-400">{row.ip_address || '--'}</td>
                          <td className="p-3 text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</td>
                          <td className="p-3 text-xs text-slate-400">
                            {row.last_active_at ? new Date(row.last_active_at).toLocaleString() : '--'}
                          </td>
                          <td className="p-3 font-mono text-xs text-emerald-300">
                            {formatDuration(row.duration_seconds)}
                          </td>
                          <td className="p-3 text-xs">
                            <button
                              onClick={() => void revokeSession(row.id)}
                              className="rounded border border-rose-800 px-2.5 py-1 text-rose-300 hover:bg-rose-950/60"
                            >
                              Force Revoke
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!activeUsers.length && (
                  <p className="p-5 text-sm text-slate-500">No customers are currently logged in.</p>
                )}
              </div>
            </section>

            {expiringUsers.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-amber-900/60 bg-amber-950/20">
                <div className="flex items-center justify-between border-b border-amber-900/40 p-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <h2 className="font-semibold text-amber-200">Subscriptions Expiring Within 2 Days</h2>
                  </div>
                  <span className="text-xs text-amber-300/80">2-day expiry reminder alerts active on user UI</span>
                </div>
                <div className="divide-y divide-amber-900/30">
                  {expiringUsers.map((user) => (
                    <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                      <div>
                        <span className="font-semibold text-white">{user.profile_name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">({user.username})</span>
                        <p className="text-xs text-amber-300">
                          Expires {new Date(user.expires_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => void renewUser(user, 1)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                        >
                          Renew 1 Month
                        </button>
                        <button
                          onClick={() => void renewUser(user, 3)}
                          className="rounded-lg border border-emerald-700 px-3 py-1.5 text-emerald-300 hover:bg-emerald-950/50"
                        >
                          Renew 3 Months
                        </button>
                        <button
                          onClick={() => void markExpired(user)}
                          className="rounded-lg border border-amber-800 px-3 py-1.5 text-amber-300 hover:bg-amber-950/50"
                        >
                          Mark Expired
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* 2. NEW USER */}
        {tab === 'new-user' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
            <form onSubmit={createUser} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-sky-400" />
                <div>
                  <h2 className="text-lg font-semibold">Create New Customer Account</h2>
                  <p className="text-xs text-slate-400">
                    Provision customer profile, login password, default OTP, tool access, and subscription expiry.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs text-slate-400">
                  Profile Display Name
                  <input
                    required
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="e.g. Acme Travels"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white"
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Login Username
                  <input
                    required
                    autoComplete="off"
                    value={newUsername}
                    onChange={(event) => setNewUsername(event.target.value)}
                    placeholder="e.g. acme_travels"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-white"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Password (12+ characters)</span>
                    <button
                      type="button"
                      onClick={() => setNewPassword(generateSecurePassword(16))}
                      className="text-sky-400 hover:text-sky-300"
                    >
                      Generate strong password
                    </button>
                  </div>
                  <input
                    required
                    type="text"
                    minLength={12}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Minimum 12 characters"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-white"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Default Login OTP (6-10 digits)</span>
                    <button
                      type="button"
                      onClick={() => setNewOtp(generateSecureOtp(6))}
                      className="text-sky-400 hover:text-sky-300"
                    >
                      Generate 6-digit OTP
                    </button>
                  </div>
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    minLength={6}
                    maxLength={10}
                    value={newOtp}
                    onChange={(event) => setNewOtp(event.target.value.replace(/\D/g, ''))}
                    placeholder="6-10 numeric digits"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>Subscription Expiry Date</span>
                  <div className="flex items-center gap-1.5">
                    {[1, 3, 6, 12].map((months) => (
                      <button
                        key={months}
                        type="button"
                        onClick={() => setExpiresAt(localDate(months * 30 * 24 * 60 * 60 * 1000))}
                        className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                      >
                        +{months}m
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  required
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-white"
                />
              </div>

              <div>
                <p className="mb-2 text-xs text-slate-400">Assigned Tools</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(toolLabels) as Tool[]).map((tool) => {
                    const checked = assignedTools.includes(tool);
                    return (
                      <label
                        key={tool}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition ${
                          checked
                            ? 'border-sky-500/60 bg-sky-950/30 text-white'
                            : 'border-slate-800 bg-slate-950/60 text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTool(tool, assignedTools, setAssignedTools)}
                        />
                        <span>{toolLabels[tool]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                disabled={creating || assignedTools.length === 0}
                className="w-full rounded-lg bg-sky-600 p-3 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {creating ? 'Creating Customer Account...' : 'Create Customer Account'}
              </button>
            </form>

            <aside className="space-y-4">
              {createdSummary ? (
                <div className="space-y-3 rounded-xl border border-emerald-800/70 bg-emerald-950/30 p-5">
                  <h3 className="font-semibold text-emerald-300">Account Provisioned</h3>
                  <p className="text-xs text-slate-300">
                    Save or share these credentials now. Passwords and OTPs are salted/hashed before storage and cannot be viewed again.
                  </p>
                  <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200">
                    <div>Profile: {createdSummary.profileName}</div>
                    <div>Username: {createdSummary.username}</div>
                    <div>Password: {createdSummary.password}</div>
                    <div>OTP: {createdSummary.otp}</div>
                    <div>Tools: {createdSummary.tools.map((t) => toolLabels[t]).join(', ')}</div>
                    <div>Expires: {new Date(createdSummary.expiresAt).toLocaleString()}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyCreatedCredentials()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedSummary ? 'Copied' : 'Copy Credentials'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUserId(createdSummary.id);
                        setKeyTool(createdSummary.tools[0] || 'blogger');
                        setKeyName(toolCredentialOptions[createdSummary.tools[0] || 'blogger'][0]);
                        setTab('keys');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>Attach Keys &amp; JSON</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
                  <h3 className="font-semibold text-white">Provisioning Checklist</h3>
                  <ul className="mt-3 list-disc space-y-2 pl-4 text-xs">
                    <li>Use a unique username per buyer workspace.</li>
                    <li>Assign only the tools included in their purchase plan.</li>
                    <li>Passwords (12+ chars) and OTPs (6-10 digits) are hashed with scrypt before saving.</li>
                    <li>After creating the customer, attach API keys or Service Account JSON under Keys &amp; Integrations.</li>
                    <li>Customers automatically see a 2-day expiry popup reminder before their subscription ends.</li>
                  </ul>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* 3. MANAGE EXISTING USERS */}
        {tab === 'users' && (
          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-sky-400" />
                <h2 className="font-semibold">Customer Accounts &amp; Expiry Control</h2>
                <span className="text-xs text-slate-500">({filteredUsers.length} shown)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search profile or username"
                    className="rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white"
                  />
                </div>
                <select
                  aria-label="Filter users by status"
                  value={userFilter}
                  onChange={(event) => setUserFilter(event.target.value as typeof userFilter)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="expiring">Expiring (&lt;= 2d)</option>
                  <option value="expired">Expired</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Profile</th>
                    <th className="p-3">Username</th>
                    <th className="p-3">Assigned Tools</th>
                    <th className="p-3">Status / Expiry</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const selectedMonths = renewMonths[user.id] || 1;
                    const effectiveStatus = getEffectiveUserStatus(user);
                    const statusBadgeClass =
                      effectiveStatus === 'active'
                        ? 'text-emerald-400'
                        : effectiveStatus === 'expiring'
                          ? 'text-amber-300'
                          : effectiveStatus === 'expired'
                            ? 'text-orange-400'
                            : 'text-rose-400';
                    return (
                      <tr key={user.id} className={`border-t border-slate-800 ${user.id === selectedUserId ? 'bg-sky-950/20' : ''}`}>
                        <td className="p-3">
                          <button
                            onClick={() => setSelectedUserId(user.id)}
                            className="font-medium text-white hover:text-sky-300"
                          >
                            {user.profile_name}
                          </button>
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-300">{user.username}</td>
                        <td className="max-w-52 p-3 text-xs text-slate-300">
                          {user.assigned_tools.map((tool) => toolLabels[tool]).join(', ')}
                        </td>
                        <td className="p-3 text-xs">
                          <span className={`font-semibold capitalize ${statusBadgeClass}`}>
                            {effectiveStatus === 'expiring' ? 'expiring soon' : effectiveStatus}
                          </span>
                          <span className="block text-slate-500">{new Date(user.expires_at).toLocaleString()}</span>
                        </td>
                        <td className="whitespace-nowrap p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <button onClick={() => startEditing(user)} className="text-sky-300 hover:underline">
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setSelectedUserId(user.id);
                                setTab('keys');
                              }}
                              className="text-indigo-300 hover:underline"
                            >
                              Keys
                            </button>
                            <select
                              aria-label={`Renewal months for ${user.profile_name}`}
                              value={selectedMonths}
                              onChange={(event) =>
                                setRenewMonths((prev) => ({ ...prev, [user.id]: Number(event.target.value) }))
                              }
                              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-200"
                            >
                              <option value={1}>1m</option>
                              <option value={3}>3m</option>
                              <option value={6}>6m</option>
                              <option value={12}>12m</option>
                            </select>
                            <button
                              onClick={() => void renewUser(user, selectedMonths)}
                              className="text-emerald-300 hover:underline"
                            >
                              Renew
                            </button>
                            {user.status !== 'expired' && (
                              <button onClick={() => void markExpired(user)} className="text-orange-300 hover:underline">
                                Mark Expired
                              </button>
                            )}
                            <button onClick={() => void changeStatus(user)} className="text-amber-300 hover:underline">
                              {user.status === 'active' ? 'Disable' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredUsers.length && (
                <p className="p-5 text-sm text-slate-500">No matching customer accounts found.</p>
              )}
            </div>

            {editingUser && (
              <form onSubmit={saveUser} className="space-y-4 border-t border-slate-800 bg-slate-950/40 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">Edit Account: {editingUser.profile_name}</h3>
                  <span className="font-mono text-xs text-slate-500">{editingUser.id}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block text-xs text-slate-400">
                    Profile Name
                    <input
                      required
                      value={editProfileName}
                      onChange={(event) => setEditProfileName(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    Username
                    <input
                      required
                      value={editUsername}
                      onChange={(event) => setEditUsername(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-sm text-white"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    Status
                    <select
                      value={editStatus}
                      onChange={(event) => setEditStatus(event.target.value as UserRecord['status'])}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                    >
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                  <label className="block text-xs text-slate-400">
                    Expiry Date
                    <input
                      type="datetime-local"
                      required
                      value={editExpiry}
                      onChange={(event) => setEditExpiry(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    New Password (optional, 12+)
                    <input
                      type="password"
                      minLength={12}
                      value={editPassword}
                      onChange={(event) => setEditPassword(event.target.value)}
                      placeholder="Leave blank to keep existing"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    New OTP (optional, 6-10 digits)
                    <input
                      type="password"
                      inputMode="numeric"
                      minLength={6}
                      maxLength={10}
                      value={editOtp}
                      onChange={(event) => setEditOtp(event.target.value.replace(/\D/g, ''))}
                      placeholder="Leave blank to keep existing"
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  {(Object.keys(toolLabels) as Tool[]).map((tool) => (
                    <label key={tool} className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={editTools.includes(tool)}
                        onChange={() => toggleTool(tool, editTools, setEditTools)}
                      />
                      <span>{toolLabels[tool]}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* 4. KEYS & INTEGRATIONS */}
        {tab === 'keys' && (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <h2 className="mb-3 font-semibold">Per-Customer Encrypted Credentials</h2>
                <select
                  aria-label="Select customer account"
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
                >
                  <option value="">Select customer profile</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.profile_name} ({user.username}) - {getEffectiveUserStatus(user)}
                    </option>
                  ))}
                </select>
                <ul className="space-y-2">
                  {keys.map((key) => (
                    <li
                      key={String(key.id)}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm"
                    >
                      <div>
                        <span className="font-mono text-xs text-sky-300">{String(key.tool)}</span>
                        <span className="mx-2 text-slate-600">/</span>
                        <span className="font-mono text-xs text-white">{String(key.name)}</span>
                        {key.updated_at && (
                          <span className="block text-[11px] text-slate-500">
                            Updated {new Date(key.updated_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => void removeKey(String(key.id))}
                        aria-label="Delete saved credential"
                        className="rounded border border-rose-900/70 p-1.5 text-rose-300 hover:bg-rose-950/60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                {!keys.length && (
                  <p className="text-xs text-slate-500">No saved credentials for the selected customer yet.</p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  Credentials are encrypted with AES-256-GCM; plaintext secret values are never sent back to the browser.
                </p>
              </section>

              <form onSubmit={saveKey} className="h-fit space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                <h2 className="font-semibold">Add or Update Customer Credential</h2>
                <p className="text-xs text-slate-400">
                  Attach API keys, tokens, or Google Service Account JSON files directly to the selected customer profile.
                </p>
                <select
                  aria-label="Target tool"
                  value={keyTool}
                  onChange={(event) => handleKeyToolChange(event.target.value as Tool)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
                >
                  {(Object.keys(toolLabels) as Tool[]).map((tool) => (
                    <option value={tool} key={tool}>
                      {toolLabels[tool]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Credential key name"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm"
                >
                  {toolCredentialOptions[keyTool].map((optionName) => (
                    <option key={optionName} value={optionName}>
                      {optionName}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Credential value</span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-sky-300 hover:bg-slate-800">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Upload .json file</span>
                    <input type="file" accept=".json,application/json" onChange={handleKeyJsonFile} className="hidden" />
                  </label>
                </div>
                <textarea
                  required
                  value={keyValue}
                  onChange={(event) => setKeyValue(event.target.value)}
                  placeholder="Paste API key, refresh token, or JSON credential content"
                  rows={6}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs"
                />
                <button
                  disabled={!selectedUserId}
                  className="w-full rounded-lg bg-sky-600 p-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  <LockKeyhole className="mr-2 inline h-4 w-4" />
                  Encrypt &amp; Save Credential
                </button>
              </form>
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
                <div>
                  <h2 className="font-semibold">All Saved Keys &amp; Service Accounts Audit</h2>
                  <p className="text-xs text-slate-400">
                    Update or delete old/unused keys across expired or disabled customer accounts.
                  </p>
                </div>
                <select
                  aria-label="Filter global keys"
                  value={keyAuditFilter}
                  onChange={(event) => setKeyAuditFilter(event.target.value as typeof keyAuditFilter)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"
                >
                  <option value="all">All records ({globalSecrets.length + globalServiceAccounts.length})</option>
                  <option value="unused">Unused / Expired accounts only</option>
                  <option value="secrets">Encrypted Secrets ({globalSecrets.length})</option>
                  <option value="service_accounts">Service Accounts ({globalServiceAccounts.length})</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Source</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Tool / Project</th>
                      <th className="p-3">Key / Client Email</th>
                      <th className="p-3">State</th>
                      <th className="p-3">Updated</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGlobalSecrets.map((secret) => (
                      <tr key={`sec-${secret.id}`} className="border-t border-slate-800">
                        <td className="p-3 text-xs text-sky-300">Encrypted Key</td>
                        <td className="p-3 text-xs">
                          <span className="font-semibold text-white">{secret.profile_name}</span>
                          {secret.username && (
                            <span className="block font-mono text-[11px] text-slate-400">{secret.username}</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-slate-300">{toolLabels[secret.tool] || secret.tool}</td>
                        <td className="p-3 font-mono text-xs text-slate-200">{secret.name}</td>
                        <td className="p-3 text-xs">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              secret.is_unused ? 'bg-amber-950 text-amber-300' : 'bg-emerald-950 text-emerald-300'
                            }`}
                          >
                            {secret.is_unused ? `Unused (${secret.user_status})` : 'In Use'}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-400">
                          {secret.updated_at ? new Date(secret.updated_at).toLocaleString() : '--'}
                        </td>
                        <td className="p-3 text-xs">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setSelectedUserId(secret.user_id);
                                setKeyTool(secret.tool);
                                setKeyName(secret.name);
                              }}
                              className="text-sky-300 hover:underline"
                            >
                              Update
                            </button>
                            <button
                              onClick={() => void deleteGlobalSecret(secret.id)}
                              className="text-rose-300 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredServiceAccounts.map((sa) => (
                      <tr key={`sa-${sa.id}`} className="border-t border-slate-800">
                        <td className="p-3 text-xs text-indigo-300">Service Account</td>
                        <td className="p-3 text-xs">
                          <span className="font-semibold text-white">{sa.profile_name}</span>
                          {sa.username && (
                            <span className="block font-mono text-[11px] text-slate-400">{sa.username}</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-slate-300">{sa.project_name}</td>
                        <td className="p-3 font-mono text-xs text-slate-200">{sa.client_email}</td>
                        <td className="p-3 text-xs">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                              sa.is_unused ? 'bg-amber-950 text-amber-300' : 'bg-emerald-950 text-emerald-300'
                            }`}
                          >
                            {sa.is_unused ? 'Unused / Inactive' : `Active (${sa.daily_count}/day)`}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-400">
                          {sa.created_at ? new Date(sa.created_at).toLocaleString() : '--'}
                        </td>
                        <td className="p-3 text-xs">
                          <button
                            onClick={() => void deleteGlobalServiceAccount(sa.id)}
                            className="text-rose-300 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredGlobalSecrets.length && !filteredServiceAccounts.length && (
                  <p className="p-5 text-sm text-slate-500">No credentials match the current filter.</p>
                )}
              </div>
            </section>
          </div>
        )}

        {/* 5. LOGS */}
        {tab === 'logs' && (
          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-sky-400" />
                <h2 className="font-semibold">Activity &amp; Audit Logs</h2>
                <span className="text-xs text-slate-500">({filteredLogs.length} events)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={logSearch}
                    onChange={(event) => setLogSearch(event.target.value)}
                    placeholder="Search user, event, IP, details"
                    className="rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white"
                  />
                </div>
                <select
                  aria-label="Filter logs by event type"
                  value={logEventFilter}
                  onChange={(event) => setLogEventFilter(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="all">All event types</option>
                  {uniqueLogEvents.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {eventType.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Time</th>
                    <th className="p-3">User</th>
                    <th className="p-3">Event</th>
                    <th className="p-3">Details</th>
                    <th className="p-3">IP Address</th>
                    <th className="p-3">Device</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((row) => {
                    const user = resolveUserRelation(row.workflow_users);
                    return (
                      <tr className="border-t border-slate-800" key={row.id}>
                        <td className="whitespace-nowrap p-3 text-xs text-slate-400">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="p-3 text-xs">
                          {user.profileName ? (
                            <>
                              <span className="font-semibold text-white">{user.profileName}</span>
                              {user.username && (
                                <span className="block font-mono text-[11px] text-slate-400">{user.username}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">Admin / System</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs text-sky-300">{row.event_type.replaceAll('_', ' ')}</td>
                        <td className="max-w-sm p-3 text-xs text-slate-300">{formatLogDetails(row.details)}</td>
                        <td className="p-3 font-mono text-xs text-slate-400">{row.ip_address || '--'}</td>
                        <td className="max-w-xs p-3 text-xs text-slate-400">{row.device_info || '--'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredLogs.length && <p className="p-5 text-sm text-slate-500">No matching activity logs available.</p>}
            </div>
          </section>
        )}

        {/* 6. SECURITY MANAGEMENT */}
        {tab === 'security' && (
          <div className="space-y-6">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Single-Device &amp; Account Security Controls</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Each customer login automatically revokes prior device sessions. Use emergency controls below to terminate sessions or sync overdue accounts.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => void syncOverdueAccounts()}
                    className="rounded-lg border border-amber-700/70 px-3 py-2 font-medium text-amber-200 hover:bg-amber-950/50"
                  >
                    Sync Overdue Accounts ({securityOverview?.overdueActiveUsers.length || 0})
                  </button>
                  {!confirmRevokeAll ? (
                    <button
                      onClick={() => setConfirmRevokeAll(true)}
                      className="rounded-lg border border-rose-800 px-3 py-2 font-medium text-rose-300 hover:bg-rose-950/60"
                    >
                      Revoke All Active Sessions ({securityOverview?.activeSessionsCount || 0})
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => void revokeAllSessions()}
                        className="rounded-lg bg-rose-600 px-3 py-2 font-semibold text-white hover:bg-rose-500"
                      >
                        Confirm Revoke All
                      </button>
                      <button
                        onClick={() => setConfirmRevokeAll(false)}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 p-4">
                <div>
                  <h3 className="font-semibold">Login Rate-Limit &amp; Lockout Records</h3>
                  <p className="text-xs text-slate-400">Hashed IP/step counters created after repeated invalid sign-in attempts.</p>
                </div>
                {(securityOverview?.lockedAttempts.length || 0) > 0 && (
                  <button
                    onClick={() => void clearAttempts()}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-sky-300 hover:bg-slate-800"
                  >
                    Clear All Lockouts
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Bucket ID</th>
                      <th className="p-3">Failed Attempts</th>
                      <th className="p-3">Locked Until</th>
                      <th className="p-3">Expires</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(securityOverview?.lockedAttempts || []).map((row) => (
                      <tr key={row.id} className="border-t border-slate-800 text-xs">
                        <td className="p-3 font-mono text-slate-300">{row.id.slice(0, 16)}...</td>
                        <td className="p-3 text-slate-200">{row.attempts}</td>
                        <td className="p-3 text-amber-300">
                          {row.locked_until ? new Date(row.locked_until).toLocaleString() : 'Not locked'}
                        </td>
                        <td className="p-3 text-slate-400">{new Date(row.expires_at).toLocaleString()}</td>
                        <td className="p-3">
                          <button
                            onClick={() => void clearAttempts(row.id)}
                            className="text-sky-300 hover:underline"
                          >
                            Clear
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!(securityOverview?.lockedAttempts.length || 0) && (
                  <p className="p-4 text-xs text-slate-500">No active login rate-limit lockouts.</p>
                )}
              </div>
            </section>

            <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
              <div className="border-b border-slate-800 p-4">
                <h3 className="font-semibold">Full Device &amp; Session Audit History</h3>
              </div>
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">User</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Device / Browser</th>
                    <th className="p-3">IP Address</th>
                    <th className="p-3">Logged In</th>
                    <th className="p-3">Last Active</th>
                    <th className="p-3">Duration</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row) => {
                    const user = resolveUserRelation(row.workflow_users);
                    const isRevoked = Boolean(row.revoked_at);
                    const isExpired = !isRevoked && Date.parse(row.expires_at) <= Date.now();
                    const statusLabel = isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active';
                    const badgeClass = isRevoked
                      ? 'bg-rose-950 text-rose-300 border-rose-800'
                      : isExpired
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-emerald-950 text-emerald-300 border-emerald-800';
                    return (
                      <tr className="border-t border-slate-800" key={row.id}>
                        <td className="p-3 text-xs">
                          <span className="font-semibold text-white">{user.profileName || 'Unknown'}</span>
                          {user.username && (
                            <span className="block font-mono text-[11px] text-slate-400">{user.username}</span>
                          )}
                        </td>
                        <td className="p-3 text-xs">
                          <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="max-w-xs p-3 text-xs text-slate-300">{row.device_info || '--'}</td>
                        <td className="p-3 font-mono text-xs text-slate-400">{row.ip_address || '--'}</td>
                        <td className="p-3 text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</td>
                        <td className="p-3 text-xs text-slate-400">
                          {row.last_active_at ? new Date(row.last_active_at).toLocaleString() : '--'}
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-200">{formatDuration(row.duration_seconds)}</td>
                        <td className="p-3 text-xs">
                          {!isRevoked && !isExpired ? (
                            <button
                              onClick={() => void revokeSession(row.id)}
                              className="rounded border border-rose-800 px-2.5 py-1 text-rose-300 hover:bg-rose-950/60"
                            >
                              Revoke
                            </button>
                          ) : (
                            <span className="text-slate-500">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!sessions.length && <p className="p-5 text-sm text-slate-500">No session records available.</p>}
            </section>
          </div>
        )}

        {/* 7. STORAGE & DATA MANAGEMENT */}
        {tab === 'usage' && (
          <section className="space-y-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Storage Utilization &amp; Database Cleanup</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {usage
                    ? `Measured ${new Date(usage.measuredAt).toLocaleString()} | ${usage.totalRows.toLocaleString()} total rows`
                    : 'Loading storage and table counts...'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Cleanup scope"
                  value={cleanupScope}
                  onChange={(event) => {
                    setCleanupScope(event.target.value as CleanupScope);
                    setConfirmCleanup(false);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                >
                  <option value="security">Expired sessions &amp; login attempts</option>
                  <option value="logs">Logs &amp; workflow requests (&gt;30d)</option>
                  <option value="unused_keys">Unused keys &amp; inactive service accounts</option>
                  <option value="data">Old workflow data (&gt;30d)</option>
                  <option value="all">Run full safe cleanup (all scopes)</option>
                </select>
                {!confirmCleanup ? (
                  <button
                    onClick={() => setConfirmCleanup(true)}
                    className="rounded-lg border border-amber-700/70 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/50"
                  >
                    Run Cleanup
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => void cleanupExpiredData()}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                    >
                      Confirm Cleanup
                    </button>
                    <button
                      onClick={() => setConfirmCleanup(false)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>

            {usage && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <p className="text-xs text-slate-400">Tracked Storage Footprint</p>
                    <p className="mt-1 text-2xl font-semibold text-sky-400">{formatBytes(usage.totalStorageBytes)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{usage.totalRows.toLocaleString()} tracked rows</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <p className="text-xs text-slate-400">Unused / Expired User Keys</p>
                    <p className="mt-1 text-2xl font-semibold text-amber-300">{usage.unusedSecretsCount || 0}</p>
                    <p className="mt-1 text-[11px] text-slate-500">Secrets belonging to inactive/expired accounts</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <p className="text-xs text-slate-400">Inactive Service Accounts</p>
                    <p className="mt-1 text-2xl font-semibold text-amber-300">
                      {usage.inactiveServiceAccountsCount || 0}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">Disabled service account records</p>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Storage Bytes by Table
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {usage.storageByTable.map((row) => (
                      <div key={row.table_name} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <p className="font-mono text-xs text-slate-300">{row.table_name}</p>
                        <p className="mt-1 font-mono text-lg text-white">{formatBytes(row.total_bytes)}</p>
                        <p className="text-[11px] text-slate-500">
                          {formatBytes(row.table_bytes)} data | {formatBytes(row.index_bytes)} indexes
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Approximate Row Counts
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {Object.entries(usage.rowsByTable).map(([table, count]) => (
                      <div key={table} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <p className="text-xs text-slate-400">{table.replaceAll('_', ' ')}</p>
                        <p className="mt-1 font-mono text-lg text-white">{count.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  Cleanup removes obsolete session records, expired rate-limit entries, old logs (&gt;30d), or keys belonging strictly to expired/disabled accounts. Active customer accounts and active credentials are never modified.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
