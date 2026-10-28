const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  // Total bytes stored. Only used for display: SkyDrop has no storage limit.
  storageUsedBytes: {
    type: Number,
    default: 0,
  },
  // Small square JPEG (data URL), resized in the browser to 256x256.
  avatar: {
    type: String,
    default: null,
  },
  // Incremented to revoke every existing login token for this user.
  tokenVersion: {
    type: Number,
    default: 0,
  },
  // SHA-256 hash of the password-reset token (the raw token only exists in the email link).
  resetPasswordTokenHash: {
    type: String,
    default: null,
    select: false,
    index: true,
  },
  resetPasswordExpires: {
    type: Date,
    default: null,
    select: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('User', userSchema);
