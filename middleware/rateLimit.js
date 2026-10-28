/**
 * Small in-memory rate limiter (per IP). Good for a single instance.
 * If you scale to several instances, swap this for a shared store such as Redis.
 */
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    hits.forEach((entry, key) => {
      if (entry.resetAt <= now) hits.delete(key);
    });
  }, windowMs);
  if (cleanup.unref) cleanup.unref();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || 'unknown';

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message: message || 'Too many requests. Try again later.' });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
