/**
 * Per-key sliding-window rate limiter.
 *
 * Tracks attempt timestamps for each key (usually an IP address) and
 * enforces a cap of N attempts per W seconds. Entirely in-memory; counts
 * reset on process restart.
 *
 * Memory is bounded implicitly: old entries fall out of the window each
 * time a key is hit, and sweep() can be called periodically to prune.
 *
 *   const rl = createRateLimiter({ max: 10, windowSeconds: 60 });
 *   if (!rl.allow(ip)) return res.json({ error: 'too many requests' }, 429);
 */
export function createRateLimiter({ max, windowSeconds }) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError('max must be a positive integer');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new TypeError('windowSeconds must be a positive integer');
  }

  const windowMs = windowSeconds * 1000;
  /** @type {Map<string, number[]>} key → ordered list of timestamps (ms) */
  const hits = new Map();

  function prune(list, now) {
    const cutoff = now - windowMs;
    // Entries are chronological; drop anything older than the cutoff.
    let i = 0;
    while (i < list.length && list[i] < cutoff) i++;
    return i === 0 ? list : list.slice(i);
  }

  return {
    /**
     * Returns true if the attempt is allowed (and records it).
     * Returns false if the key has hit its limit for the current window.
     */
    allow(key) {
      const now = Date.now();
      const existing = hits.get(key);
      const live = existing ? prune(existing, now) : [];
      if (live.length >= max) {
        if (live !== existing) hits.set(key, live);
        return false;
      }
      live.push(now);
      hits.set(key, live);
      return true;
    },

    /**
     * Number of attempts remaining in the current window for this key.
     * Informational — useful for response headers.
     */
    remaining(key) {
      const list = hits.get(key);
      if (!list) return max;
      const live = prune(list, Date.now());
      return Math.max(0, max - live.length);
    },

    /**
     * Clear rate-limit state for a key (e.g., after a successful login
     * the user's IP should no longer count previous failures).
     */
    reset(key) {
      hits.delete(key);
    },

    /** Prune every key. Call periodically if the key-space is large. */
    sweep() {
      const now = Date.now();
      for (const [key, list] of hits) {
        const live = prune(list, now);
        if (live.length === 0) hits.delete(key);
        else if (live !== list) hits.set(key, live);
      }
    },

    /** Inspect current tracked key count — useful in tests. */
    size() { return hits.size; },
  };
}
