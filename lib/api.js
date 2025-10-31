import { getAccessToken, refreshAccessToken } from './auth.js';

export async function apiCall(url, { method = 'GET', headers = {}, body = undefined } = {}) {
  let token = await getAccessToken();
  const doFetch = async () => fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body });
  let res = await doFetch();
  if (res.status === 401) {
    try { await refreshAccessToken(); token = await getAccessToken(); } catch {}
    res = await doFetch();
  }
  return res;
}

