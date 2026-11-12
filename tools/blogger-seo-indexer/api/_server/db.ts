import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { ServiceAccount, UrlLog, SystemStatus } from '../../src/lib/types.js';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { decryptSecret, encryptSecret, EncryptedSecret } from '../../../../api/secretStore.js';

// Detect Serverless environment (Vercel, AWS Lambda, Netlify)
const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.NETLIFY
);

// Safe storage directory: /tmp on serverless environments to prevent EROFS read-only filesystem crash
const DATA_DIR = isServerless
  ? path.resolve('/tmp', 'openindex-data')
  : path.resolve(process.cwd(), 'data');

const SYSTEM_SCOPE_ID = '00000000-0000-4000-8000-000000000001';
const databaseScope = new AsyncLocalStorage<string>();
type StoredCredentials = EncryptedSecret & { encrypted: true };

function encryptCredentials(credentials: ServiceAccount['credentials']): StoredCredentials | undefined {
  if (!credentials) return undefined;
  return {
    ...encryptSecret(JSON.stringify(credentials)),
    encrypted: true,
  };
}

function decryptCredentials(value: unknown): ServiceAccount['credentials'] {
  if (!value || typeof value !== 'object') return undefined;
  const stored = value as Partial<StoredCredentials>;
  if (stored.encrypted !== true) return value as ServiceAccount['credentials'];
  if (!stored.ciphertext || !stored.iv || !stored.authTag) {
    throw new Error('Stored service-account credentials are incomplete.');
  }
  const credentials: unknown = JSON.parse(decryptSecret({
    ciphertext: stored.ciphertext,
    iv: stored.iv,
    authTag: stored.authTag,
  }));
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('Stored service-account credentials are invalid.');
  }
  return credentials as ServiceAccount['credentials'];
}

function storedAccount(account: ServiceAccount): ServiceAccount {
  return {
    ...account,
    credentials: encryptCredentials(account.credentials) as ServiceAccount['credentials'],
  };
}

export function withDatabaseScope<T>(userId: string, callback: () => T): T {
  return databaseScope.run(userId, callback);
}

function getDatabaseScope(): string {
  return databaseScope.getStore() || SYSTEM_SCOPE_ID;
}

// Supabase credentials loaded securely from process.env (.env or Vercel environment variables)
const DEFAULT_SUPABASE_URL = process.env.SUPABASE_URL || '';
const DEFAULT_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Ensure data folder exists safely
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (err) {
  // On read-only environments, continue gracefully with in-memory store
  console.warn('[Database] Storage dir init notice (safe fallback active):', err);
}

interface LocalStore {
  service_accounts: ServiceAccount[];
  url_logs: UrlLog[];
}

