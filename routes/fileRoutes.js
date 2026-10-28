const crypto = require('crypto');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');

const User = require('../models/User');
const File = require('../models/File');
const authMiddleware = require('../middleware/authMiddleware');
const {
  generateUploadUrl,
  generateDownloadUrl,
  deleteS3Object,
  headS3Object,
} = require('../config/s3');

const router = express.Router();

// Every route in this file requires a valid JWT.
router.use(authMiddleware);

// SkyDrop has no storage limit. The only cap is S3's own limit for one pre-signed PUT (5 GB).
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;

// Custom share expiry: 1 minute up to 30 days.
const MIN_EXPIRY_MINUTES = 1;
const MAX_EXPIRY_MINUTES = 30 * 24 * 60;
const LEGACY_DURATIONS = { '15m': 15, '1h': 60, '24h': 24 * 60 };

function sanitizeFileName(name) {
  const base = path.basename(String(name));
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .slice(-100);
  return cleaned || 'file';
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// Public address of the app. Set APP_URL in .env so share links and QR codes work on phones.
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function serializeFile(file, req) {
  return {
    id: file._id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    shareToken: file.shareToken,
    shareExpiresAt: file.shareExpiresAt,
    shareProtected: Boolean(file.shareProtected),
    shareUrl: file.shareToken ? `${baseUrl(req)}/share/${file.shareToken}` : null,
    downloadCount: file.downloadCount,
    uploadedAt: file.uploadedAt,
  };
}

function hasActiveShare(file) {
  return Boolean(file.shareToken && file.shareExpiresAt && file.shareExpiresAt.getTime() > Date.now());
}

async function findOwnedFile(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ message: 'File not found' });
    return null;
  }
  const file = await File.findOne({ _id: id, ownerId: req.user.id });
  if (!file) {
    res.status(404).json({ message: 'File not found' });
    return null;
  }
  return file;
}

async function generateUniqueShareToken() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = crypto.randomBytes(5).toString('hex'); // 10 hex characters
    // eslint-disable-next-line no-await-in-loop
    const taken = await File.exists({ shareToken: token });
    if (!taken) return token;
  }
  throw new Error('Could not generate a unique share token');
}

