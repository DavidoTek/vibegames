// localStorage wrapper: storage can be disabled or full (private mode), so
// every access is guarded and falls back to the default.

const PREFIX = "enterados:";

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Ignore: progress just won't persist.
    }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* same */ }
  },
};
