const AUTH_KEY = 'authState';
const API_BASE = 'https://api.example.com'; // TODO: replace with real backend

export function getApiBase() {
  return API_BASE;
}

export async function loadAuth() {
  const { authState = null } = await chrome.storage.local.get(AUTH_KEY);
  return authState;
}

export async function saveAuth(state) {
  await chrome.storage.local.set({ [AUTH_KEY]: state });
}

export async function clearAuth() {
  await chrome.storage.local.remove(AUTH_KEY);
}

export async function isAuthenticated() {
  const a = await loadAuth();
  return !!(a && a.accessToken && (!a.tokenExpiresAt || a.tokenExpiresAt > Date.now()));
}

export async function getAccessToken() {
  const a = await loadAuth();
  if (!a) return null;
  if (a.tokenExpiresAt && a.tokenExpiresAt - Date.now() < 60_000) {
    try { await refreshAccessToken(); } catch {}
    const b = await loadAuth();
    return b?.accessToken || null;
  }
  return a.accessToken || null;
}

export async function loginWithGoogle() {
  // Launch OAuth2 flow via backend. Backend should redirect back with tokens in fragment/query
  const redirectUrl = chrome.identity.getRedirectURL('auth_cb');
  const url = `${API_BASE}/oauth2/authorization/google?redirect_uri=${encodeURIComponent(redirectUrl)}`;
  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectedTo) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(redirectedTo);
    });
  });
  const u = new URL(responseUrl);
  const params = new URLSearchParams(u.hash?.slice(1) || u.search?.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
  const email = params.get('email') || null;
  const userId = params.get('user_id') || null;
  if (!accessToken) throw new Error('No access_token in callback');
  await saveAuth({
    isLoggedIn: true,
    userId,
    email,
    accessToken,
    refreshToken,
    tokenExpiresAt: Date.now() + (isFinite(expiresIn) ? expiresIn * 1000 : 3600_000),
    lastSyncedAt: 0,
  });
  return true;
}

export async function refreshAccessToken() {
  const a = await loadAuth();
  if (!a?.refreshToken) throw new Error('No refresh token');
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: a.refreshToken })
  });
  if (!res.ok) throw new Error('Refresh failed');
  const data = await res.json();
  await saveAuth({ ...a, accessToken: data.accessToken, tokenExpiresAt: Date.now() + (data.expiresIn || 3600) * 1000 });
}

export async function logout() {
  try {
    const a = await loadAuth();
    if (a?.refreshToken) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: a.refreshToken })
      });
    }
  } catch {}
  await clearAuth();
  try { chrome.identity.clearAllCachedAuthTokens(() => {}); } catch {}
}

