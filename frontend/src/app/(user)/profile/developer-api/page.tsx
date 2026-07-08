'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header/Header';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast/ToastContext';
import styles from './developer-api.module.css';

type APIKeyInfo = {
  id: number;
  name: string;
  isActive: boolean;
  rateLimit: number;
  createdAt: string;
  lastUsedAt?: string | null;
};

type APIRequestLog = {
  id: number;
  apiKeyId: number;
  keyName: string;
  method: string;
  path: string;
  status: number;
  ipAddress: string;
  createdAt: string;
};

type ApiDoc = {
  method: string;
  path: string;
  auth: string;
  description: string;
};

const managementDocs: ApiDoc[] = [
  {
    method: 'POST',
    path: '/api/v1/api-keys',
    auth: 'Authorization: Bearer <JWT>',
    description: 'Create a new developer API key. The plaintext key is returned once.',
  },
  {
    method: 'GET',
    path: '/api/v1/api-keys',
    auth: 'Authorization: Bearer <JWT>',
    description: 'List your existing keys with status, rate limit, and last-used time.',
  },
  {
    method: 'DELETE',
    path: '/api/v1/api-keys/:id',
    auth: 'Authorization: Bearer <JWT>',
    description: 'Revoke a key owned by the current account.',
  },
  {
    method: 'GET',
    path: '/api/v1/api-keys/logs?limit=100',
    auth: 'Authorization: Bearer <JWT>',
    description: 'View request logs for all keys owned by the current account.',
  },
];

