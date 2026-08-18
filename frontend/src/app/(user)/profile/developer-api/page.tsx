'use client';

import { useEffect, useState } from 'react';
import Header from '@/components/Header/Header';
import ShopHeader from '@/components/ShopTabs/ShopHeader';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';

type APIKeyInfo = {
  id: number;
  name: string;
  isActive: boolean;
  rateLimit: number;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  lastUsedAt?: string | null;
};

type APIRequestLog = {
  id: number;
  apiKeyId?: number | null;
  keyName: string;
  method: string;
  path: string;
  status: number;
  ipAddress: string;
  outcome: string;
  userAgent: string;
  createdAt: string;
};

const OUTCOME_LABELS: Record<string, string> = {
  success: 'Accepted',
  missing_key: 'No key sent',
  invalid_key: 'Unknown key',
  revoked_key: 'Revoked key',
  expired_key: 'Expired key',
  rate_limited: 'Rate limited',
};

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type Endpoint = {
  method: HttpMethod;
  path: string;
  auth: string;
  // Short label shown on the collapsed row, so the closed accordion still
  // reads as an index of what each endpoint does without opening anything.
  // The full `description` is a sentence or two and is far too long for that
  // line. Optional so the commented-out managementEndpoints array below still
  // compiles if it is ever restored.
  summary?: string;
  description: string;
  params?: string[];
  request: string;
  response?: string;
};

/* Key-management endpoint docs — commented out: the Keys tab GUI on this page
   already creates, lists and revokes keys, so documenting the same calls was
   duplicate surface. The endpoints themselves are still live (backend/api_keys.go,
   routes in main.go); only this documentation is hidden. Restore this array and
   its JSX block below to bring the section back.
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
*/

