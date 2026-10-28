const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const File = require('../models/File');
const authMiddleware = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../middleware/rateLimit');
const { sendPasswordResetEmail } = require('../config/mailer');
const { deleteS3Objects } = require('../config/s3');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVATAR_REGEX = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
const AVATAR_MAX_LENGTH = 150000;
const RESET_TOKEN_MINUTES = 30;

// Used so a login for an unknown email takes about as long as one for a real account.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 12);

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many attempts. Wait a few minutes and try again.',
});

function signToken(user) {
  return jwt.sign({ id: String(user._id), tv: user.tokenVersion || 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || null,
    storageUsedBytes: user.storageUsedBytes,
    createdAt: user.createdAt,
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function passwordError(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    return 'Password must be 8 to 72 characters long';
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must include at least one letter and one number';
  }
  return null;
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = cleanName(req.body.name);
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body.password;

    if (!name || name.length > 80) {
      return res.status(400).json({ message: 'Name is required (max 80 characters)' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    const pwError = passwordError(password);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      passwordHash,
      storageUsedBytes: 0,
    });

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }
    return next(err);
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' });
    }
    return res.json(publicUser(user));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/auth/profile  -> { name?, avatar? }  (avatar: JPEG data URL, or null to remove)
router.put('/profile', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' });
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const name = cleanName(req.body.name);
      if (!name || name.length > 80) {
        return res.status(400).json({ message: 'Name is required (max 80 characters)' });
      }
      user.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'avatar')) {
      const { avatar } = req.body;
      if (avatar === null) {
        user.avatar = null;
      } else if (typeof avatar === 'string' && avatar.length <= AVATAR_MAX_LENGTH && AVATAR_REGEX.test(avatar)) {
        user.avatar = avatar;
      } else {
        return res.status(400).json({ message: 'Profile photo must be a small JPEG image' });
      }
    }

    await user.save();
    return res.json(publicUser(user));
  } catch (err) {
    return next(err);
  }
});

// PUT /api/auth/password  -> { currentPassword, newPassword }
router.put('/password', authMiddleware, authLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' });
    }

    const valid = typeof currentPassword === 'string' && (await bcrypt.compare(currentPassword, user.passwordHash));
    if (!valid) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const pwError = passwordError(newPassword);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'Choose a password you have not used just now' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out every other device
    await user.save();

    // Return a fresh token so this device stays logged in.
    return res.json({ message: 'Password updated', token: signToken(user) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/logout-all  -> revokes every login token for this account
router.post('/logout-all', authMiddleware, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
    return res.json({ message: 'Logged out of all devices' });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/forgot-password  -> { email }
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  const generic = { message: 'If an account exists for that email, a reset link is on its way.' };
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_REGEX.test(email)) {
      return res.json(generic);
    }

    // In production the link must be built from a trusted APP_URL, never from the Host header.
    if (!process.env.APP_URL && process.env.NODE_ENV === 'production') {
      console.error('APP_URL is not set: password reset emails are disabled.');
      return res.json(generic);
    }

    const user = await User.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetPasswordTokenHash = sha256(token);
      user.resetPasswordExpires = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);
      await user.save();

      const baseUrl = process.env.APP_URL
        ? process.env.APP_URL.replace(/\/+$/, '')
        : `${req.protocol}://${req.get('host')}`;

      try {
        await sendPasswordResetEmail(user.email, user.name, `${baseUrl}/reset.html?token=${token}`);
      } catch (mailErr) {
        console.error('Could not send reset email:', mailErr.message);
      }
    }

    // Same answer whether or not the account exists, so emails cannot be probed.
    return res.json(generic);
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/reset-password  -> { token, password }
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const { password } = req.body;

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired' });
    }
    const pwError = passwordError(password);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }

    const user = await User.findOne({
      resetPasswordTokenHash: sha256(token),
      resetPasswordExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired' });
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    user.resetPasswordTokenHash = null; // single use
    user.resetPasswordExpires = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out every device
    await user.save();

    return res.json({ message: 'Password updated. Log in with your new password.' });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/auth/account  -> { password }
router.delete('/account', authMiddleware, authLimiter, async (req, res, next) => {
  try {
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' });
    }

    const valid = password && (await bcrypt.compare(password, user.passwordHash));
    if (!valid) {
      return res.status(400).json({ message: 'Password is incorrect' });
    }

    // Remove every stored file first. If S3 fails, nothing is deleted and the user can retry.
    const files = await File.find({ ownerId: user._id }).select('s3Key').lean();
    if (files.length > 0) {
      try {
        await deleteS3Objects(files.map((f) => f.s3Key));
      } catch (s3Err) {
        console.error('Account deletion: S3 cleanup failed:', s3Err.message);
        return res.status(502).json({ message: 'Could not remove your files from storage. Nothing was deleted. Try again.' });
      }
    }

    await File.deleteMany({ ownerId: user._id });
    await User.deleteOne({ _id: user._id });

    return res.json({ message: 'Account deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