const publicDocs: ApiDoc[] = [
  {
    method: 'GET',
    path: '/api/public/v1/products',
    auth: 'X-API-Key: <developer key>',
    description: 'List public product data.',
  },
  {
    method: 'GET',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <developer key>',
    description: 'Fetch a single public product by id.',
  },
  {
    method: 'POST',
    path: '/api/public/v1/products',
    auth: 'X-API-Key: <developer key>',
    description: 'Create a product through the public developer API.',
  },
  {
    method: 'PUT',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <developer key>',
    description: 'Update a product through the public developer API.',
  },
  {
    method: 'DELETE',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <developer key>',
    description: 'Delete a product through the public developer API.',
  },
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';
const buildApiUrl = (path: string) => `${API_BASE}${path}` || path;
const LOGS_PER_PAGE = 10;

export default function DeveloperApiPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [logs, setLogs] = useState<APIRequestLog[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [activeTab, setActiveTab] = useState<'keys' | 'docs' | 'logs'>('keys');
  const [logPage, setLogPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [revokingId, setRevokingId] = useState<number | null>(null);

  const [token, setToken] = useState('');

  useEffect(() => {
    setToken(localStorage.getItem('token') || '');
  }, []);

  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [router, user]);

  useEffect(() => {
    setLogPage(1);
  }, [activeTab]);

  const refreshKeys = async () => {
    if (!token) return;
    setLoadingKeys(true);
    try {
      const res = await fetch(buildApiUrl('/api/v1/api-keys'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load API keys');
      setKeys(data.keys || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load API keys', 'error');
    } finally {
      setLoadingKeys(false);
    }
  };

  const refreshLogs = async () => {
    if (!token) return;
    setLoadingLogs(true);
    try {
      const res = await fetch(buildApiUrl('/api/v1/api-keys/logs?limit=500'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load API logs');
      setLogs(data.logs || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load API logs', 'error');
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (!user || !token) return;
    void refreshKeys();
    void refreshLogs();
  }, [token, user]);

  const handleCreateKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setCreating(true);
    try {
      const res = await fetch(buildApiUrl('/api/v1/api-keys'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newKeyName.trim() || 'API Key' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create API key');
      setGeneratedKey(data.apiKey || '');
      setNewKeyName('');
      showToast('API key created. Copy it now.', 'success');
      await refreshKeys();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create API key', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: number) => {
    if (!token) return;
    if (!confirm('Revoke this API key? It will stop working immediately.')) return;
    setRevokingId(id);
    try {
      const res = await fetch(buildApiUrl(`/api/v1/api-keys/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to revoke API key');
      showToast('API key revoked', 'success');
      await refreshKeys();
      await refreshLogs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to revoke API key', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard', 'success');
    } catch {
      showToast('Copy failed', 'error');
    }
  };

  const totalLogPages = Math.max(1, Math.ceil(logs.length / LOGS_PER_PAGE));
  const paginatedLogs = logs.slice((logPage - 1) * LOGS_PER_PAGE, logPage * LOGS_PER_PAGE);

  return (
    <main className={styles.main}>
      <Header />

      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => router.push('/profile/my-ads')}>
          ← Back to My Shop
        </button>

        <div className={styles.hero}>
          <div>
            <p className={styles.kicker}>Developer tools</p>
            <h1 className={styles.heading}>API documentation and key management</h1>
            <p className={styles.subheading}>
              Manage the API keys attached to this account and use them to call the public developer API.
            </p>
          </div>
          <div className={styles.statusCard}>
            <span className={`${styles.statusBadge} ${user?.status === 'active' ? styles.statusActive : styles.statusMuted}`}>
              Account {user?.status || 'unknown'}
            </span>
            <p className={styles.statusText}>JWT access is required for key management.</p>
            <p className={styles.statusText}>Public API calls use X-API-Key.</p>
          </div>
        </div>

        <section className={styles.tabShell}>
          <div className={styles.tabBar}>
            <button
              className={`${styles.tabButton} ${activeTab === 'keys' ? styles.tabButtonActive : ''}`}
              onClick={() => setActiveTab('keys')}
              type="button"
            >
              Key management
            </button>
            <button
              className={`${styles.tabButton} ${activeTab === 'docs' ? styles.tabButtonActive : ''}`}
              onClick={() => setActiveTab('docs')}
              type="button"
            >
              API documentation
            </button>
            <button
              className={`${styles.tabButton} ${activeTab === 'logs' ? styles.tabButtonActive : ''}`}
              onClick={() => setActiveTab('logs')}
              type="button"
            >
              Request log
            </button>
          </div>

          {activeTab === 'docs' && (
            <>
              <div className={styles.sectionHeader}>
                <h2>Quick reference</h2>
                <p>Base path: <span>/api</span></p>
              </div>

              <div className={styles.docGrid}>
                <div className={styles.docCard}>
                  <h3>Management API</h3>
                  <p>Use these routes with your logged-in JWT.</p>
                  {managementDocs.map((doc) => (
                    <div key={doc.method + doc.path} className={styles.docRow}>
                      <span className={styles.methodPill}>{doc.method}</span>
                      <div>
                        <p className={styles.docPath}>{doc.path}</p>
                        <p className={styles.docAuth}>{doc.auth}</p>
                        <p className={styles.docDescription}>{doc.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.docCard}>
                  <h3>Public developer API</h3>
                  <p>Use a generated key in the X-API-Key header.</p>
                  {publicDocs.map((doc) => (
                    <div key={doc.method + doc.path} className={styles.docRow}>
                      <span className={styles.methodPill}>{doc.method}</span>
                      <div>
                        <p className={styles.docPath}>{doc.path}</p>
                        <p className={styles.docAuth}>{doc.auth}</p>
                        <p className={styles.docDescription}>{doc.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.codeGrid}>
                <div className={styles.codeCard}>
                  <h3>Create a key</h3>
                  <pre>{`POST /api/v1/api-keys
Authorization: Bearer <JWT>
Content-Type: application/json

{ "name": "My Developer Key" }`}</pre>
                </div>
                <div className={styles.codeCard}>
                  <h3>Use a key</h3>
                  <pre>{`GET /api/public/v1/products
X-API-Key: sk_live_...`}</pre>
                </div>
              </div>
            </>
          )}

          {activeTab === 'keys' && (
            <section className={styles.sectionContent}>
              <div className={styles.sectionHeader}>
                <h2>Key management</h2>
                <p>{user?.status === 'active' ? 'This account is active.' : 'This account is not marked active.'}</p>
              </div>

              <form className={styles.form} onSubmit={handleCreateKey}>
                <label className={styles.label} htmlFor="key-name">Key name</label>
                <div className={styles.formRow}>
                  <input
                    id="key-name"
                    className={styles.input}
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Marketing bot, staging app, mobile app"
                  />
                  <button className={styles.primaryBtn} type="submit" disabled={creating}>
                    {creating ? 'Creating…' : 'Create key'}
                  </button>
                </div>
              </form>

              {generatedKey && (
                <div className={styles.generatedKeyBox}>
                  <div>
                    <p className={styles.label}>Copy this key now. It will not be shown again.</p>
                    <code>{generatedKey}</code>
                  </div>
                  <button className={styles.secondaryBtn} type="button" onClick={() => copyText(generatedKey)}>
                    Copy key
                  </button>
                </div>
              )}

              <div className={styles.listCard}>
                <div className={styles.listHeader}>
                  <h3>Your keys</h3>
                  <button className={styles.secondaryBtn} type="button" onClick={refreshKeys}>
                    Refresh
                  </button>
                </div>
                {loadingKeys ? (
                  <p className={styles.emptyText}>Loading keys…</p>
                ) : keys.length === 0 ? (
                  <p className={styles.emptyText}>No API keys yet.</p>
                ) : (
                  <div className={styles.keyList}>
                    {keys.map((key) => (
                      <div key={key.id} className={styles.keyRow}>
                        <div>
                          <div className={styles.keyTitleRow}>
                            <h4>{key.name}</h4>
                            <span className={`${styles.keyStatus} ${key.isActive ? styles.keyStatusOn : styles.keyStatusOff}`}>
                              {key.isActive ? 'Active' : 'Revoked'}
                            </span>
                          </div>
                          <p>ID {key.id} · Rate limit {key.rateLimit}/min</p>
                          <p>Created {key.createdAt}</p>
                          <p>{key.lastUsedAt ? `Last used ${key.lastUsedAt}` : 'Never used'}</p>
                        </div>
                        <button
                          className={styles.dangerBtn}
                          type="button"
                          disabled={!key.isActive || revokingId === key.id}
                          onClick={() => handleRevoke(key.id)}
                        >
                          {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'logs' && (
            <section className={styles.sectionContent}>
              <div className={styles.sectionHeader}>
                <h2>Request log</h2>
                <button className={styles.secondaryBtn} type="button" onClick={refreshLogs}>
                  Refresh
                </button>
              </div>
              {loadingLogs ? (
                <p className={styles.emptyText}>Loading logs…</p>
              ) : logs.length === 0 ? (
                <p className={styles.emptyText}>No request logs yet.</p>
              ) : (
                <>
                  <div className={styles.logList}>
                    {paginatedLogs.map((log) => (
                      <div key={log.id} className={styles.logRow}>
                        <div className={styles.logTopRow}>
                          <span className={`${styles.methodPill} ${styles.smallPill}`}>{log.method}</span>
                          <strong>{log.path}</strong>
                          <span className={styles.logStatus}>{log.status}</span>
                        </div>
                        <p>Key: {log.keyName} · IP: {log.ipAddress || 'unknown'} · {log.createdAt}</p>
                      </div>
                    ))}
                  </div>

                  <div className={styles.paginationBar}>
                    <button
                      className={styles.secondaryBtn}
                      type="button"
                      onClick={() => setLogPage((prev) => Math.max(1, prev - 1))}
                      disabled={logPage === 1}
                    >
                      Previous
                    </button>
                    <span className={styles.pageIndicator}>
                      Page {logPage} of {totalLogPages}
                    </span>
                    <button
                      className={styles.secondaryBtn}
                      type="button"
                      onClick={() => setLogPage((prev) => Math.min(totalLogPages, prev + 1))}
                      disabled={logPage >= totalLogPages}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}