const publicEndpoints: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/public/v1/products',
    auth: 'X-API-Key: <your key>',
    summary: 'List your listings',
    description:
      'List YOUR listings. This API only serves the account the key belongs to',
    params: [
      'limit — page size, 1-100. Defaults to 20.',
      'sort — price-low | price-high | newest',
      'status — active | sold | archived',
      'Any other parameter returns 400 naming it.',
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
    summary: 'Fetch one listing',
    description:
      'Fetch one of your listings by id. Returns 404 if it does not exist or belongs to another account.',
    request: `curl -k https://localhost/api/public/v1/products/55 \\
  -H "X-API-Key: sk_live_..."`,
    response: `{ "id": 55, "title": "Yonex Astrox 100ZZ 4U", "price": 950, "sellerId": 10, "...": "..." }`,
  },
  {
    method: 'POST',
    path: '/api/public/v1/products',
    auth: 'X-API-Key: <your key>',
    summary: 'Create a listing',
    description:
      'Create a listing owned by the key’s account. Any sellerId in the body is ignored and replaced with yours. This is the public API equivalent of the sell form, with the same required fields and defaults.',
    params: [
      'title (required): listing headline, non-empty. Example: "Yonex Astrox 100ZZ"',
      'price (required): asking price, must be > 0. Example: 950',
      'location (required): where the item is, non-empty. Example: "Kuala Lumpur"',
      'dealingMethod (required): how the item changes hands, non-empty. All values: "Meet Up", "Mailing or Delivery", "Meet Up, Mailing or Delivery"',
      'category (optional): product type. Default: "Others". All values: "Rackets", "Grips", "Shuttlecocks", "Racket Bags & Covers", "Strings", "Shoes", "Apparel", "Accessories", "Others"',
      'condition (optional): item condition. Default: "Second-hand (Used)". All values: "Second-hand (Used)", "New", "Refurbished"',
      'weightCategory (optional): racket weight class, kept only when category = "Rackets". Default: "4U". All values: "1U", "2U", "3U", "4U", "5U", "6U", "7U", "8U"',
      'flexibilityCategory (optional): shaft flex, kept only when category = "Rackets". Default: "Medium Flex". All values: "Stiff Shaft", "Medium Flex", "High Flexibility"',
      'balanceCategory (optional): balance point, kept only when category = "Rackets". Default: "Even Balance". All values: "Head Heavy", "Even Balance", "Head Light"',
      'description (optional): free text detail. Default: "". Example: "Used but well maintained, 2 months old"',
      'phoneNumber (optional): contact number shown on the listing. Default: "". Example: "0123456789"',
      'originalPrice (optional): pre-discount price, shown struck through. Default: null. Example: 1200',
      'stockQuantity (optional): units available, must be >= 1 if given. Default: 1. Example: 3',
      'image (ignored): accepted in the body but discarded — upload covers afterwards with POST /api/v1/products/:id/files',
      'sellerId / sellerName (ignored): always overwritten with your own account id and username',
      'Rule: if category is not "Rackets", then weightCategory, flexibilityCategory and balanceCategory are stored as empty strings whatever you send.',
      'Rule: any field not listed above is rejected with 400 "invalid field: <name>".',
    ],
    request: `curl -k -X POST https://localhost/api/public/v1/products \\
  -H "X-API-Key: sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Racket",
    "price": 123,
    "location": "Kuala Lumpur",
    "dealingMethod": "Meet Up"
  }'`,
    response: `201 Created
{ "id": 60, "title": "My Racket", "price": 123, "status": "active", "...": "..." }`,
  },
  {
    method: 'PUT',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <your key>',
    summary: 'Update a listing',
    description:
      'Update a listing you own (else 403, 404 if missing). Partial update: omitted fields keep their current value. Six fields are editable and at least one of them must be present; status is not among them, so the listing keeps whatever status it has.',
    params: [
      'At least one of the six fields below must be present, else 400 "At least one field must be provided to update".',
      'title (optional): new headline; if sent it must be non-empty. Example: "Yonex Astrox 100ZZ (price drop)"',
      'price (optional): new price; if sent it must be > 0. Example: 99',
      'description (optional): replaces the description; send "" to clear it. Example: "Lightly used, great condition"',
      'category (optional): new product type. All values: "Rackets", "Grips", "Shuttlecocks", "Racket Bags & Covers", "Strings", "Shoes", "Apparel", "Accessories", "Others"',
      'location (optional): new location. Example: "Petaling Jaya"',
      'stockQuantity (optional): units available, must be >= 0 if given; 0 is allowed and does not change the status. Example: 0',
      'Not accepted — each returns 400 "invalid field: <name>": weightCategory, flexibilityCategory, balanceCategory, status, condition, dealingMethod, phoneNumber, originalPrice, isNew, isFeatured, image, sellerId.',
      'The racket specs are derived, not sent: they keep their stored values while the category is "Rackets", and are cleared to empty strings the moment the listing moves to any other category.',
      'A listing in pending or sold state cannot be edited (409).',
    ],
    request: `# Partial update — only the fields you send are changed
curl -k -X PUT https://localhost/api/public/v1/products/60 \\
  -H "X-API-Key: sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Racket (price drop)",
    "price": 99,
    "description": "Lightly used, great condition",
    "category": "Rackets",
    "location": "Kuala Lumpur"
  }'

# stockQuantity can be updated, but the listing status itself stays as-is
curl -k -X PUT https://localhost/api/public/v1/products/60 \\
  -H "X-API-Key: sk_live_..." -H "Content-Type: application/json" \\
  -d '{"title":"My Racket","price":99,"stockQuantity":0}'`,
    response: `{ "id": 60, "title": "My Racket", "price": 99, "status": "active", "stockQuantity": 0, "...": "..." }`,
  },
  {
    method: 'DELETE',
    path: '/api/public/v1/products/:id',
    auth: 'X-API-Key: <your key>',
    summary: 'Delete a listing',
    description:
      'Delete a listing you own (else 403, 404 if missing). Only active and archived listings can be deleted. Pending and sold listings are blocked. No request body. Permanent — there is no undo.',
    request: `curl -k -X DELETE https://localhost/api/public/v1/products/60 \\
  -H "X-API-Key: sk_live_..."`,
    response: `{ "message": "Product deleted" }`,
  },
];