// GET /api/files
router.get('/', async (req, res, next) => {
  try {
    const [files, user] = await Promise.all([
      File.find({ ownerId: req.user.id }).sort({ uploadedAt: -1 }),
      User.findById(req.user.id).select('storageUsedBytes'),
    ]);

    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' });
    }

    return res.json({
      files: files.map((f) => serializeFile(f, req)),
      storage: { storageUsedBytes: user.storageUsedBytes },
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/files/upload-url
router.post('/upload-url', async (req, res, next) => {
  try {
    const { originalName, sizeBytes } = req.body;
    const mimeType =
      typeof req.body.mimeType === 'string' && req.body.mimeType.trim()
        ? req.body.mimeType.trim()
        : 'application/octet-stream';

    if (typeof originalName !== 'string' || !originalName.trim() || originalName.length > 255) {
      return res.status(400).json({ message: 'A valid file name is required' });
    }
    if (!isPositiveInteger(sizeBytes)) {
      return res.status(400).json({ message: 'sizeBytes must be a positive integer' });
    }
    if (sizeBytes > MAX_FILE_BYTES) {
      return res.status(400).json({ message: 'A single file can be up to 5 GB' });
    }

    const s3Key = `uploads/${req.user.id}/${Date.now()}-${sanitizeFileName(originalName)}`;
    const uploadUrl = await generateUploadUrl(s3Key, mimeType);

    return res.json({ uploadUrl, s3Key });
  } catch (err) {
    return next(err);
  }
});

// POST /api/files/confirm
router.post('/confirm', async (req, res, next) => {
  try {
    const { originalName, s3Key } = req.body;
    const mimeType =
      typeof req.body.mimeType === 'string' && req.body.mimeType.trim()
        ? req.body.mimeType.trim()
        : 'application/octet-stream';

    if (typeof originalName !== 'string' || !originalName.trim() || originalName.length > 255) {
      return res.status(400).json({ message: 'A valid file name is required' });
    }
    if (typeof s3Key !== 'string' || !s3Key.startsWith(`uploads/${req.user.id}/`)) {
      return res.status(400).json({ message: 'Invalid S3 key' });
    }

    // Trust S3, not the client: read the real size of the uploaded object.
    let head;
    try {
      head = await headS3Object(s3Key);
    } catch (err) {
      return res.status(400).json({ message: 'Upload not found in S3. Upload the file before confirming.' });
    }
    const actualSize = head.ContentLength;

    if (!isPositiveInteger(actualSize)) {
      await deleteS3Object(s3Key).catch(() => {});
      return res.status(400).json({ message: 'Uploaded file is empty' });
    }

    let file;
    try {
      file = await File.create({
        ownerId: req.user.id,
        originalName: originalName.trim(),
        s3Key,
        mimeType,
        sizeBytes: actualSize,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ message: 'This upload was already confirmed' });
      }
      throw err;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { storageUsedBytes: actualSize } },
      { new: true }
    );

    return res.status(201).json({
      file: serializeFile(file, req),
      storage: { storageUsedBytes: updatedUser ? updatedUser.storageUsedBytes : actualSize },
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/files/:id/download
router.get('/:id/download', async (req, res, next) => {
  try {
    const file = await findOwnedFile(req, res);
    if (!file) return undefined;

    const downloadUrl = await generateDownloadUrl(file.s3Key, file.originalName);
    return res.json({ downloadUrl });
  } catch (err) {
    return next(err);
  }
});

// POST /api/files/:id/share
// Body: { expiresInMinutes: 1..43200, password?: "4-64 characters" }
// (the older { duration: "15m" | "1h" | "24h" } is still accepted)
router.post('/:id/share', async (req, res, next) => {
  try {
    let minutes;
    if (req.body.expiresInMinutes !== undefined) {
      minutes = Number(req.body.expiresInMinutes);
    } else if (Object.prototype.hasOwnProperty.call(LEGACY_DURATIONS, req.body.duration)) {
      minutes = LEGACY_DURATIONS[req.body.duration];
    }

    if (!Number.isInteger(minutes) || minutes < MIN_EXPIRY_MINUTES || minutes > MAX_EXPIRY_MINUTES) {
      return res.status(400).json({ message: 'Choose an expiry between 1 minute and 30 days' });
    }

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password && (password.length < 4 || password.length > 64)) {
      return res.status(400).json({ message: 'The PIN or password must be 4 to 64 characters' });
    }

    const file = await findOwnedFile(req, res);
    if (!file) return undefined;

    file.shareToken = await generateUniqueShareToken();
    file.shareExpiresAt = new Date(Date.now() + minutes * 60 * 1000);
    file.shareProtected = Boolean(password);
    file.sharePasswordHash = password ? await bcrypt.hash(password, 10) : null;
    await file.save();

    return res.json({
      shareUrl: `${baseUrl(req)}/share/${file.shareToken}`,
      shareToken: file.shareToken,
      expiresAt: file.shareExpiresAt.toISOString(),
      protected: file.shareProtected,
    });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/files/:id/share  -> stop sharing right now
router.delete('/:id/share', async (req, res, next) => {
  try {
    const file = await findOwnedFile(req, res);
    if (!file) return undefined;

    file.shareToken = null;
    file.shareExpiresAt = null;
    file.shareProtected = false;
    file.sharePasswordHash = null;
    await file.save();

    return res.json({ message: 'Sharing stopped' });
  } catch (err) {
    return next(err);
  }
});

// GET /api/files/:id/share-qr  -> QR code (PNG data URL) for the current share link
router.get('/:id/share-qr', async (req, res, next) => {
  try {
    const file = await findOwnedFile(req, res);
    if (!file) return undefined;

    if (!hasActiveShare(file)) {
      return res.status(400).json({ message: 'This file has no active share link' });
    }

    const shareUrl = `${baseUrl(req)}/share/${file.shareToken}`;
    const qr = await QRCode.toDataURL(shareUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#0B1F3A', light: '#FFFFFF' },
    });

    return res.json({ qr, shareUrl });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/files/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const file = await findOwnedFile(req, res);
    if (!file) return undefined;

    // Delete from S3 first. If this fails we keep the DB record so nothing is orphaned.
    await deleteS3Object(file.s3Key);
    await File.deleteOne({ _id: file._id });

    // Subtract the size, clamped at 0 (aggregation-pipeline update keeps it atomic).
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      [
        {
          $set: {
            storageUsedBytes: {
              $max: [0, { $subtract: ['$storageUsedBytes', file.sizeBytes] }],
            },
          },
        },
      ],
      { new: true }
    );

    return res.json({
      message: 'File deleted',
      storage: updatedUser ? { storageUsedBytes: updatedUser.storageUsedBytes } : null,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
