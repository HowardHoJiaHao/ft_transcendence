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

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type Endpoint = {
  method: HttpMethod;
  path: string;
  auth: string;
  description: string;
  params?: string[];
  request: string;
  response?: string;
};

const managementEndpoints: Endpoint[] = [
  {
    method: 'POST',
    path: '/api/v1/api-keys',
    auth: 'Authorization: Bearer <JWT>',
    description:
      'Generate a new API key. The plaintext key is returned ONCE in this response and can never be retrieved again — copy it immediately.',
    request: `curl -k -X POST https://localhost/api/v1/api-keys \\
  -H "Authorization: Bearer <JWT>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My Inventory Bot"}'`,
    response: `{
  "id": 1,
  "name": "My Inventory Bot",
  "apiKey": "sk_live_7ba8b2f9...c3ce5aa8",
  "warning": "Copy this key now — it will not be shown again."
}`,
  },
  {
    method: 'GET',
    path: '/api/v1/api-keys',
    auth: 'Authorization: Bearer <JWT>',
    description:
      'List your keys — metadata only (the secret is never returned, because only its hash is stored).',
    request: `curl -k https://localhost/api/v1/api-keys \\
  -H "Authorization: Bearer <JWT>"`,
    response: `{
  "keys": [
    {
      "id": 1,
      "name": "My Inventory Bot",
      "isActive": true,
      "rateLimit": 100,
      "createdAt": "2026-07-08T08:33:37Z",
      "lastUsedAt": "2026-07-08T08:33:54Z"
    }
  ]
}`,
  },
  {
    method: 'DELETE',
    path: '/api/v1/api-keys/:id',
    auth: 'Authorization: Bearer <JWT>',
    description:
      'Revoke a key. It stops working immediately (public calls with it return 403). The row is kept so its request logs stay attributable.',
    request: `curl -k -X DELETE https://localhost/api/v1/api-keys/1 \\
  -H "Authorization: Bearer <JWT>"`,
    response: `{ "message": "API key revoked" }`,
  },
  {
    method: 'GET',
    path: '/api/v1/api-keys/logs',
    auth: 'Authorization: Bearer <JWT>',
    description:
      'Audit trail: every request made with any of your keys — method, path, status, caller IP, and timestamp. Use ?limit=1..500 (default 100).',
    request: `curl -k "https://localhost/api/v1/api-keys/logs?limit=50" \\
  -H "Authorization: Bearer <JWT>"`,
    response: `{
  "logs": [
    {
      "id": 7,
      "apiKeyId": 1,
      "keyName": "My Inventory Bot",
      "method": "GET",
      "path": "/api/public/v1/products",
      "status": 200,
      "ipAddress": "172.18.0.1",
      "createdAt": "2026-07-08T08:34:39Z"
    }
  ]
}`,
  },
];