class DatabaseAdapter {
  private supabase: SupabaseClient | null = null;
  private readonly localStores = new Map<string, LocalStore>();
  private isConnectedToSupabase = false;
  private activeUrl: string | null = null;
  private quotaLimitPerAccount: number = 200;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // Start initialization but don't block constructor
    this.initializationPromise = this.initialize();
  }

  private async initialize() {
    this.initSupabase();
    this.loadLocalStore();
    await this.bootstrapUserKey();
  }

  private async ensureInitialized() {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  private loadLocalStore() {
    this.getLocalStore();
  }

  private getLocalStore(): LocalStore {
    const scopeId = getDatabaseScope();
    const existing = this.localStores.get(scopeId);
    if (existing) return existing;
    let store: LocalStore = { service_accounts: [], url_logs: [] };
    try {
      const scopedStorageFile = path.resolve(DATA_DIR, `openindex-${scopeId}.json`);
      if (fs.existsSync(scopedStorageFile)) {
        store = JSON.parse(fs.readFileSync(scopedStorageFile, 'utf-8')) as LocalStore;
        if (!Array.isArray(store.service_accounts)) {
          store.service_accounts = [];
        }
        if (!Array.isArray(store.url_logs)) {
          store.url_logs = [];
        }
        store.service_accounts = store.service_accounts.map((account) => ({
          ...account,
          credentials: decryptCredentials(account.credentials),
        }));
      }
    } catch {
      store = { service_accounts: [], url_logs: [] };
    }
    this.localStores.set(scopeId, store);
    return store;
  }

  private saveLocalStore() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(
        path.resolve(DATA_DIR, `openindex-${getDatabaseScope()}.json`),
        JSON.stringify({
          ...this.getLocalStore(),
          service_accounts: this.getLocalStore().service_accounts.map(storedAccount),
        }, null, 2),
        'utf-8'
      );
    } catch {
      // In-memory store remains intact even if disk is read-only
    }
  }

  public initSupabase(): boolean {
    const url = DEFAULT_SUPABASE_URL;
    const key = DEFAULT_SUPABASE_KEY;

    if (url && key) {
      try {
        this.supabase = createClient(url, key, {
          auth: { persistSession: false },
        });
        this.activeUrl = url;
        this.isConnectedToSupabase = true;
        return true;
      } catch (err) {
        console.warn('[Database] Failed to init Supabase client:', err);
        this.supabase = null;
        this.isConnectedToSupabase = false;
        this.activeUrl = null;
        return false;
      }
    } else {
      this.supabase = null;
      this.isConnectedToSupabase = false;
      this.activeUrl = null;
      return false;
    }
  }

  // Load and bootstrap the user's attached Google Cloud service account key
  public async bootstrapUserKey() {
    return;
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private checkAndResetQuotas(account: ServiceAccount): ServiceAccount {
    const today = this.getTodayDateString();
    if (account.last_reset_date !== today) {
      account.daily_count = 0;
      account.last_reset_date = today;
    }
    return account;
  }

  public async getAccounts(): Promise<ServiceAccount[]> {
    await this.ensureInitialized();
    const today = this.getTodayDateString();

    // 1. Primary: Supabase REST API
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('service_accounts')
          .select('*')
          .eq('user_id', getDatabaseScope())
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (Array.isArray(data)) {
          // If Supabase has data, it is the source of truth
          if (data.length > 0) {
            const accounts: ServiceAccount[] = data.map((row) => ({
              id: row.id,
              project_name: row.project_name,
              client_email: row.client_email,
              credentials: decryptCredentials(row.credentials),
              admin_managed: Boolean(row.admin_managed),
              daily_count: Number(row.daily_count || 0),
              last_reset_date: String(row.last_reset_date || today),
              is_active: Boolean(row.is_active),
              created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            }));
            return this.includeAdminManagedAccount(accounts);
          }
          return this.includeAdminManagedAccount([]);
        }
      } catch (err: any) {
        console.error('[Database] Supabase getAccounts failed:', err);
        throw new Error('Could not load indexer accounts from Supabase.');
      }
    }

    // 2. Fallback: Local / Memory Store
    const localStore = this.getLocalStore();
    localStore.service_accounts = localStore.service_accounts.map((acc) =>
      this.checkAndResetQuotas(acc)
    );
    this.saveLocalStore();
    return [...localStore.service_accounts];
  }

  private async includeAdminManagedAccount(accounts: ServiceAccount[]): Promise<ServiceAccount[]> {
    if (!this.supabase) return accounts;
    const userId = getDatabaseScope();
    const { data, error } = await this.supabase
      .from('workflow_secrets')
      .select('encrypted_value,iv,auth_tag')
      .eq('user_id', userId)
      .eq('tool', 'indexer')
      .eq('name', 'GOOGLE_SERVICE_ACCOUNT_JSON')
      .maybeSingle();
    if (error) throw new Error('Could not load the admin-managed Indexer service account.');
    if (!data) return accounts.map((account) => this.checkAndResetQuotas(account));

    let parsed: unknown;
    try {
      parsed = JSON.parse(decryptSecret({
        ciphertext: data.encrypted_value,
        iv: data.iv,
        authTag: data.auth_tag,
      }));
    } catch (error) {
      console.error('[Database] Admin-managed Indexer credential could not be decrypted or parsed:', error);
      throw new Error('The admin-managed Indexer service-account credential is invalid.');
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>).client_email !== 'string' ||
      typeof (parsed as Record<string, unknown>).private_key !== 'string' ||
      typeof (parsed as Record<string, unknown>).project_id !== 'string'
    ) {
      throw new Error('The admin-managed Indexer credential must be valid Google service-account JSON.');
    }

    const credentials = parsed as NonNullable<ServiceAccount['credentials']>;
    const existing = accounts.find((account) => account.client_email === credentials.client_email);
    if (existing) {
      if (existing.admin_managed && JSON.stringify(existing.credentials) !== JSON.stringify(credentials)) {
        const updated = await this.saveAccount({ ...existing, credentials });
        return accounts.map((account) => account.id === existing.id
          ? this.checkAndResetQuotas(updated)
          : this.checkAndResetQuotas(account));
      }
      return accounts.map((account) => this.checkAndResetQuotas(account));
    }

    const created = await this.saveAccount({
      project_name: credentials.project_id || credentials.client_email,
      client_email: credentials.client_email,
      credentials,
      admin_managed: true,
      daily_count: 0,
      last_reset_date: this.getTodayDateString(),
      is_active: true,
    });
    return [created, ...accounts.map((account) => this.checkAndResetQuotas(account))];
  }

  public async getAccountById(id: string): Promise<ServiceAccount | null> {
    await this.ensureInitialized();
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('service_accounts')
          .select('*')
          .eq('id', id)
          .eq('user_id', getDatabaseScope())
          .maybeSingle();

        if (!error && data) {
          return this.checkAndResetQuotas({
            id: data.id,
            project_name: data.project_name,
            client_email: data.client_email,
            credentials: decryptCredentials(data.credentials),
            admin_managed: Boolean(data.admin_managed),
            daily_count: Number(data.daily_count || 0),
            last_reset_date: String(data.last_reset_date || this.getTodayDateString()),
            is_active: Boolean(data.is_active),
            created_at: data.created_at || new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error('[Database] Supabase getAccountById failed:', error);
        throw new Error('Could not load the indexer account from Supabase.');
      }
    }

    const found = this.getLocalStore().service_accounts.find((a) => a.id === id);
    return found ? this.checkAndResetQuotas(found) : null;
  }

  public async getActiveAccountsWithQuota(quotaLimit = 200): Promise<ServiceAccount[]> {
    const accounts = await this.getAccounts();
    return accounts
      .filter((a) => a.is_active && a.daily_count < quotaLimit)
      .sort((a, b) => a.daily_count - b.daily_count);
  }

  public async saveAccount(
    account: Omit<ServiceAccount, 'id' | 'created_at'> & { id?: string }
  ): Promise<ServiceAccount> {
    await this.ensureInitialized();
    const today = this.getTodayDateString();
    const newAccount: ServiceAccount = {
      id: account.id || crypto.randomUUID(),
      project_name: account.project_name,
      client_email: account.client_email,
      credentials: account.credentials,
      admin_managed: Boolean(account.admin_managed),
      daily_count: account.daily_count || 0,
      last_reset_date: account.last_reset_date || today,
      is_active: account.is_active !== undefined ? account.is_active : true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const storedCredentials = encryptCredentials(newAccount.credentials);

    if (!this.supabase && isServerless) {
      throw new Error('Supabase must be configured to store indexer service accounts on Vercel.');
    }

    // Save to Supabase
    if (this.supabase) {
      const { error } = await this.supabase.from('service_accounts').upsert({
          id: newAccount.id,
          user_id: getDatabaseScope(),
          project_name: newAccount.project_name,
          client_email: newAccount.client_email,
          credentials: storedCredentials,
          admin_managed: Boolean(newAccount.admin_managed),
          daily_count: newAccount.daily_count,
          last_reset_date: newAccount.last_reset_date,
          is_active: newAccount.is_active,
          updated_at: newAccount.updated_at,
        });
      if (error) throw error;
    }

    // Save to local
    const localStore = this.getLocalStore();
    const exists = localStore.service_accounts.findIndex((a) => a.id === newAccount.id);
    if (exists !== -1) {
      localStore.service_accounts[exists] = newAccount;
    } else {
      localStore.service_accounts.unshift(newAccount);
    }
    this.saveLocalStore();
    return newAccount;
  }

  public async updateAccount(id: string, updates: Partial<ServiceAccount>): Promise<ServiceAccount | null> {
    await this.ensureInitialized();
    const now = new Date().toISOString();
    const fullUpdates = { ...updates, updated_at: now };
    const storedUpdates: Record<string, unknown> = { ...fullUpdates };
    if (Object.hasOwn(fullUpdates, 'credentials')) {
      storedUpdates.credentials = encryptCredentials(fullUpdates.credentials);
    }
    if (Object.hasOwn(fullUpdates, 'admin_managed')) {
      storedUpdates.admin_managed = Boolean(fullUpdates.admin_managed);
    }

    if (!this.supabase && isServerless) {
      throw new Error('Supabase must be configured to update indexer accounts on Vercel.');
    }

    if (this.supabase) {
      const { error } = await this.supabase
          .from('service_accounts')
          .update(storedUpdates)
          .eq('id', id)
          .eq('user_id', getDatabaseScope());
      if (error) throw error;
    }

    const localStore = this.getLocalStore();
    const index = localStore.service_accounts.findIndex((a) => a.id === id);
    if (index !== -1) {
      localStore.service_accounts[index] = {
        ...localStore.service_accounts[index],
        ...fullUpdates,
      };
      this.saveLocalStore();
      return localStore.service_accounts[index];
    }
    return null;
  }

  public async incrementAccountDailyCount(id: string): Promise<number> {
    const account = await this.getAccountById(id);
    if (!account) return 0;
    const newCount = account.daily_count + 1;
    await this.updateAccount(id, { daily_count: newCount });
    return newCount;
  }

  public async markAccountExhausted(id: string, quotaLimit = 200): Promise<void> {
    await this.updateAccount(id, { daily_count: quotaLimit });
  }

  public async resetAccountQuota(id: string): Promise<void> {
    const today = this.getTodayDateString();
    await this.updateAccount(id, { daily_count: 0, last_reset_date: today });
  }

  public async deleteAccount(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (this.supabase) {
      try {
        await this.supabase.from('service_accounts').delete().eq('id', id).eq('user_id', getDatabaseScope());
      } catch (err: any) {
        console.warn('[Database] Supabase deleteAccount notice:', err.message);
      }
    }

    const localStore = this.getLocalStore();
    const initialLen = localStore.service_accounts.length;
    localStore.service_accounts = localStore.service_accounts.filter((a) => a.id !== id);
    this.saveLocalStore();
    return localStore.service_accounts.length < initialLen;
  }

  public async addUrlLog(log: Omit<UrlLog, 'id' | 'created_at'>): Promise<UrlLog> {
    await this.ensureInitialized();
    const newLog: UrlLog = {
      id: crypto.randomUUID(),
      url: log.url,
      status: log.status,
      notification_type: log.notification_type || 'URL_UPDATED',
      http_code: log.http_code,
      used_account_id: log.used_account_id,
      used_project_name: log.used_project_name,
      response_message: log.response_message,
      created_at: new Date().toISOString(),
    };

    if (this.supabase) {
      try {
        await this.supabase.from('url_logs').insert({
          id: newLog.id,
          user_id: getDatabaseScope(),
          url: newLog.url,
          status: newLog.status,
          notification_type: newLog.notification_type,
          http_code: newLog.http_code,
          used_project_name: newLog.used_project_name,
          response_message: newLog.response_message,
          created_at: newLog.created_at,
        });
      } catch (err: any) {
        console.error('[Database] Supabase addUrlLog failed:', err);
        throw new Error('Could not save the indexer activity log.');
      }
    }

    const localStore = this.getLocalStore();
    localStore.url_logs.unshift(newLog);
    if (localStore.url_logs.length > 500) {
      localStore.url_logs = localStore.url_logs.slice(0, 500);
    }
    this.saveLocalStore();
    return newLog;
  }

  public async getUrlLogs(limit = 100, statusFilter?: string, search?: string): Promise<UrlLog[]> {
    await this.ensureInitialized();
    if (this.supabase) {
      try {
        let query = this.supabase
          .from('url_logs')
          .select('*')
          .eq('user_id', getDatabaseScope())
          .order('created_at', { ascending: false })
          .limit(limit);

        if (statusFilter && statusFilter !== 'ALL') {
          query = query.eq('status', statusFilter);
        }

        if (search) {
          query = query.or(`url.ilike.%${search}%,used_project_name.ilike.%${search}%`);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          return data.map((r) => ({
            id: r.id,
            url: r.url,
            status: r.status,
            notification_type: r.notification_type || 'URL_UPDATED',
            http_code: r.http_code,
            used_account_id: r.used_account_id,
            used_project_name: r.used_project_name,
            response_message: r.response_message,
            created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          }));
        }
      } catch (err: any) {
        console.error('[Database] Supabase getUrlLogs failed:', err);
        throw new Error('Could not load indexer activity logs from Supabase.');
      }
    }

    let logs = [...this.getLocalStore().url_logs];
    if (statusFilter && statusFilter !== 'ALL') {
      logs = logs.filter((l) => l.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.url.toLowerCase().includes(q) ||
          (l.used_project_name && l.used_project_name.toLowerCase().includes(q))
      );
    }
    return logs.slice(0, limit);
  }

  public async clearLogs(): Promise<void> {
    await this.ensureInitialized();
    if (this.supabase) {
      try {
        await this.supabase
          .from('url_logs')
          .delete()
          .eq('user_id', getDatabaseScope())
          .neq('id', '00000000-0000-0000-0000-000000000000');
      } catch (err: any) {
        console.warn('[Database] Supabase clearLogs notice:', err.message);
      }
    }
    this.getLocalStore().url_logs = [];
    this.saveLocalStore();
  }

  public setQuotaLimit(limit: number): number {
    this.quotaLimitPerAccount = limit === 100 ? 100 : 200;
    return this.quotaLimitPerAccount;
  }

  public getQuotaLimit(): number {
    return this.quotaLimitPerAccount;
  }

  public async getSystemStatus(quotaPerAccount?: number): Promise<SystemStatus> {
    await this.ensureInitialized();
    const limit = quotaPerAccount || this.quotaLimitPerAccount;
    const accounts = await this.getAccounts();
    const activeAccounts = accounts.filter((a) => a.is_active);
    const totalDailyQuota = activeAccounts.length * limit;
    const usedDailyQuota = activeAccounts.reduce((sum, a) => sum + (a.daily_count || 0), 0);
    const remainingDailyQuota = Math.max(0, totalDailyQuota - usedDailyQuota);

    return {
      isSupabaseConnected: this.isConnectedToSupabase,
      supabaseUrl: this.activeUrl || DEFAULT_SUPABASE_URL,
      storageMode: this.isConnectedToSupabase ? 'supabase' : 'local_fallback',
      totalAccounts: accounts.length,
      activeAccounts: activeAccounts.length,
      quotaLimitPerAccount: this.quotaLimitPerAccount,
      totalDailyQuota,
      usedDailyQuota,
      remainingDailyQuota,
      adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
      defaultOtpConfigured: Boolean(process.env.ADMIN_OTP),
    };
  }

  public async seedDemoAccounts(): Promise<void> {
    await this.bootstrapUserKey();
  }
}

export const db = new DatabaseAdapter();
