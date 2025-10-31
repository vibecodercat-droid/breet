import { apiCall } from './api.js';
import { load as loadLocal, save as saveLocal } from './storage.js';

const KEYS = {
  PROFILE: 'userProfile',
  BREAKS: 'breakHistory',
  TODOS: 'todos',
};

export async function syncProfile() {
  const profile = await loadLocal(KEYS.PROFILE, null);
  if (!profile) return;
  try {
    await apiCall('https://api.example.com/api/profiles', { method: 'PUT', body: JSON.stringify(profile) });
  } catch {}
}

export async function syncBreakHistory() {
  const items = await loadLocal(KEYS.BREAKS, []);
  if (!items?.length) return;
  try {
    await apiCall('https://api.example.com/api/break-history', { method: 'POST', body: JSON.stringify(items) });
  } catch {}
}

export async function syncTodos() {
  const todos = await loadLocal(KEYS.TODOS, []);
  try {
    await apiCall('https://api.example.com/api/todos', { method: 'PUT', body: JSON.stringify(todos) });
  } catch {}
}

export async function pullProfile() {
  try {
    const res = await apiCall('https://api.example.com/api/profiles');
    if (res.ok) { const data = await res.json(); await saveLocal(KEYS.PROFILE, data); }
  } catch {}
}