const publicEndpoints: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/public/v1/products',
    auth: 'X-API-Key: <your key>',
    description: 'List marketplace listings, with the same filters the site itself uses.',
    params: [
      'limit (max 100), offset — pagination',
      'search — title contains',
      'sort — price-low | price-high | newest | rating',
      'minPrice, maxPrice — price range',
      'sellerId — only one seller’s listings',
      'status — active | sold | archived',
      'weightCategory, flexibilityCategory, balanceCategory — racket specs',
    ],
    request: `curl -k "https://localhost/api/public/v1/products?limit=2&sort=price-high" \\
  -H "X-API-Key: sk_live_..."`,
    response: `{
  "products": [
    { "id": 55, "title": "Yonex Astrox 100ZZ 4U", "price": 950, "category": "Rackets", "status": "active", "...": "..." }
  ],
  "total": 40
}`,
  },
  {
    method: 'GET',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <your key>',
    description: 'Fetch one listing by id. Returns 404 if it does not exist.',
    request: `curl -k https://localhost/api/public/v1/products/55 \\
  -H "X-API-Key: sk_live_..."`,
    response: `{ "id": 55, "title": "Yonex Astrox 100ZZ 4U", "price": 950, "sellerId": 10, "...": "..." }`,
  },
  {
    method: 'POST',
    path: '/api/public/v1/products',
    auth: 'X-API-Key: <your key>',
    description:
      'Create a listing. It is always owned by the key’s account — any sellerId in the body is ignored and replaced with yours.',
    params: [
      'title (required, non-empty), price (required, > 0)',
      'category — default "Others"; site uses: Rackets, Footwear, Apparel, Strings, Accessories, Bags, Others',
      'condition — default "Second-hand (Used)"; site uses: New, Second-hand (Used)',
      'dealingMethod — default "Meet Up"; site uses: Meet Up, Delivery',
      'weightCategory — default "4U"; site uses: 1U–8U',
      'flexibilityCategory — default "Medium Flex"; site uses: Stiff Shaft, Medium Flex, High Flexibility',
      'balanceCategory — default "Even Balance"; site uses: Head Heavy, Even Balance, Head Light',
      'phoneNumber, location (default "Malaysia"), description — free text, not validated',
      'originalPrice (number|null), stockQuantity (integer, default 1, must be ≥ 1 if given)',
      'isNew, isFeatured — boolean',
    ],
    request: `curl -k -X POST https://localhost/api/public/v1/products \\
  -H "X-API-Key: sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"title":"My Racket","price":123,"category":"Rackets","stockQuantity":1}'`,
    response: `201 Created
{ "id": 60, "title": "My Racket", "price": 123, "status": "active", "...": "..." }`,
  },
  {
    method: 'POST',
    path: '/api/public/v1/products/import',
    auth: 'X-API-Key: <your key>',
    description:
      'Bulk create up to 500 listings in one call. Every item is validated first; if ANY item is invalid, nothing is created and you get per-row errors back (all-or-nothing, one database transaction). All listings are owned by the key’s account — sellerId in items is ignored.',
    params: [
      'items (required) — array of 1–500 listing objects',
      'each item takes the same fields as POST /products: title (required), price (required, > 0), and optional description, category, condition, dealingMethod, phoneNumber, location, weightCategory, flexibilityCategory, balanceCategory, originalPrice (> 0 if given), stockQuantity (integer ≥ 1, default 1), isNew, isFeatured',
      'omitted optional fields get the same defaults as the single-product POST',
      'on success: 201 with { imported, ids } — ids are the new listing ids in item order',
      'on validation failure: 400 with { imported: 0, errors: [{ row, field, message }] } — row is the 1-based position in items',
    ],
    request: `curl -k -X POST https://localhost/api/public/v1/products/import \\
  -H "X-API-Key: sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "items": [
      { "title": "Yonex Astrox 88D Pro", "price": 450, "category": "Rackets", "stockQuantity": 1 },
      { "title": "Victor Thruster K9900", "price": 380, "category": "Rackets", "condition": "New" }
    ]
  }'`,
    response: `201 Created
{ "imported": 2, "ids": [61, 62] }

# If any row is invalid, NOTHING is imported:
400 Bad Request
{
  "imported": 0,
  "errors": [
    { "row": 2, "field": "price", "message": "price must be greater than 0" }
  ]
}`,
  },
  {
    method: 'PUT',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <your key>',
    description:
      'Update a listing you own (else 403, 404 if missing). ⚠ FULL REPLACE, not a patch — any field you omit is saved as empty/zero, except stockQuantity which keeps its current value if omitted.',
    params: [
      'title (required, non-empty), price (required, > 0)',
      'description, category, condition, dealingMethod, phoneNumber, location, weightCategory, flexibilityCategory, balanceCategory, originalPrice — same free-text fields as POST, omitted = saved empty',
      'status — active | sold | archived (default "active" if omitted)',
      'stockQuantity — integer ≥ 0; omitted keeps current stock; setting it to 0 auto-flips status to "sold" even if you sent "active"',
    ],
    request: `# Full update — always resend every field you want kept
curl -k -X PUT https://localhost/api/public/v1/products/60 \\
  -H "X-API-Key: sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Racket (price drop)",
    "price": 99,
    "description": "Lightly used, great condition",
    "category": "Rackets",
    "location": "Kuala Lumpur",
    "status": "active"
  }'

# Zero out stock -> status auto-flips to "sold"
curl -k -X PUT https://localhost/api/public/v1/products/60 \\
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \\
  -d '{"title":"My Racket","price":99,"stockQuantity":0}'`,
    response: `{ "id": 60, "title": "My Racket", "price": 99, "status": "sold", "stockQuantity": 0, "...": "..." }`,
  },
  {
    method: 'DELETE',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <your key>',
    description:
      'Delete a listing you own (else 403, 404 if missing). No request body. Permanent — there is no undo.',
    request: `curl -k -X DELETE https://localhost/api/public/v1/products/60 \\
  -H "X-API-Key: sk_live_..."`,
    response: `{ "message": "Product deleted" }`,
  },
];

