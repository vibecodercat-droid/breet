export async function save(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function load(key, defaultValue = undefined) {
  const obj = await chrome.storage.local.get(key);
  return key in obj ? obj[key] : defaultValue;
}

export async function merge(key, partial) {
  const current = await load(key, {});
  const next = { ...(current || {}), ...(partial || {}) };
  await save(key, next);
  return next;
}

export function observe(key, cb) {
  function handler(changes, area) {
    if (area !== 'local') return;
    if (key in changes) cb(changes[key].newValue, changes[key].oldValue);
  }
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

