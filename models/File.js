const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  // Format: uploads/${userId}/${Date.now()}-${sanitizedFileName}
  s3Key: {
    type: String,
    required: true,
    unique: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  sizeBytes: {
    type: Number,
    required: true,
  },
  shareToken: {
    type: String,
    default: null,
    index: true,
  },
  shareExpiresAt: {
    type: Date,
    default: null,
  },
  // true when the share link needs a PIN / password
  shareProtected: {
    type: Boolean,
    default: false,
  },
  // bcrypt hash of the PIN / password. Never sent to the browser.
  sharePasswordHash: {
    type: String,
    default: null,
    select: false,
  },
  downloadCount: {
    type: Number,
    default: 0,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('File', fileSchema);