const statusCodes: Array<[string, string]> = [
  ['200', 'OK'],
  ['201', 'Created (POST)'],
  ['400', 'Bad request — missing/invalid fields'],
  ['401', 'Missing or invalid API key / JWT'],
  ['403', 'Key revoked, or you don’t own the target listing'],
  ['404', 'Not found'],
  ['429', 'Rate limit exceeded — wait for the next minute window'],
  ['500', 'Server error'],
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';
const buildApiUrl = (path: string) => `${API_BASE}${path}` || path;
const LOGS_PER_PAGE = 12;

const formatDateTime = (str?: string | null) => {
  if (!str) return '—';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

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
  }, [token, user]); // eslint-disable-line react-hooks/exhaustive-deps

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
      showToast('API key created. Copy it now — it will not be shown again.', 'success');
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

  const methodClass = (m: string) =>
    m === 'GET' ? styles.methodGet
      : m === 'POST' ? styles.methodPost
        : m === 'PUT' ? styles.methodPut
          : styles.methodDelete;

  const logStatusClass = (status: number) =>
    status < 300 ? styles.logOk : status < 500 ? styles.logWarn : styles.logErr;

  const totalLogPages = Math.max(1, Math.ceil(logs.length / LOGS_PER_PAGE));
  const clampedLogPage = Math.min(logPage, totalLogPages);
  const paginatedLogs = logs.slice(
    (clampedLogPage - 1) * LOGS_PER_PAGE,
    clampedLogPage * LOGS_PER_PAGE,
  );

  const renderEndpoint = (ep: Endpoint) => (
    <div key={ep.method + ep.path} className={styles.endpointCard}>
      <div className={styles.endpointHead}>
        <span className={`${styles.methodPill} ${methodClass(ep.method)}`}>{ep.method}</span>
        <code className={styles.endpointPath}>{ep.path}</code>
      </div>
      <p className={styles.endpointAuth}>{ep.auth}</p>
      <p className={styles.endpointDesc}>{ep.description}</p>
      {ep.params && (
        <ul className={styles.paramList}>
          {ep.params.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className={styles.exampleBlock}>
        <div className={styles.exampleHead}>
          <span>Example request</span>
          <button className={styles.copyBtn} type="button" onClick={() => copyText(ep.request)}>
            Copy
          </button>
        </div>
        <pre className={styles.codeBox}>{ep.request}</pre>
      </div>
      {ep.response && (
        <div className={styles.exampleBlock}>
          <div className={styles.exampleHead}>
            <span>Example response</span>
          </div>
          <pre className={styles.codeBox}>{ep.response}</pre>
        </div>
      )}
    </div>
  );

  return (
    <main className={styles.main}>
      <Header />

      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => router.push('/profile/my-ads')}>
          ← Back to My Shop
        </button>

        <h1 className={styles.heading}>🔑 Developer API</h1>
        <p className={styles.subheading}>
          Generate secret keys, read the API documentation, and audit every request made
          with your keys.
        </p>

        <div className={styles.card}>
          <div className={styles.tabBar}>
            <button
              className={`${styles.tab} ${activeTab === 'keys' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('keys')}
              type="button"
            >
              🔐 Create Secret Key
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'docs' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('docs')}
              type="button"
            >
              📖 API Documentation
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'logs' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('logs')}
              type="button"
            >
              📋 Request Log
            </button>
          </div>

          <div className={styles.tabContent}>
            {activeTab === 'keys' && (
              <>
                <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>🔐 Create a secret key</h2>
                  <p className={styles.sectionHint}>
                    The key is shown once, right after creation. Store it somewhere safe —
                    only a hash is kept on our side, so it can never be displayed again.
                  </p>
                  <form className={styles.formRow} onSubmit={handleCreateKey}>
                    <input
                      className={styles.input}
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="Key name, e.g. My Inventory Bot"
                    />
                    <button className={styles.primaryBtn} type="submit" disabled={creating}>
                      {creating ? 'Creating…' : '+ Create key'}
                    </button>
                  </form>

                  {generatedKey && (
                    <div className={styles.generatedKeyBox}>
                      <div className={styles.generatedKeyText}>
                        <p className={styles.generatedKeyWarning}>
                          ⚠ Copy this key now — it will not be shown again.
                        </p>
                        <code className={styles.generatedKeyValue}>{generatedKey}</code>
                      </div>
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        onClick={() => copyText(generatedKey)}
                      >
                        ⧉ Copy
                      </button>
                    </div>
                  )}
                </div>

                <div className={styles.sectionCard}>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>🗝 Your keys</h2>
                    <button className={styles.secondaryBtn} type="button" onClick={refreshKeys}>
                      ↻ Refresh
                    </button>
                  </div>
                  {loadingKeys ? (
                    <p className={styles.emptyText}>Loading keys…</p>
                  ) : keys.length === 0 ? (
                    <p className={styles.emptyText}>
                      No API keys yet — create your first one above.
                    </p>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.statsTable}>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Rate limit</th>
                            <th>Created</th>
                            <th>Last used</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {keys.map((key) => (
                            <tr key={key.id}>
                              <td className={styles.mutedCell}>{key.id}</td>
                              <td className={styles.strongCell}>{key.name}</td>
                              <td>
                                <span
                                  className={`${styles.statusChip} ${key.isActive ? styles.statusActive : styles.statusRevoked}`}
                                >
                                  {key.isActive ? 'Active' : 'Revoked'}
                                </span>
                              </td>
                              <td>{key.rateLimit}/min</td>
                              <td>{formatDateTime(key.createdAt)}</td>
                              <td>{formatDateTime(key.lastUsedAt)}</td>
                              <td>
                                <button
                                  className={styles.dangerBtn}
                                  type="button"
                                  disabled={!key.isActive || revokingId === key.id}
                                  onClick={() => handleRevoke(key.id)}
                                >
                                  {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'docs' && (
              <>
                <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>🚀 Quickstart</h2>
                  <ol className={styles.quickstart}>
                    <li>
                      <strong>Create a key</strong> in the “Create Secret Key” tab and copy it —
                      it is shown only once.
                    </li>
                    <li>
                      <strong>Send it on every request</strong> as a header:{' '}
                      <code className={styles.inlineCode}>X-API-Key: sk_live_...</code>
                    </li>
                    <li>
                      <strong>Call any endpoint below.</strong> Each key is rate-limited
                      (default 100 requests/minute) and every call is recorded in your
                      Request Log.
                    </li>
                  </ol>
                  <div className={styles.calloutRow}>
                    <div className={styles.callout}>
                      <p className={styles.calloutTitle}>Base URL</p>
                      <code className={styles.inlineCode}>https://localhost/api/public/v1</code>
                    </div>
                    <div className={styles.callout}>
                      <p className={styles.calloutTitle}>Rate limit</p>
                      <p className={styles.calloutText}>
                        Per key, per minute (default 100). Exceeding it returns 429 until the
                        next minute window.
                      </p>
                    </div>
                    <div className={styles.callout}>
                      <p className={styles.calloutTitle}>Audit log</p>
                      <p className={styles.calloutText}>
                        Every request is logged: method, path, status, IP, and time — see the
                        Request Log tab.
                      </p>
                    </div>
                  </div>
                </div>

                <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>🌐 Public API — products</h2>
                  <p className={styles.sectionHint}>
                    Authenticate with <code className={styles.inlineCode}>X-API-Key</code>. Write
                    operations act as the key&apos;s owner: you can only modify your own listings.
                  </p>
                  {publicEndpoints.map(renderEndpoint)}
                </div>

                <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>🛠 Key management API</h2>
                  <p className={styles.sectionHint}>
                    These endpoints use your normal login session (
                    <code className={styles.inlineCode}>Authorization: Bearer &lt;JWT&gt;</code>
                    ) — the same calls this page makes for you.
                  </p>

                  <div className={styles.jwtHelpBox}>
                    <p className={styles.jwtHelpTitle}>🔑 How to get a JWT to call these directly</p>
                    <ol className={styles.jwtHelpSteps}>
                      <li>
                        Log in via the API — <code className={styles.inlineCode}>POST /api/v1/auth/login</code>{' '}
                        with your email/password; the response&apos;s <code className={styles.inlineCode}>token</code> field is your JWT.
                      </li>
                      <li>
                        <strong>Or, since you&apos;re already logged in here:</strong> open DevTools
                        (F12) → Console tab → run{' '}
                        <code className={styles.inlineCode}>localStorage.getItem(&apos;token&apos;)</code>.
                      </li>
                      <li>
                        <strong>Or</strong> click the button below to copy your current session&apos;s
                        JWT straight to your clipboard.
                      </li>
                    </ol>
                    <button
                      className={styles.secondaryBtn}
                      type="button"
                      onClick={() => (token ? copyText(token) : showToast('No active session token found', 'error'))}
                    >
                      ⧉ Copy my current JWT
                    </button>
                  </div>

                  {managementEndpoints.map(renderEndpoint)}
                </div>

                <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>📟 Status codes</h2>
                  <div className={styles.tableWrap}>
                    <table className={styles.statsTable}>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Meaning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statusCodes.map(([code, meaning]) => (
                          <tr key={code}>
                            <td className={styles.strongCell}>{code}</td>
                            <td>{meaning}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'logs' && (
              <div className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>📋 Request log</h2>
                  <button className={styles.secondaryBtn} type="button" onClick={refreshLogs}>
                    ↻ Refresh
                  </button>
                </div>
                <p className={styles.sectionHint}>
                  Every call made with your API keys, newest first — review this for
                  unfamiliar IPs or unexpected activity, and revoke a key if it looks
                  compromised.
                </p>
                {loadingLogs ? (
                  <p className={styles.emptyText}>Loading logs…</p>
                ) : logs.length === 0 ? (
                  <p className={styles.emptyText}>
                    No requests logged yet — calls appear here as soon as a key is used.
                  </p>
                ) : (
                  <>
                    <div className={styles.tableWrap}>
                      <table className={styles.statsTable}>
                        <thead>
                          <tr>
                            <th>Method</th>
                            <th>Path</th>
                            <th>Status</th>
                            <th>Key</th>
                            <th>IP</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedLogs.map((log) => (
                            <tr key={log.id}>
                              <td>
                                <span className={`${styles.methodPill} ${methodClass(log.method)}`}>
                                  {log.method}
                                </span>
                              </td>
                              <td className={styles.pathCell}>{log.path}</td>
                              <td>
                                <span className={`${styles.logStatus} ${logStatusClass(log.status)}`}>
                                  {log.status}
                                </span>
                              </td>
                              <td>{log.keyName}</td>
                              <td className={styles.mutedCell}>{log.ipAddress || '—'}</td>
                              <td className={styles.mutedCell}>{formatDateTime(log.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {totalLogPages > 1 && (
                      <div className={styles.pagination}>
                        <button
                          className={styles.pageBtn}
                          type="button"
                          disabled={clampedLogPage === 1}
                          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                        >
                          ‹
                        </button>
                        {Array.from({ length: totalLogPages }, (_, i) => (
                          <button
                            key={i + 1}
                            className={`${styles.pageBtn} ${clampedLogPage === i + 1 ? styles.pageBtnActive : ''}`}
                            type="button"
                            onClick={() => setLogPage(i + 1)}
                          >
                            {i + 1}
                          </button>
                        ))}
                        <button
                          className={styles.pageBtn}
                          type="button"
                          disabled={clampedLogPage === totalLogPages}
                          onClick={() => setLogPage((p) => Math.min(totalLogPages, p + 1))}
                        >
                          ›
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