const statusCodes: Array<[string, string]> = [
  ['200', 'OK'],
  ['201', 'Created (POST)'],
  ['400', 'Bad request — missing/invalid fields'],
  ['401', 'Missing, invalid, or expired API key / JWT'],
  ['403', 'Key revoked, or you don’t own the target listing'],
  ['404', 'Not found'],
  ['409', 'Conflict — the listing is pending or sold, or still has orders'],
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
  // Guards on loading as well as user: AuthContext starts null and only reads
  // the cached session on mount, so redirecting on `!user` alone bounces the
  // page to /login before the session has been restored.
  const { user } = useRequireAuth('/login');
  const { showToast } = useToast();
  // Only the controls are localised here — the endpoint reference below stays in
  // English, since it documents literal API paths, fields and JSON payloads.
  const { t } = useI18n();

  const [keys, setKeys] = useState<APIKeyInfo[]>([]);
  const [logs, setLogs] = useState<APIRequestLog[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [activeTab, setActiveTab] = useState<'keys' | 'docs' | 'logs'>('keys');
  // '' = every key's traffic; a key id narrows the log to that one key.
  const [logKeyFilter, setLogKeyFilter] = useState('');
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

  const refreshLogs = async (keyId?: number | null) => {
    if (!token) return;
    setLoadingLogs(true);
    try {
      // Filtering server-side rather than in the browser: a busy key's history
      // would otherwise be crowded out of the shared 500-row window.
      const query = keyId ? `?limit=500&apiKeyId=${keyId}` : '?limit=500';
      const res = await fetch(buildApiUrl(`/api/v1/api-keys/logs${query}`), {
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
    void refreshLogs(logKeyFilter ? Number(logKeyFilter) : null);
  }, [token, user, logKeyFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!confirm(t('devApi.revokeConfirm'))) return;
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
      await refreshLogs(logKeyFilter ? Number(logKeyFilter) : null);
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
    m === 'GET' ? 'bg-[#e3edfb] text-[#1c5cab]'
      : m === 'POST' ? 'bg-[#e6f4ea] text-[#1a7f37]'
        : m === 'PUT' ? 'bg-[#fff3cd] text-[#8d6e00]'
          : 'bg-[#fee2e2] text-[#991b1b]';

  const logStatusClass = (status: number) =>
    status < 300 ? 'bg-[#e6f4ea] text-[#1a7f37]' : status < 500 ? 'bg-[#fff3cd] text-[#8d6e00]' : 'bg-[#fee2e2] text-[#991b1b]';

  const outcomeClass = (outcome: string) =>
    outcome === 'success' ? 'bg-[#e6f4ea] text-[#1a7f37]' : 'bg-[#fee2e2] text-[#991b1b]';

  const totalLogPages = Math.max(1, Math.ceil(logs.length / LOGS_PER_PAGE));
  const clampedLogPage = Math.min(logPage, totalLogPages);
  const paginatedLogs = logs.slice(
    (clampedLogPage - 1) * LOGS_PER_PAGE,
    clampedLogPage * LOGS_PER_PAGE,
  );

  // One collapsible endpoint. Native <details>/<summary> rather than useState:
  // it starts closed on its own, toggles on click AND on Enter/Space, is
  // announced correctly by screen readers, and survives Ctrl+F — the browser
  // opens a closed <details> when the match is inside it. None of that has to
  // be written or tested here.
  //
  // Closed, the rows form the index: method, path, and what the endpoint does.
  const renderEndpoint = (ep: Endpoint) => (
    <details key={ep.method + ep.path} className="group border border-[#eee] rounded-[10px] mb-2.5 bg-[#fdfdfc] last:mb-0">
      <summary className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none rounded-[10px] list-none hover:bg-[#f5f4f1] [&::-webkit-details-marker]:hidden">
        {/* Fixed width so the paths line up in a column rather than stepping
            right by method length — wide enough for DELETE, the longest. */}
        <span className={`inline-block shrink-0 w-[60px] text-center px-1.5 py-[3px] rounded-[10px] text-[10.5px] font-bold tracking-[0.3px] ${methodClass(ep.method)}`}>
          {ep.method}
        </span>
        <code className="text-[13px] font-bold text-[#222] truncate">{ep.path}</code>
        {/* Hidden on narrow screens, where the path alone already fills the row. */}
        {ep.summary && (
          <span className="text-[12.5px] text-[#898781] truncate ml-auto pl-2 max-[640px]:hidden">{ep.summary}</span>
        )}
        <span
          aria-hidden="true"
          className={`shrink-0 text-[11px] text-[#898781] transition-transform duration-150 group-open:rotate-90 ${ep.summary ? 'max-[640px]:ml-auto' : 'ml-auto'}`}
        >
          ▶
        </span>
      </summary>

      <div className="px-4 pt-3 pb-4 border-t border-[#f0efec]">
        <p className="text-xs text-[#898781] mt-0 mx-0 mb-2">{ep.auth}</p>
        <p className="text-[13.5px] text-[#444] leading-[1.55] mt-0 mx-0 mb-2.5">{ep.description}</p>
        {ep.params && (
          <ul className="mt-0 mx-0 mb-3 pl-[18px] text-[#555] text-[13px] leading-[1.65]">
            {ep.params.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="mb-2.5 last:mb-0">
          <div className="flex justify-between items-center mb-1.5 [&_span]:text-[11px] [&_span]:text-[#898781] [&_span]:uppercase [&_span]:tracking-[0.4px] [&_span]:font-bold">
            <span>Example request</span>
            <button className="border border-[#ddd] bg-white rounded-md px-2.5 py-[3px] text-xs font-semibold text-[#444] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]" type="button" onClick={() => copyText(ep.request)}>
              {t('devApi.copy')}
            </button>
          </div>
          <pre className="m-0 px-3.5 py-3 bg-[#1c1c1a] text-[#e8e6df] rounded-lg overflow-x-auto text-[12.5px] leading-[1.6]">{ep.request}</pre>
        </div>
        {ep.response && (
          <div className="mb-2.5 last:mb-0">
            <div className="flex justify-between items-center mb-1.5 [&_span]:text-[11px] [&_span]:text-[#898781] [&_span]:uppercase [&_span]:tracking-[0.4px] [&_span]:font-bold">
              <span>Example response</span>
            </div>
            <pre className="m-0 px-3.5 py-3 bg-[#1c1c1a] text-[#e8e6df] rounded-lg overflow-x-auto text-[12.5px] leading-[1.6]">{ep.response}</pre>
          </div>
        )}
      </div>
    </details>
  );

  return (
    <main className="min-h-screen bg-[#f0f0f0]">
      <Header />

      <div className="max-w-[1180px] mx-auto pt-7 px-8 pb-16 max-[640px]:pt-5 max-[640px]:px-4 max-[640px]:pb-12">
        {/* This page is not part of the listing workflow, so it carries neither
            the My Shop tab row nor Post an Ad — ShopHeader titles it instead. */}
        <ShopHeader current="developer-api" />

        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] overflow-hidden">
          <div className="flex gap-2.5 px-5 py-4 border-b border-[#eee] flex-wrap">
            <button
              className={`px-5 py-2 rounded-[20px] border text-sm cursor-pointer transition-all duration-150 ${activeTab === 'keys' ? 'bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold' : 'bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]'}`}
              onClick={() => setActiveTab('keys')}
              type="button"
            >
              {t('devApi.tabKeys')}
            </button>
            <button
              className={`px-5 py-2 rounded-[20px] border text-sm cursor-pointer transition-all duration-150 ${activeTab === 'docs' ? 'bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold' : 'bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]'}`}
              onClick={() => setActiveTab('docs')}
              type="button"
            >
              {t('devApi.tabDocs')}
            </button>
            <button
              className={`px-5 py-2 rounded-[20px] border text-sm cursor-pointer transition-all duration-150 ${activeTab === 'logs' ? 'bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold' : 'bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]'}`}
              onClick={() => setActiveTab('logs')}
              type="button"
            >
              {t('devApi.tabLogs')}
            </button>
          </div>

          <div className="p-5">
            {activeTab === 'keys' && (
              <>
                <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">🔐 Create a secret key</h2>
                  <p className="text-[#898781] text-[13.5px] leading-[1.55] mt-0 mx-0 mb-3.5">
                    The key is shown once, right after creation. Store it somewhere safe —
                    only a hash is kept on our side, so it can never be displayed again.
                  </p>
                  <form className="flex gap-2.5 flex-wrap" onSubmit={handleCreateKey}>
                    <input
                      className="flex-[1_1_320px] min-w-[220px] border border-[#ddd] rounded-lg px-3 py-[9px] text-sm bg-white text-[#333] focus:outline-none focus:border-[#888]"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="Key name, e.g. My Inventory Bot"
                    />
                    <button className="border-none rounded-[20px] bg-[#111] text-white text-sm font-semibold px-5 py-[9px] cursor-pointer transition-colors duration-150 hover:bg-[#333] disabled:opacity-55 disabled:cursor-not-allowed" type="submit" disabled={creating}>
                      {creating ? t('devApi.creating') : t('devApi.createKey')}
                    </button>
                  </form>

                  {generatedKey && (
                    <div className="flex justify-between items-center gap-3.5 px-4 py-3.5 mt-4 rounded-[10px] bg-[#fff8e1] border border-[#ffe082] max-[640px]:flex-col max-[640px]:items-start">
                      <div className="min-w-0">
                        <p className="text-[#8d6e00] text-[13px] font-bold mt-0 mx-0 mb-1.5">
                          ⚠ Copy this key now — it will not be shown again.
                        </p>
                        <code className="block break-all text-[13px] text-[#111]">{generatedKey}</code>
                      </div>
                      <button
                        className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]"
                        type="button"
                        onClick={() => copyText(generatedKey)}
                      >
                        {t('devApi.copyKey')}
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <div className="flex justify-between items-center gap-3 mt-0 mx-0 mb-3 max-[640px]:flex-wrap">
                    <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-0">🗝 Your keys</h2>
                    <button className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]" type="button" onClick={refreshKeys}>
                      {t('devApi.refresh')}
                    </button>
                  </div>
                  {loadingKeys ? (
                    <p className="text-[#888] text-[15px] m-0 py-5">Loading keys…</p>
                  ) : keys.length === 0 ? (
                    <p className="text-[#888] text-[15px] m-0 py-5">
                      No API keys yet — create your first one above.
                    </p>
                  ) : (
                    <div className="w-full overflow-x-auto">
                      <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Rate limit</th>
                            <th>Created</th>
                            <th>Expires</th>
                            <th>Last used</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {keys.map((key, index) => (
                            <tr key={key.id}>
                              {/* Row number, not key.id — the database id is
                                  global across all users, so a user's first key
                                  could read "#7". The list arrives oldest-first,
                                  so this counts 1, 2, 3… in creation order.
                                  Revocation still uses key.id below. */}
                              <td className="text-[#898781] text-[13px]">{index + 1}</td>
                              <td className="font-semibold text-[#222]">{key.name}</td>
                              <td>
                                <span
                                  className={`inline-block px-3 py-[3px] rounded-xl text-xs font-bold ${
                                    !key.isActive
                                      ? 'bg-[#fee2e2] text-[#991b1b]'
                                      : key.isExpired
                                        ? 'bg-[#fef3c7] text-[#92400e]'
                                        : 'bg-[#e6f4ea] text-[#1a7f37]'
                                  }`}
                                >
                                  {!key.isActive ? 'Revoked' : key.isExpired ? 'Expired' : 'Active'}
                                </span>
                              </td>
                              <td>{key.rateLimit}/min</td>
                              <td>{formatDateTime(key.createdAt)}</td>
                              <td className={key.isExpired ? 'text-[#92400e] font-semibold' : ''}>
                                {formatDateTime(key.expiresAt)}
                              </td>
                              <td>{formatDateTime(key.lastUsedAt)}</td>
                              <td>
                                <button
                                  className="border border-[#f3c2c2] bg-[#fff5f5] rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[#b42318] cursor-pointer transition-all duration-150 hover:border-[#d92d20] disabled:opacity-50 disabled:cursor-not-allowed"
                                  type="button"
                                  disabled={!key.isActive || revokingId === key.id}
                                  onClick={() => handleRevoke(key.id)}
                                >
                                  {revokingId === key.id ? t('devApi.revoking') : t('devApi.revoke')}
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
                <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">🚀 {t('devApi.docsQuickstart')}</h2>
                  <ol className="mt-0 mx-0 mb-4 pl-5 text-[#444] text-sm leading-[1.7] [&_li]:mb-1.5">
                    <li>
                      <strong>{t('devApi.docsStep1Lead')}</strong> {t('devApi.docsStep1Rest')}
                    </li>
                    <li>
                      <strong>{t('devApi.docsStep2Lead')}</strong> {t('devApi.docsStep2Rest')}{' '}
                      <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">X-API-Key: sk_live_...</code>
                    </li>
                    <li>
                      <strong>{t('devApi.docsStep3Lead')}</strong> {t('devApi.docsStep3Rest')}
                    </li>
                  </ol>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
                    <div className="bg-[#fafaf8] border border-[#eee] rounded-lg px-3.5 py-3">
                      <p className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mt-0 mx-0 mb-1.5">{t('devApi.docsBaseUrl')}</p>
                      <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">https://localhost/api/public/v1</code>
                    </div>
                    <div className="bg-[#fafaf8] border border-[#eee] rounded-lg px-3.5 py-3">
                      <p className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mt-0 mx-0 mb-1.5">{t('devApi.docsRateLimit')}</p>
                      <p className="text-[13px] text-[#444] m-0 leading-[1.5]">
                        {t('devApi.docsRateLimitBody')}
                      </p>
                    </div>
                    <div className="bg-[#fafaf8] border border-[#eee] rounded-lg px-3.5 py-3">
                      <p className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mt-0 mx-0 mb-1.5">{t('devApi.docsKeyLifetime')}</p>
                      <p className="text-[13px] text-[#444] m-0 leading-[1.5]">
                        <strong>{t('devApi.docsKeyLifetimeLead')}</strong>{' '}
                        {t('devApi.docsKeyLifetimeRest')}
                      </p>
                    </div>
                    <div className="bg-[#fafaf8] border border-[#eee] rounded-lg px-3.5 py-3">
                      <p className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mt-0 mx-0 mb-1.5">{t('devApi.docsAuditLog')}</p>
                      <p className="text-[13px] text-[#444] m-0 leading-[1.5]">
                        {t('devApi.docsAuditLogBody')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">🌐 Public API — products</h2>
                  <p className="text-[#898781] text-[13.5px] leading-[1.55] mt-0 mx-0 mb-3.5">
                    Authenticate with <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">X-API-Key</code>. Write
                    operations act as the key&apos;s owner: you can only modify your own listings.
                  </p>

                  {publicEndpoints.map(renderEndpoint)}
                </div>

                {/* Key management API docs — hidden: the Keys tab GUI above already
                    creates / lists / revokes keys, so this section duplicated it.
                    The endpoints remain live; see the comment on managementEndpoints.
                <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">🛠 Key management API</h2>
                  <p className="text-[#898781] text-[13.5px] leading-[1.55] mt-0 mx-0 mb-3.5">
                    These endpoints use your normal login session (
                    <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">Authorization: Bearer &lt;JWT&gt;</code>
                    ) — the same calls this page makes for you.
                  </p>

                  <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] px-4 py-3.5 mb-4">
                    <p className="text-[13.5px] font-bold text-[#1c5cab] mt-0 mx-0 mb-2">🔑 How to get a JWT to call these directly</p>
                    <ol className="mt-0 mx-0 mb-3 pl-[18px] text-[#334155] text-[13px] leading-[1.7] [&_li]:mb-1">
                      <li>
                        Log in via the API — <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">POST /api/v1/auth/login</code>{' '}
                        with your email/password; the response&apos;s <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">token</code> field is your JWT.
                      </li>
                      <li>
                        <strong>Or, since you&apos;re already logged in here:</strong> open DevTools
                        (F12) → Console tab → run{' '}
                        <code className="bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]">localStorage.getItem(&apos;token&apos;)</code>.
                      </li>
                      <li>
                        <strong>Or</strong> click the button below to copy your current session&apos;s
                        JWT straight to your clipboard.
                      </li>
                    </ol>
                    <button
                      className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]"
                      type="button"
                      onClick={() => (token ? copyText(token) : showToast('No active session token found', 'error'))}
                    >
                      ⧉ Copy my current JWT
                    </button>
                  </div>

                  {managementEndpoints.map(renderEndpoint)}
                </div>
                */}

                <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">📟 Status codes</h2>
                  <div className="w-full overflow-x-auto">
                    <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Meaning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statusCodes.map(([code, meaning]) => (
                          <tr key={code}>
                            <td className="font-semibold text-[#222]">{code}</td>
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
              <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                <div className="flex justify-between items-center gap-3 mt-0 mx-0 mb-3 max-[640px]:flex-wrap">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-0">📋 Request log</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label htmlFor="log-key-filter" className="sr-only">
                      {t('devApi.filterByKey')}
                    </label>
                    <select
                      id="log-key-filter"
                      className="border border-[#ccc] bg-white rounded-lg px-3 py-[7px] text-[13px] text-[#333] cursor-pointer outline-none focus:border-[#c2185b]"
                      value={logKeyFilter}
                      onChange={(event) => {
                        setLogKeyFilter(event.target.value);
                        setLogPage(1);
                      }}
                    >
                      <option value="">{t('devApi.allKeys')}</option>
                      {keys.map((key) => (
                        <option key={key.id} value={String(key.id)}>
                          {key.name}
                          {key.isActive ? '' : ` (${t('devApi.revoked')})`}
                        </option>
                      ))}
                    </select>
                    <button className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]" type="button" onClick={() => refreshLogs(logKeyFilter ? Number(logKeyFilter) : null)}>
                      {t('devApi.refresh')}
                    </button>
                  </div>
                </div>
                <p className="text-[#898781] text-[13.5px] leading-[1.55] mt-0 mx-0 mb-3.5">
                  Every call made with your API keys, newest first — review this for
                  unfamiliar IPs or unexpected activity, and revoke a key if it looks
                  compromised.
                </p>

                {loadingLogs ? (
                  <p className="text-[#888] text-[15px] m-0 py-5">Loading logs…</p>
                ) : logs.length === 0 ? (
                  <p className="text-[#888] text-[15px] m-0 py-5">
                    No requests logged yet — calls appear here as soon as a key is used.
                  </p>
                ) : (
                  <>
                    <div className="w-full overflow-x-auto">
                      <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
                        <thead>
                          <tr>
                            <th>Method</th>
                            <th>Path</th>
                            <th>Status</th>
                            <th>Outcome</th>
                            <th>Key</th>
                            <th>IP</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedLogs.map((log) => (
                            <tr key={log.id}>
                              <td>
                                <span className={`inline-block px-2.5 py-[3px] rounded-[10px] text-[11.5px] font-bold tracking-[0.3px] ${methodClass(log.method)}`}>
                                  {log.method}
                                </span>
                              </td>
                              <td className="font-mono text-[13px]">{log.path}</td>
                              <td>
                                <span className={`inline-block px-2.5 py-0.5 rounded-[10px] text-xs font-bold ${logStatusClass(log.status)}`}>
                                  {log.status}
                                </span>
                              </td>
                              <td>
                                <span className={`inline-block px-2.5 py-0.5 rounded-[10px] text-[11.5px] font-bold ${outcomeClass(log.outcome)}`}>
                                  {OUTCOME_LABELS[log.outcome] ?? log.outcome}
                                </span>
                              </td>
                              <td>{log.keyName}</td>
                              <td className="text-[#898781] text-[13px]" title={log.userAgent || undefined}>
                                {log.ipAddress || '—'}
                              </td>
                              <td className="text-[#898781] text-[13px]">{formatDateTime(log.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {totalLogPages > 1 && (
                      <div className="flex justify-center items-center gap-1.5 pt-4 pb-1">
                        <button
                          className="w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]"
                          type="button"
                          aria-label={t('devApi.prevPage')}
                          disabled={clampedLogPage === 1}
                          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                        >
                          ‹
                        </button>
                        {Array.from({ length: totalLogPages }, (_, i) => (
                          <button
                            key={i + 1}
                            className={`w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${clampedLogPage === i + 1 ? 'bg-[#2563eb] text-white border-[#2563eb]' : 'bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]'}`}
                            type="button"
                            aria-label={t('devApi.goToPage', { page: i + 1 })}
                            onClick={() => setLogPage(i + 1)}
                          >
                            {i + 1}
                          </button>
                        ))}
                        <button
                          className="w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]"
                          type="button"
                          aria-label={t('devApi.nextPage')}
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
