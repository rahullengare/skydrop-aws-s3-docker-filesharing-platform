const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Credentials are NEVER hardcoded.
// - Local testing: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from .env are passed explicitly.
// - Production (EC2): the credentials object is omitted so the SDK's default provider chain
//   picks up the attached IAM Role automatically.
const clientConfig = { region: process.env.AWS_REGION };

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
  if (process.env.AWS_SESSION_TOKEN) {
    clientConfig.credentials.sessionToken = process.env.AWS_SESSION_TOKEN;
  }
}

const s3Client = new S3Client(clientConfig);

const bucket = () => process.env.S3_BUCKET_NAME;

/**
 * Pre-signed PUT URL (valid 300 seconds = 5 minutes).
 * The browser must send the same Content-Type header it was signed with.
 */
async function generateUploadUrl(s3Key, mimeType) {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3Client, command, { expiresIn: 300 });
}

/**
 * Pre-signed GET URL (valid 60 seconds) that forces a download with the original file name.
 */
async function generateDownloadUrl(s3Key, originalName) {
  // Header values must be ASCII-safe: strip quotes/control chars/non-ASCII for the plain
  // filename and provide the real name through the RFC 5987 filename* parameter.
  const asciiName = String(originalName).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encodedName = encodeURIComponent(originalName);

  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
  });
  return getSignedUrl(s3Client, command, { expiresIn: 60 });
}

async function deleteS3Object(s3Key) {
  const command = new DeleteObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
  });
  return s3Client.send(command);
}

/**
 * Deletes many objects (batches of 1000). Throws if S3 reports any failure.
 * Used when a user deletes their account.
 */
async function deleteS3Objects(s3Keys) {
  for (let i = 0; i < s3Keys.length; i += 1000) {
    const batch = s3Keys.slice(i, i + 1000);
    // eslint-disable-next-line no-await-in-loop
    const result = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    if (result.Errors && result.Errors.length > 0) {
      throw new Error(`S3 failed to delete ${result.Errors.length} object(s)`);
    }
  }
}

/**
 * Looks up the real object in S3 (size, content type). Throws if the object does not exist.
 * Used by /confirm so a client cannot lie about sizeBytes to dodge the storage quota.
 */
async function headS3Object(s3Key) {
  const command = new HeadObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
  });
  return s3Client.send(command);
}

module.exports = {
  s3Client,
  generateUploadUrl,
  generateDownloadUrl,
  deleteS3Object,
  deleteS3Objects,
  headS3Object,
};
