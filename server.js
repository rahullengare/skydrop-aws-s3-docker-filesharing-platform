require('dotenv').config();

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

const connectDB = require('./config/db');
const { generateDownloadUrl } = require('./config/s3');
const { createRateLimiter } = require('./middleware/rateLimit');
const File = require('./models/File');
const User = require('./models/User');
const authRoutes = require('./routes/authRoutes');
const fileRoutes = require('./routes/fileRoutes');
const { expiredPage, landingPage } = require('./views/sharePages');

const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET', 'AWS_REGION', 'S3_BUCKET_NAME'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

// TRUST_PROXY: "false" (default), a hop count such as "1", or "true".
// Only trust proxy headers when a real proxy/load balancer sits in front of Node,
// otherwise clients could spoof their IP and dodge the rate limiters.
function parseTrustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.disable('x-powered-by');

app.use(express.json({ limit: '256kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Health check (used by Docker / load balancers)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// API: never cache, and apply a general rate limit
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(
  '/api',
  createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 600,
    message: 'Too many requests. Slow down and try again shortly.',
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);

// ---------- Public share links ----------
const shareLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Try again in a minute.',
});
const formParser = express.urlencoded({ extended: false, limit: '2kb' });

// Wrong-password tracking per link (not per IP), so a 4-digit PIN cannot be brute-forced
// by rotating IP addresses. After 5 wrong tries the link is locked for 15 minutes.
const MAX_WRONG_TRIES = 5;
const LOCK_MS = 15 * 60 * 1000;
const wrongTries = new Map();

function isLocked(token) {
  const entry = wrongTries.get(token);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    wrongTries.delete(token);
    return false;
  }
  return entry.count >= MAX_WRONG_TRIES;
}

function recordWrongTry(token) {
  const now = Date.now();
  let entry = wrongTries.get(token);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + LOCK_MS };
    wrongTries.set(token, entry);
  }
  entry.count += 1;
  return MAX_WRONG_TRIES - entry.count;
}

const sweep = setInterval(() => {
  const now = Date.now();
  wrongTries.forEach((entry, key) => {
    if (entry.resetAt <= now) wrongTries.delete(key);
  });
}, LOCK_MS);
if (sweep.unref) sweep.unref();

const TOKEN_REGEX = /^[a-f0-9]{10}$/i;

function findActiveShare(token) {
  return File.findOne({
    shareToken: token.toLowerCase(),
    shareExpiresAt: { $gt: new Date() },
  }).select('+sharePasswordHash');
}

async function ownerName(file) {
  try {
    const owner = await User.findById(file.ownerId).select('name').lean();
    if (owner && owner.name) return owner.name;
  } catch (err) {
    console.error('Owner lookup warning:', err.message);
  }
  return 'A SkyDrop user';
}

function sendPage(res, status, html) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).type('html').send(html);
}

async function renderLanding(res, file, token, extra) {
  return sendPage(
    res,
    (extra && extra.status) || 200,
    landingPage({
      token,
      fileName: file.originalName,
      sizeBytes: file.sizeBytes,
      sharedBy: await ownerName(file),
      expiresAt: file.shareExpiresAt,
      protectedFile: Boolean(file.shareProtected && file.sharePasswordHash),
      error: extra && extra.error,
      locked: extra && extra.locked,
    })
  );
}

// Counts the download and sends the browser to a 60-second pre-signed S3 URL.
async function releaseFile(res, file, redirectStatus) {
  const counted = await File.updateOne(
    { _id: file._id, shareExpiresAt: { $gt: new Date() } },
    { $inc: { downloadCount: 1 } }
  );
  if (counted.matchedCount === 0) {
    return sendPage(res, 410, expiredPage());
  }
  const downloadUrl = await generateDownloadUrl(file.s3Key, file.originalName);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(redirectStatus, downloadUrl);
}

// Landing page (and the download for links without a password)
app.get('/share/:token', shareLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!TOKEN_REGEX.test(token)) {
      return sendPage(res, 410, expiredPage());
    }

    const file = await findActiveShare(token);
    if (!file) {
      return sendPage(res, 410, expiredPage());
    }

    const isProtected = Boolean(file.shareProtected && file.sharePasswordHash);

    if (req.query.download === '1') {
      if (isProtected) return res.redirect(`/share/${token}`);
      return await releaseFile(res, file, 302);
    }

    return await renderLanding(res, file, token, { locked: isProtected && isLocked(token.toLowerCase()) });
  } catch (err) {
    return next(err);
  }
});

// Unlock a password-protected link
app.post('/share/:token/download', shareLimiter, formParser, async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!TOKEN_REGEX.test(token)) {
      return sendPage(res, 410, expiredPage());
    }
    const key = token.toLowerCase();

    const file = await findActiveShare(token);
    if (!file) {
      return sendPage(res, 410, expiredPage());
    }

    if (!(file.shareProtected && file.sharePasswordHash)) {
      return res.redirect(303, `/share/${token}?download=1`);
    }

    if (isLocked(key)) {
      return await renderLanding(res, file, token, {
        status: 429,
        locked: true,
        error: 'Too many wrong tries. This link is locked for 15 minutes.',
      });
    }

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const ok = password.length > 0 && password.length <= 64 && (await bcrypt.compare(password, file.sharePasswordHash));

    if (!ok) {
      const left = recordWrongTry(key);
      return await renderLanding(res, file, token, {
        status: 401,
        locked: left <= 0,
        error:
          left > 0
            ? `Wrong PIN or password. ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'Too many wrong tries. This link is locked for 15 minutes.',
      });
    }

    wrongTries.delete(key);
    return await releaseFile(res, file, 303);
  } catch (err) {
    return next(err);
  }
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));

// Unknown API routes -> JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

// Anything else -> back to the login page
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  if (req.originalUrl.startsWith('/api')) {
    return res.status(500).json({ message: 'Internal server error' });
  }
  return res.status(500).type('text/plain').send('Internal server error');
});

(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`SkyDrop running on port ${PORT}`);
  });
})();
