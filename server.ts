import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { getApps, initializeApp, getApp, cert } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMessaging as getAdminMessaging } from 'firebase-admin/messaging';
import { GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MODERATION_EMAIL = 'Ruubengirma@gmail.com';

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=*, microphone=*, identity-credentials-get=*');
  next();
});

app.use(express.json({ limit: '15mb' }));

// Read Firebase applet config cleanly
let firebaseProjectId = 'polished-liberty-l4mm2';
let firestoreDatabaseId = 'ai-studio-5aaa3ce5-6e86-4e68-b4fb-8f3678935a86';
let firebaseApiKey = '';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    firebaseProjectId = cfg.projectId || firebaseProjectId;
    firestoreDatabaseId = cfg.firestoreDatabaseId || firestoreDatabaseId;
    firebaseApiKey = cfg.apiKey || '';
  }
} catch {
  // use defaults
}

// Initialize Firebase Admin (ID token verification works publicly; Firestore/Auth Admin mutations require ADC or service account)
let adminReady = false;
let adminCredentialsAvailable = false;
try {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const hasGacFile = Boolean(gacPath && fs.existsSync(gacPath));
  const isGcpRuntime = Boolean(
    process.env.K_SERVICE ||
      process.env.CLOUD_RUN_JOB ||
      process.env.FUNCTION_TARGET ||
      process.env.GAE_APPLICATION ||
      process.env.GCE_METADATA_HOST
  );

  if (!getApps().length) {
    if (serviceAccountRaw) {
      initializeApp({
        projectId: firebaseProjectId,
        credential: cert(JSON.parse(serviceAccountRaw)),
      });
      adminCredentialsAvailable = true;
    } else {
      initializeApp({
        projectId: firebaseProjectId,
      });
      adminCredentialsAvailable = hasGacFile || isGcpRuntime;
    }
  } else {
    adminCredentialsAvailable = Boolean(serviceAccountRaw) || hasGacFile || isGcpRuntime;
  }
  adminReady = true;
} catch (err) {
  console.warn('Firebase Admin init notice:', err instanceof Error ? err.message : err);
}

// In-memory store for Password Reset OTP sessions (hashed code, 10-minute expiry)
interface ResetOtpEntry {
  email: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  resetToken?: string;
}
const resetOtpMap = new Map<string, ResetOtpEntry>();

// In-memory store for Email Change OTP sessions (code sent strictly to previous/current email)
interface EmailChangeOtpEntry {
  uid: string;
  oldEmail: string;
  newEmail: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  emailChangeToken?: string;
}
const emailChangeOtpMap = new Map<string, EmailChangeOtpEntry>();

// In-memory store for Sign Up OTP sessions (6-digit code sent to new user's email)
interface SignupOtpEntry {
  email: string;
  username: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
  signupToken?: string;
}
const signupOtpMap = new Map<string, SignupOtpEntry>();

function getEmailChangeMapKey(uid: string, oldEmail: string, newEmail: string): string {
  return `${uid}:${oldEmail.trim().toLowerCase()}:${newEmail.trim().toLowerCase()}`;
}

function hashOtpCode(email: string, code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${email.toLowerCase()}:${code}:${salt}`).digest('hex');
}

function readConfigValue(key: string): string {
  const direct = process.env[key];
  if (direct && direct.trim()) return direct.trim();

  const candidateFiles = [
    `/etc/secrets/${key}`,
    path.resolve(__dirname, key),
  ];
  for (const filePath of candidateFiles) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content) return content;
      }
    } catch {
      // ignore read failure
    }
  }
  return '';
}

function getEmailConfigState(): {
  configured: boolean;
  provider: 'smtp' | 'gmail' | 'resend' | 'none';
} {
  if (readConfigValue('SMTP_HOST') && readConfigValue('SMTP_USER') && readConfigValue('SMTP_PASS')) {
    return { configured: true, provider: 'smtp' };
  }
  if (
    readConfigValue('GMAIL_USER') &&
    (readConfigValue('GMAIL_APP_PASSWORD') || readConfigValue('GMAIL_PASSWORD') || readConfigValue('GMAIL_PASS'))
  ) {
    return { configured: true, provider: 'gmail' };
  }
  if (readConfigValue('RESEND_API_KEY')) {
    return { configured: true, provider: 'resend' };
  }
  return { configured: false, provider: 'none' };
}

function getEmailTransport(portOverride?: number) {
  const gmailUser = readConfigValue('GMAIL_USER');
  const smtpHost = readConfigValue('SMTP_HOST');
  const host = smtpHost || (gmailUser ? 'smtp.gmail.com' : '');
  const user = readConfigValue('SMTP_USER') || gmailUser;
  const gmailPass =
    readConfigValue('GMAIL_APP_PASSWORD') || readConfigValue('GMAIL_PASSWORD') || readConfigValue('GMAIL_PASS');
  const smtpPass = readConfigValue('SMTP_PASS');
  const rawPass = smtpPass || gmailPass;
  const pass = !smtpPass && gmailPass ? rawPass.replace(/\s+/g, '') : rawPass;
  const port = portOverride ?? Number(readConfigValue('SMTP_PORT') || 587);

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
  }
  return null;
}

function parseDataUrlParts(dataUrl?: string): { mimeType: string; base64: string; ext: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
  return { mimeType, base64: match[2], ext };
}

async function sendOutboundEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<{ sent: boolean; provider?: string; reason?: string }> {
  const primaryPort = Number(readConfigValue('SMTP_PORT') || 587);
  const transporter = getEmailTransport(primaryPort);
  const gmailUser = readConfigValue('GMAIL_USER');
  const smtpSender = readConfigValue('SMTP_USER') || gmailUser;
  const configuredFrom =
    readConfigValue('SMTP_FROM') ||
    readConfigValue('EMAIL_FROM') ||
    readConfigValue('RESEND_FROM');
  const fromAddress =
    configuredFrom ||
    (smtpSender ? `"Ethio Chat" <${smtpSender}>` : 'Ethio Chat <no-reply@ethiochat.app>');

  if (transporter) {
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        attachments: params.attachments,
      });
      return { sent: true, provider: gmailUser ? 'gmail' : 'smtp' };
    } catch (err) {
      const code = String((err as any)?.code || '');
      const fallbackPort = primaryPort === 465 ? 587 : 465;
      if (code === 'ESOCKET' || code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ECONNREFUSED') {
        const fallbackTransport = getEmailTransport(fallbackPort);
        if (fallbackTransport) {
          try {
            await fallbackTransport.sendMail({
              from: fromAddress,
              to: params.to,
              subject: params.subject,
              text: params.text,
              html: params.html,
              attachments: params.attachments,
            });
            return { sent: true, provider: gmailUser ? 'gmail' : 'smtp' };
          } catch (fallbackErr) {
            console.error('SMTP fallback port send failed:', fallbackErr);
            return {
              sent: false,
              reason: fallbackErr instanceof Error ? fallbackErr.message : 'SMTP send failed',
            };
          }
        }
      }
      console.error('SMTP email send failed:', err);
      return { sent: false, reason: err instanceof Error ? err.message : 'SMTP send failed' };
    }
  }

  const resendKey = readConfigValue('RESEND_API_KEY');
  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.to],
          subject: params.subject,
          text: params.text,
          html: params.html,
          attachments: params.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
          })),
        }),
      });
      if (resp.ok) {
        return { sent: true, provider: 'resend' };
      }
      const errText = await resp.text();
      return { sent: false, reason: errText || 'Resend API rejected request' };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : 'Resend failed' };
    }
  }

  return { sent: false, reason: 'EMAIL_SERVICE_NOT_CONFIGURED' };
}

async function findUserByEmail(normalizedEmail: string): Promise<{ uid: string; email: string } | null> {
  // 1. Try Firebase Admin Auth lookup (only when server ADC/service-account credentials exist)
  if (adminReady && adminCredentialsAvailable) {
    try {
      const userRecord = await getAdminAuth(getApp()).getUserByEmail(normalizedEmail);
      return { uid: userRecord.uid, email: userRecord.email || normalizedEmail };
    } catch {
      // Fallback to Firestore below
    }

    try {
      const adminDb = getAdminFirestore(getApp(), firestoreDatabaseId);
      const snap = await adminDb.collection('users').where('email', '==', normalizedEmail).limit(1).get();
      if (!snap.empty) {
        const d = snap.docs[0].data();
        return { uid: String(d.userId || snap.docs[0].id), email: normalizedEmail };
      }
    } catch {
      // Fallback to REST query below
    }
  }

  // 2. Fallback: Firestore REST structuredQuery (works cleanly on public user profiles)
  try {
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents:runQuery${firebaseApiKey ? `?key=${firebaseApiKey}` : ''}`;
    const resp = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'email' },
              op: 'EQUAL',
              value: { stringValue: normalizedEmail },
            },
          },
          limit: 1,
        },
      }),
    });
    if (resp.ok) {
      const rows = (await resp.json()) as Array<{ document?: { name: string; fields?: Record<string, { stringValue?: string }> } }>;
      const docMatch = rows.find((r) => r.document);
      if (docMatch?.document) {
        const uid = docMatch.document.fields?.userId?.stringValue || docMatch.document.name.split('/').pop() || '';
        if (uid) return { uid, email: normalizedEmail };
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback: direct O(1) lookup via lowercase emailLocks document
  try {
    const safe = Buffer.from(normalizedEmail, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const emailKey = `em_${safe.slice(0, 120)}`;
    const lockUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/emailLocks/${encodeURIComponent(emailKey)}${firebaseApiKey ? `?key=${firebaseApiKey}` : ''}`;
    const lockResp = await fetch(lockUrl);
    if (lockResp.ok) {
      const lockDoc = (await lockResp.json()) as { fields?: Record<string, { stringValue?: string }> };
      const uid = lockDoc?.fields?.userId?.stringValue;
      if (uid) return { uid, email: normalizedEmail };
    }
  } catch {
    // ignore
  }
  return null;
}

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDataUrl(dataUrl?: string): Part | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  };
}

function extractStatusAndMessage(err: unknown): { code?: number; status?: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err || '');
  try {
    const parsed = JSON.parse(raw);
    const inner = parsed?.error || parsed;
    return {
      code: typeof inner?.code === 'number' ? inner.code : undefined,
      status: typeof inner?.status === 'string' ? inner.status : undefined,
      message: typeof inner?.message === 'string' ? inner.message : raw,
    };
  } catch {
    return { message: raw };
  }
}

function isRetryableOverload(err: unknown): boolean {
  const info = extractStatusAndMessage(err);
  const msg = info.message.toLowerCase();
  return (
    info.code === 503 ||
    info.code === 429 ||
    info.code === 500 ||
    info.status === 'UNAVAILABLE' ||
    info.status === 'RESOURCE_EXHAUSTED' ||
    msg.includes('503') ||
    msg.includes('high demand') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily') ||
    msg.includes('aborted')
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Media Upload & HTTP Range Streaming (supports Chat videos up to 50 MB & Post videos up to 790 MB)
const MEDIA_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'media');
const MEDIA_CHUNK_DIR = path.resolve(process.cwd(), 'uploads', 'chunks');
fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(MEDIA_CHUNK_DIR, { recursive: true });

const MAX_CHAT_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_POST_VIDEO_BYTES = 790 * 1024 * 1024; // 790 MB

interface PendingUploadSession {
  uploadId: string;
  tempPath: string;
  finalFileName: string;
  mimeType: string;
  totalSize: number;
  maxBytes: number;
  receivedBytes: number;
  createdAt: number;
}

const pendingUploadSessions = new Map<string, PendingUploadSession>();

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/avi': 'avi',
  'video/x-msvideo': 'avi',
  'video/3gpp': '3gp',
  'video/ogg': 'ogv',
};

const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
};

function sanitizeMediaExt(fileName: string, mimeType: string): string {
  const nameExt = path.extname(fileName || '').replace('.', '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (nameExt && EXT_TO_MIME[nameExt]) return nameExt;
  return MIME_TO_EXT[mimeType.toLowerCase()] || 'mp4';
}

// Cleanup stale incomplete upload sessions every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, session] of pendingUploadSessions.entries()) {
    if (session.createdAt < cutoff) {
      pendingUploadSessions.delete(id);
      fs.promises.unlink(session.tempPath).catch(() => {});
    }
  }
}, 30 * 60 * 1000);

app.post('/api/media/upload-init', async (req, res) => {
  const scope = req.body?.scope === 'chat' ? 'chat' : 'post';
  const maxBytes = scope === 'chat' ? MAX_CHAT_VIDEO_BYTES : MAX_POST_VIDEO_BYTES;
  const maxLabel = scope === 'chat' ? '50 MB' : '790 MB';
  const totalSize = Number(req.body?.totalSize || 0);
  const fileName = String(req.body?.fileName || 'video.mp4');
  const mimeType = String(req.body?.mimeType || 'video/mp4');

  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    res.status(400).json({ error: 'Invalid video file size.' });
    return;
  }
  if (totalSize > maxBytes) {
    res.status(413).json({ error: `Video size exceeds ${maxLabel} limit.` });
    return;
  }

  const ext = sanitizeMediaExt(fileName, mimeType);
  const uploadId = `vid_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const finalFileName = `${uploadId}.${ext}`;
  const tempPath = path.join(MEDIA_CHUNK_DIR, `${uploadId}.part`);

  try {
    await fs.promises.writeFile(tempPath, Buffer.alloc(0));
    pendingUploadSessions.set(uploadId, {
      uploadId,
      tempPath,
      finalFileName,
      mimeType: EXT_TO_MIME[ext] || 'video/mp4',
      totalSize,
      maxBytes,
      receivedBytes: 0,
      createdAt: Date.now(),
    });
    res.json({ ok: true, uploadId, finalFileName });
  } catch (err) {
    console.error('Upload init error:', err);
    res.status(500).json({ error: 'Failed to initialize video upload.' });
  }
});

app.post(
  '/api/media/upload-chunk',
  express.raw({ type: 'application/octet-stream', limit: '8mb' }),
  async (req, res) => {
    const uploadId = String(req.query.uploadId || '');
    const session = pendingUploadSessions.get(uploadId);
    if (!session) {
      res.status(404).json({ error: 'Upload session not found or expired.' });
      return;
    }

    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (chunk.length === 0) {
      res.status(400).json({ error: 'Empty chunk payload.' });
      return;
    }

    if (session.receivedBytes + chunk.length > session.maxBytes) {
      pendingUploadSessions.delete(uploadId);
      await fs.promises.unlink(session.tempPath).catch(() => {});
      res.status(413).json({ error: 'Video exceeds maximum allowed size.' });
      return;
    }

    try {
      await fs.promises.appendFile(session.tempPath, chunk);
      session.receivedBytes += chunk.length;
      res.json({ ok: true, receivedBytes: session.receivedBytes });
    } catch (err) {
      console.error('Upload chunk error:', err);
      res.status(500).json({ error: 'Failed to write video chunk.' });
    }
  }
);

app.post('/api/media/upload-complete', async (req, res) => {
  const uploadId = String(req.body?.uploadId || '');
  const session = pendingUploadSessions.get(uploadId);
  if (!session) {
    res.status(404).json({ error: 'Upload session not found.' });
    return;
  }

  pendingUploadSessions.delete(uploadId);
  const finalPath = path.join(MEDIA_UPLOAD_DIR, session.finalFileName);

  try {
    await fs.promises.rename(session.tempPath, finalPath);
    const stat = await fs.promises.stat(finalPath);
    res.json({
      ok: true,
      url: `/api/media/stream/${session.finalFileName}`,
      fileSize: stat.size,
      mimeType: session.mimeType,
    });
  } catch (err) {
    console.error('Upload complete error:', err);
    await fs.promises.unlink(session.tempPath).catch(() => {});
    res.status(500).json({ error: 'Failed to finalize video upload.' });
  }
});

interface PersistedMediaMeta {
  mediaId: string;
  fileName: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
  cachedAt: number;
}

const persistedMediaMetaCache = new Map<string, PersistedMediaMeta>();
const restoringFilesInFlight = new Map<string, Promise<void>>();

function readFirestoreInt(field: any): number {
  if (!field) return 0;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return Number(field.doubleValue);
  return 0;
}

async function fetchPersistedMediaMeta(mediaId: string): Promise<PersistedMediaMeta | null> {
  const cached = persistedMediaMetaCache.get(mediaId);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
    return cached;
  }

  try {
    const docUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/mediaFiles/${encodeURIComponent(mediaId)}${firebaseApiKey ? `?key=${firebaseApiKey}` : ''}`;
    const resp = await fetch(docUrl);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { fields?: Record<string, any> };
    const fields = json?.fields;
    if (!fields) return null;

    const totalSize = readFirestoreInt(fields.totalSize);
    const chunkSize = readFirestoreInt(fields.chunkSize);
    const chunkCount = readFirestoreInt(fields.chunkCount);
    const mimeType = String(fields.mimeType?.stringValue || 'video/mp4');
    const fileName = String(fields.fileName?.stringValue || `${mediaId}.mp4`);

    if (totalSize <= 0 || chunkSize <= 0 || chunkCount <= 0) return null;
    const meta: PersistedMediaMeta = {
      mediaId,
      fileName,
      mimeType,
      totalSize,
      chunkSize,
      chunkCount,
      cachedAt: Date.now(),
    };
    persistedMediaMetaCache.set(mediaId, meta);
    return meta;
  } catch {
    return null;
  }
}

async function fetchPersistedMediaChunk(mediaId: string, chunkIndex: number): Promise<Buffer | null> {
  try {
    const chunkUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/mediaFiles/${encodeURIComponent(mediaId)}/chunks/${chunkIndex}${firebaseApiKey ? `?key=${firebaseApiKey}` : ''}`;
    const resp = await fetch(chunkUrl);
    if (!resp.ok) return null;
    const json = (await resp.json()) as { fields?: Record<string, any> };
    const b64 = json?.fields?.data?.bytesValue;
    if (typeof b64 !== 'string' || !b64) return null;
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

function triggerBackgroundDiskRestore(fileId: string, meta: PersistedMediaMeta) {
  if (restoringFilesInFlight.has(fileId)) return;
  const finalPath = path.join(MEDIA_UPLOAD_DIR, fileId);
  const partPath = path.join(MEDIA_CHUNK_DIR, `${fileId}.restore.part`);

  const job = (async () => {
    try {
      await fs.promises.writeFile(partPath, Buffer.alloc(0));
      for (let i = 0; i < meta.chunkCount; i++) {
        const buf = await fetchPersistedMediaChunk(meta.mediaId, i);
        if (!buf) throw new Error(`Missing chunk ${i}`);
        await fs.promises.appendFile(partPath, buf);
      }
      await fs.promises.rename(partPath, finalPath);
    } catch {
      await fs.promises.unlink(partPath).catch(() => {});
    } finally {
      restoringFilesInFlight.delete(fileId);
    }
  })();

  restoringFilesInFlight.set(fileId, job);
}

app.get('/api/media/stream/:fileId', async (req, res) => {
  const fileId = String(req.params.fileId || '');
  if (!/^[a-zA-Z0-9_.\-]+$/.test(fileId)) {
    res.status(400).send('Invalid file identifier');
    return;
  }

  const filePath = path.join(MEDIA_UPLOAD_DIR, fileId);
  const ext = path.extname(fileId).replace('.', '').toLowerCase();

  // 1. Fast path: Serve directly from warm local container disk
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile() && stat.size > 0) {
      const fileSize = stat.size;
      const contentType = EXT_TO_MIME[ext] || 'video/mp4';

      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${fileId}"`);
      }

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1]
          ? Math.min(parseInt(parts[1], 10), fileSize - 1)
          : Math.min(start + 4 * 1024 * 1024 - 1, fileSize - 1);

        if (!Number.isFinite(start) || start < 0 || start >= fileSize || end < start) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000',
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }
  } catch {
    // Not on local container disk (e.g. after container restart) — fall back to Firestore cloud persistence
  }

  // 2. Cloud recovery path: Stream directly from persisted Firestore chunks & warm disk cache
  const mediaId = fileId.replace(/\.[^.]+$/, '');
  const meta = await fetchPersistedMediaMeta(mediaId);
  if (!meta) {
    res.status(404).send('Media file not found');
    return;
  }

  triggerBackgroundDiskRestore(fileId, meta);

  const fileSize = meta.totalSize;
  const contentType = meta.mimeType || EXT_TO_MIME[ext] || 'video/mp4';

  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${fileId}"`);
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const requestedEnd = parts[1]
      ? parseInt(parts[1], 10)
      : start + 2 * 1024 * 1024 - 1;
    const end = Math.min(requestedEnd, start + 4 * 1024 * 1024 - 1, fileSize - 1);

    if (!Number.isFinite(start) || start < 0 || start >= fileSize || end < start) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const startChunk = Math.floor(start / meta.chunkSize);
    const endChunk = Math.floor(end / meta.chunkSize);
    const chunkIndices: number[] = [];
    for (let idx = startChunk; idx <= endChunk; idx++) {
      chunkIndices.push(idx);
    }

    const chunkBuffers = await Promise.all(
      chunkIndices.map((idx) => fetchPersistedMediaChunk(meta.mediaId, idx))
    );
    if (chunkBuffers.some((b) => !b)) {
      res.status(404).send('Media chunk unavailable');
      return;
    }

    const combined = Buffer.concat(chunkBuffers as Buffer[]);
    const baseOffset = startChunk * meta.chunkSize;
    const sliceStart = start - baseOffset;
    const sliceEnd = end - baseOffset + 1;
    const payload = combined.subarray(sliceStart, sliceEnd);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': payload.length,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
    });
    res.end(payload);
    return;
  }

  // Full download / non-range fallback: stream sequentially
  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000',
  });
  for (let i = 0; i < meta.chunkCount; i++) {
    if (res.destroyed) break;
    const chunkBuf = await fetchPersistedMediaChunk(meta.mediaId, i);
    if (!chunkBuf) break;
    if (!res.write(chunkBuf)) {
      await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  }
  res.end();
});

app.delete('/api/media/stream/:fileId', async (req, res) => {
  const fileId = String(req.params.fileId || '');
  if (!/^[a-zA-Z0-9_.\-]+$/.test(fileId)) {
    res.status(400).json({ error: 'Invalid file identifier' });
    return;
  }
  const mediaId = fileId.replace(/\.[^.]+$/, '');
  persistedMediaMetaCache.delete(mediaId);
  const filePath = path.join(MEDIA_UPLOAD_DIR, fileId);
  await fs.promises.unlink(filePath).catch(() => {});
  res.json({ ok: true });
});

// 1. Forgot Password Step 1: Send 6-digit verification code to email
app.post('/api/auth/send-reset-code', async (req, res) => {
  const rawEmail = String(req.body?.email || '').trim().toLowerCase();
  if (!rawEmail || !rawEmail.includes('@')) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const foundUser = await findUserByEmail(rawEmail);
  if (!foundUser) {
    res.status(404).json({ error: 'No Ethio Chat account was found with this email address.' });
    return;
  }

  const code = String(crypto.randomInt(100000, 999999));
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashOtpCode(rawEmail, code, salt);

  resetOtpMap.set(rawEmail, {
    email: rawEmail,
    codeHash,
    salt,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    verified: false,
  });

  const emailRes = await sendOutboundEmail({
    to: rawEmail,
    subject: 'Ethio Chat Password Reset Verification Code',
    text: `Your Ethio Chat password reset code is: ${code}\n\nThis code expires in 10 minutes. Do not share this code with anyone.`,
    html: `<div style="font-family:sans-serif;max-width:460px;margin:auto;padding:24px;border-radius:16px;border:1px solid #e2e8f0">
      <h2 style="color:#7560DF;margin-top:0">Ethio Chat Password Reset</h2>
      <p>Enter this 6-digit verification code in the app to set a new password:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;padding:16px;background:#f4f2ff;color:#503cb3;text-align:center;border-radius:12px">${code}</div>
      <p style="font-size:12px;color:#64748b;margin-top:16px">This code expires in 10 minutes.</p>
    </div>`,
  });

  if (!emailRes.sent) {
    res.status(503).json({
      ok: false,
      code: emailRes.reason || 'EMAIL_SERVICE_NOT_CONFIGURED',
      error:
        emailRes.reason === 'EMAIL_SERVICE_NOT_CONFIGURED'
          ? 'Email delivery (GMAIL_USER + GMAIL_APP_PASSWORD, SMTP_HOST/SMTP_USER/SMTP_PASS, or RESEND_API_KEY) is not configured in Settings > Secrets yet.'
          : emailRes.reason || 'Failed to send verification code email.',
    });
    return;
  }

  res.json({ ok: true, emailSent: true });
});

app.get('/api/auth/email-status', async (req, res) => {
  const base = getEmailConfigState();
  if (req.query.verify !== '1') {
    res.json(base);
    return;
  }
  if (!base.configured) {
    res.json({ ...base, verified: false, reason: 'EMAIL_SERVICE_NOT_CONFIGURED' });
    return;
  }
  if (base.provider === 'resend') {
    res.json({ ...base, verified: true });
    return;
  }
  const primaryPort = Number(process.env.SMTP_PORT || 587);
  const t1 = getEmailTransport(primaryPort);
  if (!t1) {
    res.json({ ...base, verified: false, reason: 'Transport unavailable' });
    return;
  }
  try {
    await t1.verify();
    res.json({ ...base, verified: true, port: primaryPort });
    return;
  } catch (err1: any) {
    const fallbackPort = primaryPort === 465 ? 587 : 465;
    const t2 = getEmailTransport(fallbackPort);
    if (t2) {
      try {
        await t2.verify();
        res.json({ ...base, verified: true, port: fallbackPort });
        return;
      } catch (err2: any) {
        res.json({
          ...base,
          verified: false,
          reason: err2?.code || err2?.message || err1?.code || err1?.message || 'SMTP verify failed',
        });
        return;
      }
    }
    res.json({
      ...base,
      verified: false,
      reason: err1?.code || err1?.message || 'SMTP verify failed',
    });
  }
});

// 2. Forgot Password Step 2: Strictly verify 6-digit code (rejects wrong codes)
app.post('/api/auth/verify-reset-code', (req, res) => {
  const rawEmail = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();

  if (!rawEmail || !code) {
    res.status(400).json({ ok: false, error: 'Email and 6-digit code are required.' });
    return;
  }

  const entry = resetOtpMap.get(rawEmail);
  if (!entry) {
    res.status(400).json({ ok: false, error: 'No verification code was requested for this email. Please send a new code.' });
    return;
  }

  if (Date.now() > entry.expiresAt) {
    resetOtpMap.delete(rawEmail);
    res.status(400).json({ ok: false, error: 'Verification code expired. Please request a new code.' });
    return;
  }

  if (entry.attempts >= 5) {
    resetOtpMap.delete(rawEmail);
    res.status(429).json({ ok: false, error: 'Too many wrong code attempts. Please request a new code.' });
    return;
  }

  const candidateHash = hashOtpCode(rawEmail, code, entry.salt);
  const expectedBuf = Buffer.from(entry.codeHash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const matched = expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf);

  if (!matched) {
    entry.attempts += 1;
    res.status(400).json({
      ok: false,
      error: 'Incorrect verification code. Please check the code and try again.',
    });
    return;
  }

  const resetToken = crypto.randomBytes(24).toString('hex');
  entry.verified = true;
  entry.resetToken = resetToken;
  res.json({ ok: true, resetToken });
});

// 3. Forgot Password Step 3: Set New Password after valid verification token
function validateServerStrongPassword(password: string): string | null {
  const missing: string[] = [];
  if (password.length < 8) missing.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) missing.push('an uppercase letter (A-Z)');
  if (!/[a-z]/.test(password)) missing.push('a lowercase letter (a-z)');
  if (!/[0-9]/.test(password)) missing.push('a number (0-9)');
  if (!/[^A-Za-z0-9]/.test(password)) missing.push('a symbol (!@#$%...)');
  return missing.length > 0 ? `Password must include ${missing.join(', ')}.` : null;
}

app.post('/api/auth/complete-password-reset', async (req, res) => {
  const rawEmail = String(req.body?.email || '').trim().toLowerCase();
  const resetToken = String(req.body?.resetToken || '').trim();
  const newPassword = String(req.body?.newPassword || '');

  if (!rawEmail || !resetToken) {
    res.status(400).json({ ok: false, error: 'Valid reset session and email are required.' });
    return;
  }

  const pwError = validateServerStrongPassword(newPassword);
  if (pwError) {
    res.status(400).json({ ok: false, error: pwError });
    return;
  }

  const entry = resetOtpMap.get(rawEmail);
  if (!entry || !entry.verified || entry.resetToken !== resetToken || Date.now() > entry.expiresAt) {
    res.status(400).json({ ok: false, error: 'Reset session expired or invalid. Please verify your code again.' });
    return;
  }

  if (!adminReady || !adminCredentialsAvailable) {
    res.status(503).json({
      ok: false,
      code: 'FIREBASE_ADMIN_IAM_REQUIRED',
      error: 'Direct server password update requires Firebase Admin credentials. Please use the Send Reset Email (Firebase) button below to complete your password reset.',
    });
    return;
  }

  try {
    const adminAuth = getAdminAuth(getApp());
    const userRecord = await adminAuth.getUserByEmail(rawEmail);
    await adminAuth.updateUser(userRecord.uid, { password: newPassword });
    const nextPasswordVersion = Date.now();
    try {
      const adminDb = getAdminFirestore(getApp(), firestoreDatabaseId);
      await adminDb.collection('users').doc(userRecord.uid).set(
        {
          passwordVersion: nextPasswordVersion,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch {
      // Fallback: REST patch for passwordVersion if Admin Firestore isn't authorized
      const patchUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/users/${encodeURIComponent(userRecord.uid)}?updateMask.fieldPaths=passwordVersion&updateMask.fieldPaths=updatedAt${firebaseApiKey ? `&key=${firebaseApiKey}` : ''}`;
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            passwordVersion: { integerValue: String(nextPasswordVersion) },
            updatedAt: { stringValue: new Date().toISOString() },
          },
        }),
      }).catch(() => {});
    }
    resetOtpMap.delete(rawEmail);
    res.json({ ok: true, passwordVersion: nextPasswordVersion });
  } catch (err: any) {
    console.error('Failed to update Firebase user password:', err);
    const errCode = String(err?.code || '');
    const isIamErr =
      errCode.includes('internal-error') ||
      errCode.includes('permission') ||
      String(err?.message || '').toLowerCase().includes('credential');
    res.status(isIamErr ? 503 : 500).json({
      ok: false,
      code: isIamErr ? 'FIREBASE_ADMIN_IAM_REQUIRED' : undefined,
      error: isIamErr
        ? 'Direct server password update requires Firebase Admin permissions. Please use the Send Reset Email (Firebase) button below to complete your password reset via Firebase email.'
        : err instanceof Error
        ? err.message
        : 'Failed to update password. Please try Firebase reset email.',
    });
  }
});

// 3b. Seamless saved-account switching custom token (when Firebase Admin credentials are available)
app.post('/api/auth/custom-token', async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid || !adminReady || !adminCredentialsAvailable) {
    res.status(200).json({ ok: false });
    return;
  }
  try {
    const customToken = await getAdminAuth(getApp()).createCustomToken(uid);
    res.json({ ok: true, customToken });
  } catch {
    res.status(200).json({ ok: false });
  }
});

// 3c. Email Change Verification Flow (Code sent strictly to user's PREVIOUS/CURRENT email before allowing change)
async function resolveEmailChangeCallerUid(
  req: express.Request,
  claimedUid: string,
  currentEmail: string
): Promise<{ ok: true; uid: string } | { ok: false; status: number; error: string }> {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (idToken && adminReady) {
    try {
      const decoded = await getAdminAuth(getApp()).verifyIdToken(idToken);
      if (claimedUid && decoded.uid !== claimedUid) {
        return { ok: false, status: 403, error: 'Authenticated session does not match this account.' };
      }
      return { ok: true, uid: decoded.uid };
    } catch (err) {
      return {
        ok: false,
        status: 401,
        error: err instanceof Error ? err.message : 'Invalid or expired Firebase authentication token.',
      };
    }
  }

  if (!claimedUid || !currentEmail) {
    return { ok: false, status: 400, error: 'Account ID and current email are required.' };
  }
  const existingOwner = await findUserByEmail(currentEmail);
  if (existingOwner && existingOwner.uid !== claimedUid) {
    return { ok: false, status: 403, error: 'Current email does not belong to this account.' };
  }
  return { ok: true, uid: claimedUid };
}

app.post('/api/auth/send-email-change-code', async (req, res) => {
  const claimedUid = String(req.body?.uid || '').trim();
  const oldEmail = String(req.body?.currentEmail || '').trim().toLowerCase();
  const newEmail = String(req.body?.newEmail || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!oldEmail || !emailRegex.test(oldEmail)) {
    res.status(400).json({ ok: false, error: 'Current account email is missing or invalid.' });
    return;
  }
  if (!newEmail || !emailRegex.test(newEmail)) {
    res.status(400).json({ ok: false, error: 'Please enter a valid new email address.' });
    return;
  }
  if (newEmail === oldEmail) {
    res.status(400).json({ ok: false, error: 'New email must be different from your current email.' });
    return;
  }

  const caller = await resolveEmailChangeCallerUid(req, claimedUid, oldEmail);
  if (!caller.ok) {
    res.status(caller.status).json({ ok: false, error: caller.error });
    return;
  }

  const conflict = await findUserByEmail(newEmail);
  if (conflict && conflict.uid !== caller.uid) {
    res.status(409).json({
      ok: false,
      code: 'EMAIL_ALREADY_IN_USE',
      error: 'EMAIL_ALREADY_IN_USE',
    });
    return;
  }

  const code = String(crypto.randomInt(100000, 999999));
  const salt = crypto.randomBytes(16).toString('hex');
  const subjectScope = `${caller.uid}:${oldEmail}:${newEmail}`;
  const codeHash = hashOtpCode(subjectScope, code, salt);
  const mapKey = getEmailChangeMapKey(caller.uid, oldEmail, newEmail);

  emailChangeOtpMap.set(mapKey, {
    uid: caller.uid,
    oldEmail,
    newEmail,
    codeHash,
    salt,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    verified: false,
  });

  const emailRes = await sendOutboundEmail({
    to: oldEmail,
    subject: 'Ethio Chat Email Change Verification Code',
    text: `You requested to change your Ethio Chat email to ${newEmail}.\n\nYour 6-digit verification code is: ${code}\n\nEnter this code in Edit Profile to confirm the change. This code expires in 10 minutes.`,
    html: `<div style="font-family:sans-serif;max-width:460px;margin:auto;padding:24px;border-radius:16px;border:1px solid #e2e8f0">
      <h2 style="color:#7560DF;margin-top:0">Verify Your Current Email</h2>
      <p>You requested to change your Ethio Chat email to <strong>${newEmail}</strong>.</p>
      <p>Enter this 6-digit verification code in the app to confirm:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;padding:16px;background:#f4f2ff;color:#503cb3;text-align:center;border-radius:12px">${code}</div>
      <p style="font-size:12px;color:#64748b;margin-top:16px">This code expires in 10 minutes. If you did not request this change, please ignore this email and secure your password.</p>
    </div>`,
  });

  if (!emailRes.sent) {
    emailChangeOtpMap.delete(mapKey);
    res.status(503).json({
      ok: false,
      code: emailRes.reason || 'EMAIL_SERVICE_NOT_CONFIGURED',
      error:
        emailRes.reason === 'EMAIL_SERVICE_NOT_CONFIGURED'
          ? 'Email delivery (GMAIL_USER + GMAIL_APP_PASSWORD, SMTP_HOST/SMTP_USER/SMTP_PASS, or RESEND_API_KEY) is not configured in Settings > Secrets yet.'
          : emailRes.reason || 'Failed to send verification code to your current email.',
    });
    return;
  }

  res.json({ ok: true, emailSent: true, sentTo: oldEmail });
});

app.post('/api/auth/verify-email-change-code', async (req, res) => {
  const claimedUid = String(req.body?.uid || '').trim();
  const oldEmail = String(req.body?.currentEmail || '').trim().toLowerCase();
  const newEmail = String(req.body?.newEmail || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();

  if (!oldEmail || !newEmail || !code) {
    res.status(400).json({ ok: false, error: 'Current email, new email, and 6-digit code are required.' });
    return;
  }

  const caller = await resolveEmailChangeCallerUid(req, claimedUid, oldEmail);
  if (!caller.ok) {
    res.status(caller.status).json({ ok: false, error: caller.error });
    return;
  }

  const mapKey = getEmailChangeMapKey(caller.uid, oldEmail, newEmail);
  const entry = emailChangeOtpMap.get(mapKey);
  if (!entry) {
    res.status(400).json({
      ok: false,
      error: 'No verification code was requested for this email change. Please send a code to your current email first.',
    });
    return;
  }

  if (Date.now() > entry.expiresAt) {
    emailChangeOtpMap.delete(mapKey);
    res.status(400).json({ ok: false, error: 'Verification code expired. Please request a new code.' });
    return;
  }

  if (entry.attempts >= 5) {
    emailChangeOtpMap.delete(mapKey);
    res.status(429).json({ ok: false, error: 'Too many wrong code attempts. Please request a new code.' });
    return;
  }

  const candidateHash = hashOtpCode(`${caller.uid}:${oldEmail}:${newEmail}`, code, entry.salt);
  const expectedBuf = Buffer.from(entry.codeHash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const matched =
    expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf);

  if (!matched) {
    entry.attempts += 1;
    res.status(400).json({
      ok: false,
      error: 'Incorrect verification code. Please check your current email and try again.',
    });
    return;
  }

  const emailChangeToken = crypto.randomBytes(24).toString('hex');
  entry.verified = true;
  entry.emailChangeToken = emailChangeToken;
  res.json({ ok: true, emailChangeToken });
});

app.post('/api/auth/complete-email-change', async (req, res) => {
  const claimedUid = String(req.body?.uid || '').trim();
  const oldEmail = String(req.body?.currentEmail || '').trim().toLowerCase();
  const newEmail = String(req.body?.newEmail || '').trim().toLowerCase();
  const emailChangeToken = String(req.body?.emailChangeToken || '').trim();
  const stage = req.body?.stage === 'prepare' ? 'prepare' : 'commit';

  if (!oldEmail || !newEmail || !emailChangeToken) {
    res.status(400).json({
      ok: false,
      error: 'EMAIL_CHANGE_VERIFICATION_REQUIRED',
    });
    return;
  }

  const caller = await resolveEmailChangeCallerUid(req, claimedUid, oldEmail);
  if (!caller.ok) {
    res.status(caller.status).json({ ok: false, error: caller.error });
    return;
  }

  const mapKey = getEmailChangeMapKey(caller.uid, oldEmail, newEmail);
  const entry = emailChangeOtpMap.get(mapKey);
  if (
    !entry ||
    !entry.verified ||
    entry.emailChangeToken !== emailChangeToken ||
    Date.now() > entry.expiresAt
  ) {
    res.status(403).json({
      ok: false,
      error: 'Email verification code is invalid or expired. Please verify the code sent to your current email.',
    });
    return;
  }

  const conflict = await findUserByEmail(newEmail);
  if (conflict && conflict.uid !== caller.uid) {
    emailChangeOtpMap.delete(mapKey);
    res.status(409).json({ ok: false, code: 'EMAIL_ALREADY_IN_USE', error: 'EMAIL_ALREADY_IN_USE' });
    return;
  }

  if (stage === 'commit') {
    emailChangeOtpMap.delete(mapKey);
    res.json({ ok: true, committed: true });
    return;
  }

  let authUpdatedOnServer = false;
  if (adminReady && adminCredentialsAvailable) {
    try {
      await getAdminAuth(getApp()).updateUser(caller.uid, { email: newEmail });
      authUpdatedOnServer = true;
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/email-already-exists' || String(err?.message || '').includes('EMAIL_EXISTS')) {
        emailChangeOtpMap.delete(mapKey);
        res.status(409).json({ ok: false, code: 'EMAIL_ALREADY_IN_USE', error: 'EMAIL_ALREADY_IN_USE' });
        return;
      }
      // If local dev lacks Admin IAM credentials, keep OTP entry alive until client Firebase Auth update commits
    }
  }

  if (authUpdatedOnServer) {
    emailChangeOtpMap.delete(mapKey);
  }
  res.json({ ok: true, authUpdatedOnServer });
});

// 3d. Sign Up 6-Digit Email Verification Flow
app.post('/api/auth/send-signup-code', async (req, res) => {
  const rawEmail = String(req.body?.email || '').trim().toLowerCase();
  const cleanUsername = String(req.body?.username || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!cleanUsername || !/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
    res.status(400).json({
      ok: false,
      error: 'Username must be 3–30 characters using only letters, numbers, and underscores (_).',
    });
    return;
  }

  if (!rawEmail || !emailRegex.test(rawEmail)) {
    res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    return;
  }

  const existingUser = await findUserByEmail(rawEmail);
  if (existingUser) {
    res.status(409).json({
      ok: false,
      code: 'EMAIL_ALREADY_IN_USE',
      error: 'EMAIL_ALREADY_IN_USE',
    });
    return;
  }

  const code = String(crypto.randomInt(100000, 999999));
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = hashOtpCode(`signup:${rawEmail}`, code, salt);

  signupOtpMap.set(rawEmail, {
    email: rawEmail,
    username: cleanUsername,
    codeHash,
    salt,
    expiresAt: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    verified: false,
  });

  const emailRes = await sendOutboundEmail({
    to: rawEmail,
    subject: 'Ethio Chat Sign Up Verification Code',
    text: `Welcome to Ethio Chat!\n\nYour 6-digit verification code to create account @${cleanUsername} is: ${code}\n\nEnter this code in the app to verify your email and finish signing up. This code expires in 10 minutes.`,
    html: `<div style="font-family:sans-serif;max-width:460px;margin:auto;padding:24px;border-radius:16px;border:1px solid #e2e8f0">
      <h2 style="color:#7560DF;margin-top:0">Verify Your Email for Ethio Chat</h2>
      <p>Enter this 6-digit verification code in the app to create your account <strong>@${cleanUsername}</strong>:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;padding:16px;background:#f4f2ff;color:#503cb3;text-align:center;border-radius:12px">${code}</div>
      <p style="font-size:12px;color:#64748b;margin-top:16px">This code expires in 10 minutes. Do not share this code with anyone.</p>
    </div>`,
  });

  if (!emailRes.sent) {
    signupOtpMap.delete(rawEmail);
    res.status(503).json({
      ok: false,
      code: emailRes.reason || 'EMAIL_SERVICE_NOT_CONFIGURED',
      error:
        emailRes.reason === 'EMAIL_SERVICE_NOT_CONFIGURED'
          ? 'Email delivery (GMAIL_USER + GMAIL_APP_PASSWORD, SMTP_HOST/SMTP_USER/SMTP_PASS, or RESEND_API_KEY) is not configured in Settings > Secrets yet.'
          : emailRes.reason || 'Failed to send verification code email.',
    });
    return;
  }

  res.json({ ok: true, emailSent: true });
});

app.post('/api/auth/verify-signup-code', (req, res) => {
  const rawEmail = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();

  if (!rawEmail || !code) {
    res.status(400).json({ ok: false, error: 'Email and 6-digit verification code are required.' });
    return;
  }

  const entry = signupOtpMap.get(rawEmail);
  if (!entry) {
    res.status(400).json({
      ok: false,
      error: 'No verification code was requested for this email. Please send a new code.',
    });
    return;
  }

  if (Date.now() > entry.expiresAt) {
    signupOtpMap.delete(rawEmail);
    res.status(400).json({ ok: false, error: 'Verification code expired. Please request a new code.' });
    return;
  }

  if (entry.attempts >= 5) {
    signupOtpMap.delete(rawEmail);
    res.status(429).json({ ok: false, error: 'Too many wrong code attempts. Please request a new code.' });
    return;
  }

  const candidateHash = hashOtpCode(`signup:${rawEmail}`, code, entry.salt);
  const expectedBuf = Buffer.from(entry.codeHash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const matched =
    expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf);

  if (!matched) {
    entry.attempts += 1;
    res.status(400).json({
      ok: false,
      error: 'Incorrect verification code. Please check your email and try again.',
    });
    return;
  }

  const signupToken = crypto.randomBytes(24).toString('hex');
  entry.verified = true;
  entry.signupToken = signupToken;
  res.json({ ok: true, signupToken });
});

app.post('/api/auth/consume-signup-token', (req, res) => {
  const rawEmail = String(req.body?.email || '').trim().toLowerCase();
  const signupToken = String(req.body?.signupToken || '').trim();

  if (!rawEmail || !signupToken) {
    res.status(400).json({ ok: false, code: 'SIGNUP_VERIFICATION_REQUIRED', error: 'SIGNUP_VERIFICATION_REQUIRED' });
    return;
  }

  const entry = signupOtpMap.get(rawEmail);
  if (
    !entry ||
    !entry.verified ||
    entry.signupToken !== signupToken ||
    Date.now() > entry.expiresAt
  ) {
    res.status(403).json({
      ok: false,
      code: 'SIGNUP_VERIFICATION_REQUIRED',
      error: 'Email verification code is invalid or expired. Please verify your email code again.',
    });
    return;
  }

  signupOtpMap.delete(rawEmail);
  res.json({ ok: true });
});

// 4. Moderation Report / Appeal Email Dispatcher -> Ruubengirma@gmail.com
app.post('/api/moderation/send-email', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const kind = typeof body.kind === 'string' ? body.kind : 'report';
  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim()
      : `[Ethio Chat] ${kind === 'warning_appeal' ? 'Account Appeal' : 'Post Report'}`;

  let summaryText = typeof body.summaryText === 'string' ? body.summaryText.trim() : '';
  if (!summaryText) {
    if (kind === 'warning_appeal') {
      const reasons = Array.isArray(body.reportedReasons)
        ? body.reportedReasons.map(String).join(', ')
        : 'N/A';
      summaryText = [
        `Account Warning Appeal`,
        `User: ${String(body.displayName || '')} (@${String(body.username || '')})`,
        `Email: ${String(body.email || '')}`,
        `Reports Count: ${String(body.reportsCount || 0)}`,
        `Reported Reasons: ${reasons}`,
        ``,
        `Appeal Message:`,
        `${String(body.appealMessage || '(No text provided, see attachments)')}`,
      ].join('\n');
    } else {
      summaryText = [
        `Post Report`,
        `Reason: ${String(body.reason || 'N/A')}`,
        `Post ID: ${String(body.postId || '')}`,
        `Reported Author: ${String(body.postAuthorDisplayName || '')} (@${String(body.postAuthorUsername || '')})`,
        `Reporter: ${String(body.reporterDisplayName || '')} (@${String(body.reporterUsername || '')})`,
        body.postContentSnippet ? `Post Content: ${String(body.postContentSnippet)}` : '',
        body.details ? `\nAdditional Details:\n${String(body.details)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
  }

  const photoEvidenceUrl = typeof body.photoEvidenceUrl === 'string' ? body.photoEvidenceUrl : undefined;
  const videoEvidenceUrl = typeof body.videoEvidenceUrl === 'string' ? body.videoEvidenceUrl : undefined;

  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  const photoPart = parseDataUrlParts(photoEvidenceUrl);
  if (photoPart) {
    attachments.push({
      filename: `${kind}_photo.${photoPart.ext}`,
      content: Buffer.from(photoPart.base64, 'base64'),
      contentType: photoPart.mimeType,
    });
  }
  const videoPart = parseDataUrlParts(videoEvidenceUrl);
  if (videoPart) {
    attachments.push({
      filename: `${kind}_video.${videoPart.ext}`,
      content: Buffer.from(videoPart.base64, 'base64'),
      contentType: videoPart.mimeType,
    });
  }

  const safeHtmlBody = summaryText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  const emailRes = await sendOutboundEmail({
    to: MODERATION_EMAIL,
    subject,
    text: summaryText,
    html: `<div style="font-family:sans-serif;max-width:600px;padding:20px;border:1px solid #e2e8f0;border-radius:12px">
      <h2 style="color:#7560DF;margin-top:0">${subject}</h2>
      <p style="line-height:1.6;color:#1e293b">${safeHtmlBody}</p>
      ${attachments.length > 0 ? `<p style="font-size:12px;color:#64748b">Attached evidence files: ${attachments.map((a) => a.filename).join(', ')}</p>` : ''}
    </div>`,
    attachments,
  });

  res.json({
    ok: true,
    recipient: MODERATION_EMAIL,
    emailSent: emailRes.sent,
    reason: emailRes.reason,
  });
});

// RubGPT conversational & multimodal (text + image) AI endpoint
app.post('/api/rubgpt', async (req, res) => {
  const { message, imageUrl, history = [], language = 'en' } = req.body as {
    message?: string;
    imageUrl?: string;
    history?: Array<{ role: 'user' | 'model'; text: string; imageUrl?: string }>;
    language?: 'en' | 'om' | 'am';
  };

  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  const imagePart = parseDataUrl(imageUrl);

  if (!trimmedMessage && !imagePart) {
    res.status(400).json({ error: 'Please enter a message or attach an image for RubGPT.' });
    return;
  }

  const ai = getAiClient();
  if (!ai) {
    res.status(503).json({
      error:
        language === 'om'
          ? 'Furtuun Gemini API hin qindaa’in jira. Settings > Secrets keessatti mirkaneessaa.'
          : language === 'am'
          ? 'የGemini API ቁልፍ አልተዋቀረም። እባክዎ Settings > Secrets ውስጥ ያረጋግጡ።'
          : 'Gemini API key is not configured yet. Please check Settings > Secrets.',
    });
    return;
  }

  const langHint =
    language === 'om'
      ? 'The user currently has the app set to Afaan Oromo. Respond clearly in Afaan Oromo unless they ask in another language.'
      : language === 'am'
      ? 'The user currently has the app set to Amharic. Respond clearly in Amharic (አማርኛ) unless they ask in another language.'
      : 'Respond clearly and helpfully in the same language the user writes in (English, Afaan Oromo, or Amharic).';

  const systemInstruction = `You are RubGPT, a smart, friendly, and accurate multimodal AI assistant built inside the Ethio Chat app. You can analyze photos/images users upload (read text in images, identify objects, explain problems, translate text from images, answer homework/questions about photos) and answer any text questions in English, Afaan Oromo, or Amharic. Keep answers clear, structured, and warm. ${langHint}`;

  const validHistory = (Array.isArray(history) ? history : [])
    .slice(-14)
    .filter((h) => h && (h.role === 'user' || h.role === 'model') && (typeof h.text === 'string' || typeof h.imageUrl === 'string'));

  let imagesRemainingInHistory = 2;
  const chatHistory = [...validHistory]
    .reverse()
    .map((h) => {
      const parts: Part[] = [];
      if (h.imageUrl && imagesRemainingInHistory > 0) {
        const histImg = parseDataUrl(h.imageUrl);
        if (histImg) {
          parts.push(histImg);
          imagesRemainingInHistory -= 1;
        }
      }
      if (h.text && h.text.trim()) {
        parts.push({ text: h.text });
      }
      if (parts.length === 0) {
        parts.push({ text: ' ' });
      }
      return {
        role: h.role,
        parts,
      };
    })
    .reverse();

  const effectiveText =
    trimmedMessage ||
    (language === 'om'
      ? 'Suuraa kana sirriitti ilaaliitii wanta isa keessa jiru naaf ibsi.'
      : language === 'am'
      ? 'ይህንን ምስል በጥንቃቄ ተመልክተህ በውስጡ ያለውን ግለጽልኝ።'
      : 'Please look closely at this image and describe or explain what is in it.');

  const currentParts: Part[] = [];
  if (imagePart) {
    currentParts.push(imagePart);
  }
  currentParts.push({ text: effectiveText });

  const attempts: Array<{ model: string; useLowThinking: boolean; delayMs: number }> = [
    { model: 'gemini-4-hydrogen', useLowThinking: true, delayMs: 0 },
    { model: 'gemini-3.1-flash-lite', useLowThinking: false, delayMs: 0 },
    { model: 'gemini-3.1-flash-lite', useLowThinking: false, delayMs: 800 },
  ];

  let lastErr: unknown = null;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);

    try {
      const chat = ai.chats.create({
        model: attempt.model,
        history: chatHistory,
        config: {
          systemInstruction,
          abortSignal: controller.signal,
          ...(attempt.useLowThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      });

      const response = await chat.sendMessage({
        message: currentParts,
      });

      clearTimeout(timer);
      res.json({
        reply: response.text || 'I could not generate a response. Please try again.',
      });
      return;
    } catch (err: unknown) {
      clearTimeout(timer);
      lastErr = err;
      console.warn(`RubGPT (${attempt.model}) error:`, extractStatusAndMessage(err).message);
      if (!isRetryableOverload(err)) {
        break;
      }
    }
  }

  console.error('RubGPT API Error after fallback:', lastErr);
  const info = extractStatusAndMessage(lastErr);
  if (isRetryableOverload(lastErr)) {
    res.status(503).json({
      error:
        language === 'om'
          ? 'Tajaajilli AI yeroo ammaa baay’ee muddameera. Mee sekondii muraasa booda irra deebi’aa yaalaa.'
          : language === 'am'
          ? 'የAI አገልግሎቱ በአሁኑ ጊዜ በጣም ተጨናንቋል። እባክዎ ከጥቂት ሰከንዶች በኋላ እንደገና ይሞክሩ።'
          : 'RubGPT is temporarily busy due to high demand. Please wait a few seconds and try again.',
    });
    return;
  }

  res.status(500).json({
    error: info.message || 'Failed to reach RubGPT AI service.',
  });
});

// ==========================================
// Premium Subscription & RBAC Verification API
// ==========================================
const SUBSCRIPTION_OWNER_UID = 'aDB36ZT1j0QajDvQrMbkY1AGLSt2';
const SUBSCRIPTION_OWNER_EMAIL = 'ruubengirma@gmail.com';
const SUBSCRIPTION_DEFAULT_ADMIN_UID = 'FDMMAibEmPhiCh3eJZ0AXkkg0622';
const SUBSCRIPTION_DEFAULT_ADMIN_EMAIL = 'ruubewallagga@gmail.com';

function addCalendarMonthsUtc(startDate: Date, months: number): Date {
  const result = new Date(startDate.getTime());
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, daysInTargetMonth));
  return result;
}

async function fetchAdminEmailsWithUserToken(idToken: string): Promise<string[]> {
  try {
    const docUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/appConfig/roles`;
    const resp = await fetch(docUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!resp.ok) return [SUBSCRIPTION_DEFAULT_ADMIN_EMAIL];
    const data = (await resp.json()) as {
      fields?: {
        adminEmails?: { arrayValue?: { values?: Array<{ stringValue?: string }> } };
      };
    };
    const values = data.fields?.adminEmails?.arrayValue?.values || [];
    const list = values
      .map((v) => String(v.stringValue || '').trim().toLowerCase())
      .filter(Boolean);
    if (!list.includes(SUBSCRIPTION_DEFAULT_ADMIN_EMAIL)) {
      list.push(SUBSCRIPTION_DEFAULT_ADMIN_EMAIL);
    }
    return list;
  } catch {
    return [SUBSCRIPTION_DEFAULT_ADMIN_EMAIL];
  }
}

async function verifySubscriptionCaller(req: express.Request): Promise<
  | {
      ok: true;
      idToken: string;
      uid: string;
      email: string;
      emailVerified: boolean;
      role: 'owner' | 'admin' | 'user';
    }
  | { ok: false; status: number; error: string }
> {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return { ok: false, status: 401, error: 'Missing Firebase authentication token.' };
  }
  if (!adminReady) {
    return { ok: false, status: 503, error: 'Authentication verifier is not ready.' };
  }

  try {
    const decoded = await getAdminAuth(getApp()).verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    const emailVerified = Boolean(decoded.email_verified);
    const claimRole = String((decoded as Record<string, unknown>).role || '').trim().toLowerCase();
    const hasOwnerClaim =
      claimRole === 'owner' || (decoded as Record<string, unknown>).owner === true;
    const hasAdminClaim =
      claimRole === 'admin' || (decoded as Record<string, unknown>).admin === true;

    if (
      hasOwnerClaim ||
      decoded.uid === SUBSCRIPTION_OWNER_UID ||
      email === SUBSCRIPTION_OWNER_EMAIL
    ) {
      return {
        ok: true,
        idToken,
        uid: decoded.uid,
        email: email || SUBSCRIPTION_OWNER_EMAIL,
        emailVerified,
        role: 'owner',
      };
    }

    if (
      hasAdminClaim ||
      decoded.uid === SUBSCRIPTION_DEFAULT_ADMIN_UID ||
      email === SUBSCRIPTION_DEFAULT_ADMIN_EMAIL
    ) {
      return {
        ok: true,
        idToken,
        uid: decoded.uid,
        email: email || SUBSCRIPTION_DEFAULT_ADMIN_EMAIL,
        emailVerified,
        role: 'admin',
      };
    }

    if (!email) {
      return {
        ok: true,
        idToken,
        uid: decoded.uid,
        email,
        emailVerified,
        role: 'user',
      };
    }

    const adminEmails = await fetchAdminEmailsWithUserToken(idToken);
    if (adminEmails.includes(email)) {
      return {
        ok: true,
        idToken,
        uid: decoded.uid,
        email,
        emailVerified,
        role: 'admin',
      };
    }

    return {
      ok: true,
      idToken,
      uid: decoded.uid,
      email,
      emailVerified,
      role: 'user',
    };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: err instanceof Error ? err.message : 'Invalid or expired Firebase ID token.',
    };
  }
}

app.post('/api/subscription/role', async (req, res) => {
  const verified = await verifySubscriptionCaller(req);
  if (!verified.ok) {
    res.status(verified.status).json({ error: verified.error });
    return;
  }
  res.json({
    uid: verified.uid,
    email: verified.email,
    emailVerified: verified.emailVerified,
    role: verified.role,
  });
});

app.post('/api/subscription/authorize-review', async (req, res) => {
  const verified = await verifySubscriptionCaller(req);
  if (!verified.ok) {
    res.status(verified.status).json({ error: verified.error });
    return;
  }
  if (verified.role !== 'owner' && verified.role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden: Only verified Owner or Admin accounts can approve or reject payments.',
    });
    return;
  }

  const paymentId = String(req.body?.paymentId || '').trim();
  const decision = String(req.body?.decision || '').trim().toUpperCase();
  const durationMonths = Number(req.body?.durationMonths || 0);

  if (!paymentId || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
    res.status(400).json({ error: 'Invalid paymentId or decision.' });
    return;
  }
  if (decision === 'APPROVED' && (!Number.isFinite(durationMonths) || durationMonths < 1 || durationMonths > 60)) {
    res.status(400).json({ error: 'Invalid subscription duration months.' });
    return;
  }

  // Server-side state check against live Firestore document using the caller's verified token
  let targetUserId = '';
  try {
    const reqUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/premium_payment_requests/${encodeURIComponent(paymentId)}`;
    const docResp = await fetch(reqUrl, {
      headers: { Authorization: `Bearer ${verified.idToken}` },
    });
    if (!docResp.ok) {
      res.status(404).json({ error: 'Payment request not found or inaccessible.' });
      return;
    }
    const docJson = (await docResp.json()) as {
      fields?: {
        status?: { stringValue?: string };
        userId?: { stringValue?: string };
      };
    };
    const currentStatus = (docJson.fields?.status?.stringValue || '').toLowerCase();
    if (currentStatus !== 'pending') {
      res.status(409).json({
        error: `This payment has already been ${currentStatus || 'processed'}.`,
      });
      return;
    }
    targetUserId = String(docJson.fields?.userId?.stringValue || '').trim();
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unable to validate payment request state.',
    });
    return;
  }

  const now = new Date();
  let startDate = now.toISOString();
  let expiresDate =
    decision === 'APPROVED' ? addCalendarMonthsUtc(now, durationMonths) : now;

  // Check existing subscription to calculate renewal extension from existing expiry date without shortening remaining time
  if (decision === 'APPROVED' && targetUserId) {
    try {
      const subUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/subscriptions/${encodeURIComponent(targetUserId)}`;
      const subResp = await fetch(subUrl, {
        headers: { Authorization: `Bearer ${verified.idToken}` },
      });
      if (subResp.ok) {
        const subJson = (await subResp.json()) as { fields?: Record<string, any> };
        const f = subJson.fields || {};
        const prevApprovedPayId = String(f.approvedPaymentId?.stringValue || f.paymentId?.stringValue || '');
        if (prevApprovedPayId && prevApprovedPayId === paymentId) {
          res.status(409).json({
            error: 'Duplicate activation blocked: this payment has already activated a subscription.',
          });
          return;
        }
        const prevStatus = String(f.status?.stringValue || '');
        const prevExpiryMs = Number(f.expiresAtMs?.integerValue || f.expiresAtMs?.doubleValue || 0);
        if (prevStatus === 'active' && prevExpiryMs > now.getTime()) {
          expiresDate = addCalendarMonthsUtc(new Date(prevExpiryMs), durationMonths);
          const prevStart = String(f.premiumStartDate?.stringValue || f.startDate?.stringValue || '');
          if (prevStart) {
            startDate = prevStart;
          }
        }
      }
    } catch {
      // ignore read failure and let transaction verify atomically
    }
  }

  res.json({
    authorized: true,
    role: verified.role,
    reviewerUid: verified.uid,
    reviewerEmail: verified.email,
    reviewedAt: now.toISOString(),
    startDate,
    expiresAt: expiresDate.toISOString(),
    expiresAtMs: expiresDate.getTime(),
  });
});

app.post('/api/subscription/authorize-owner-config', async (req, res) => {
  const verified = await verifySubscriptionCaller(req);
  if (!verified.ok) {
    res.status(verified.status).json({ error: verified.error });
    return;
  }
  if (verified.role !== 'owner') {
    res.status(403).json({
      error: 'Forbidden: Only the Owner can modify pricing, bank accounts, Binance settings, or Admin roles.',
    });
    return;
  }
  res.json({
    authorized: true,
    role: 'owner',
    ownerEmail: verified.email,
    updatedAt: new Date().toISOString(),
  });
});

const SUBSCRIPTION_DAY_MS = 24 * 60 * 60 * 1000;

function readRestString(fields: Record<string, any>, key: string): string {
  return String(fields?.[key]?.stringValue || '');
}

function readRestNumber(fields: Record<string, any>, key: string): number {
  const f = fields?.[key];
  if (!f) return 0;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return Number(f.doubleValue);
  return 0;
}

async function patchFirestoreRestDoc(
  docPath: string,
  fields: Record<string, any>,
  bearerToken?: string
): Promise<boolean> {
  const fieldPaths = Object.keys(fields);
  const queryParams = fieldPaths
    .map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`)
    .join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/${docPath}?${queryParams}${!bearerToken && firebaseApiKey ? `&key=${firebaseApiKey}` : ''}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify({ fields }),
  });
  return resp.ok;
}

async function createFirestoreRestDocIfAbsent(
  collectionPath: string,
  docId: string,
  fields: Record<string, any>,
  bearerToken?: string
): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/${collectionPath}/${encodeURIComponent(docId)}?currentDocument.exists=false${!bearerToken && firebaseApiKey ? `&key=${firebaseApiKey}` : ''}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify({ fields }),
  });
  return resp.ok;
}

async function processSubscriptionLifecycleRecord(params: {
  userId: string;
  username: string;
  packageLabel: string;
  status: string;
  expiresAtIso: string;
  expiresAtMs: number;
  paymentId: string;
  reminder7dPaymentId: string;
  reminder1dPaymentId: string;
  expiredNotifPaymentId: string;
  nowMs: number;
  actorUid: string;
  actorEmail: string;
  actorRole: 'owner' | 'admin';
  bearerToken?: string;
}): Promise<'expired' | 'reminded_7d' | 'reminded_1d' | 'unchanged'> {
  const {
    userId,
    username,
    packageLabel,
    status,
    expiresAtIso,
    expiresAtMs,
    paymentId,
    reminder7dPaymentId,
    reminder1dPaymentId,
    expiredNotifPaymentId,
    nowMs,
    actorUid,
    actorEmail,
    actorRole,
    bearerToken,
  } = params;

  if (status !== 'active' || !expiresAtMs || !userId) return 'unchanged';

  const safePayId = (paymentId || 'sub').replace(/[^a-zA-Z0-9_-]/g, '_');
  const nowIso = new Date(nowMs).toISOString();

  if (expiresAtMs <= nowMs) {
    const updatedSub = await patchFirestoreRestDoc(
      `subscriptions/${encodeURIComponent(userId)}`,
      {
        status: { stringValue: 'expired' },
        premiumStatus: { stringValue: 'expired' },
        expiredAt: { stringValue: nowIso },
        expiredNotifPaymentId: { stringValue: safePayId },
        updatedAt: { stringValue: nowIso },
      },
      bearerToken
    );

    if (!updatedSub) return 'unchanged';

    await patchFirestoreRestDoc(
      `users/${encodeURIComponent(userId)}`,
      {
        isPremium: { booleanValue: false },
        goldVerified: { booleanValue: false },
        subscriptionStatus: { stringValue: 'expired' },
        premiumStatus: { stringValue: 'expired' },
        updatedAt: { stringValue: nowIso },
      },
      bearerToken
    ).catch(() => {});

    const logId = `log_exp_${userId.slice(0, 12)}_${safePayId.slice(0, 24)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    await createFirestoreRestDocIfAbsent(
      'paymentAuditLogs',
      logId,
      {
        logId: { stringValue: logId },
        action: { stringValue: 'SUBSCRIPTION_EXPIRED' },
        paymentId: { stringValue: paymentId },
        targetUserId: { stringValue: userId },
        targetUsername: { stringValue: username || 'user' },
        actorUserId: { stringValue: actorUid },
        actorEmail: { stringValue: actorEmail },
        actorRole: { stringValue: actorRole },
        details: {
          stringValue: `Auto-expired ${packageLabel} subscription after ${expiresAtIso}`,
        },
        createdAt: { stringValue: nowIso },
      },
      bearerToken
    ).catch(() => {});

    if (expiredNotifPaymentId !== safePayId) {
      const notifId = `notif_sub_expired_${safePayId}`;
      await createFirestoreRestDocIfAbsent(
        'notifications',
        notifId,
        {
          notificationId: { stringValue: notifId },
          recipientId: { stringValue: userId },
          actorId: { stringValue: actorUid },
          actorUsername: { stringValue: actorRole },
          actorDisplayName: { stringValue: 'Ethio Chat Premium' },
          type: { stringValue: 'subscription' },
          text: {
            stringValue: `Your ${packageLabel} Premium subscription has expired and your Gold Verified Badge has been removed. Renew anytime in Settings > Subscription.`,
          },
          read: { booleanValue: false },
          createdAt: { stringValue: nowIso },
        },
        bearerToken
      ).catch(() => {});
    }

    return 'expired';
  }

  const remainingMs = expiresAtMs - nowMs;
  if (remainingMs <= SUBSCRIPTION_DAY_MS && reminder1dPaymentId !== safePayId) {
    const notifId = `notif_sub_1d_${safePayId}`;
    await createFirestoreRestDocIfAbsent(
      'notifications',
      notifId,
      {
        notificationId: { stringValue: notifId },
        recipientId: { stringValue: userId },
        actorId: { stringValue: actorUid },
        actorUsername: { stringValue: actorRole },
        actorDisplayName: { stringValue: 'Ethio Chat Premium' },
        type: { stringValue: 'subscription' },
        text: {
          stringValue: `Reminder: Your ${packageLabel} Premium subscription expires in less than 1 day. Renew now to keep your Gold Verified Badge without interruption.`,
        },
        read: { booleanValue: false },
        createdAt: { stringValue: nowIso },
      },
      bearerToken
    ).catch(() => {});

    await patchFirestoreRestDoc(
      `subscriptions/${encodeURIComponent(userId)}`,
      {
        reminder1dPaymentId: { stringValue: safePayId },
        updatedAt: { stringValue: nowIso },
      },
      bearerToken
    ).catch(() => {});
    return 'reminded_1d';
  }

  if (
    remainingMs > SUBSCRIPTION_DAY_MS &&
    remainingMs <= 7 * SUBSCRIPTION_DAY_MS &&
    reminder7dPaymentId !== safePayId
  ) {
    const daysLeft = Math.ceil(remainingMs / SUBSCRIPTION_DAY_MS);
    const notifId = `notif_sub_7d_${safePayId}`;
    await createFirestoreRestDocIfAbsent(
      'notifications',
      notifId,
      {
        notificationId: { stringValue: notifId },
        recipientId: { stringValue: userId },
        actorId: { stringValue: actorUid },
        actorUsername: { stringValue: actorRole },
        actorDisplayName: { stringValue: 'Ethio Chat Premium' },
        type: { stringValue: 'subscription' },
        text: {
          stringValue: `Reminder: Your ${packageLabel} Premium subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew early to extend from your current expiry date.`,
        },
        read: { booleanValue: false },
        createdAt: { stringValue: nowIso },
      },
      bearerToken
    ).catch(() => {});

    await patchFirestoreRestDoc(
      `subscriptions/${encodeURIComponent(userId)}`,
      {
        reminder7dPaymentId: { stringValue: safePayId },
        updatedAt: { stringValue: nowIso },
      },
      bearerToken
    ).catch(() => {});
    return 'reminded_7d';
  }

  return 'unchanged';
}

app.post('/api/subscription/sync-lifecycle', async (req, res) => {
  const verified = await verifySubscriptionCaller(req);
  if (!verified.ok) {
    res.status(verified.status).json({ error: verified.error });
    return;
  }
  if (verified.role !== 'owner' && verified.role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden: Only Owner or Admin can run subscription lifecycle synchronization.',
    });
    return;
  }

  // Optional date simulation strictly for Owner-controlled test user verification
  const rawSimIso = req.body?.simulateNowIso ? String(req.body.simulateNowIso) : '';
  const targetUserId = req.body?.targetUserId ? String(req.body.targetUserId).trim() : '';
  let effectiveNowMs = Date.now();
  if (rawSimIso) {
    if (verified.role !== 'owner' || !targetUserId) {
      res.status(403).json({
        error: 'Date simulation requires Owner role and a specific targetUserId.',
      });
      return;
    }
    const parsedSim = new Date(rawSimIso).getTime();
    if (!Number.isFinite(parsedSim)) {
      res.status(400).json({ error: 'Invalid simulateNowIso timestamp.' });
      return;
    }
    effectiveNowMs = parsedSim;
  }

  try {
    const docs: Array<{ name: string; fields?: Record<string, any> }> = [];
    if (targetUserId) {
      const oneUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/subscriptions/${encodeURIComponent(targetUserId)}`;
      const oneResp = await fetch(oneUrl, {
        headers: { Authorization: `Bearer ${verified.idToken}` },
      });
      if (oneResp.ok) {
        docs.push((await oneResp.json()) as { name: string; fields?: Record<string, any> });
      }
    } else {
      const listUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/subscriptions?pageSize=300`;
      const listResp = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${verified.idToken}` },
      });
      if (!listResp.ok) {
        const errText = await listResp.text();
        res.status(listResp.status).json({ error: errText || 'Unable to query subscriptions.' });
        return;
      }
      const listJson = (await listResp.json()) as {
        documents?: Array<{ name: string; fields?: Record<string, any> }>;
      };
      if (Array.isArray(listJson.documents)) {
        docs.push(...listJson.documents);
      }
    }

    let expiredCount = 0;
    let reminded7dCount = 0;
    let reminded1dCount = 0;

    for (const d of docs) {
      const f = d.fields || {};
      const uid = readRestString(f, 'userId') || d.name.split('/').pop() || '';
      const expiresAtIso = readRestString(f, 'premiumExpiryDate') || readRestString(f, 'expiresAt');
      const expiresAtMs =
        readRestNumber(f, 'expiresAtMs') ||
        (expiresAtIso ? new Date(expiresAtIso).getTime() : 0);

      const outcome = await processSubscriptionLifecycleRecord({
        userId: uid,
        username: readRestString(f, 'username') || 'user',
        packageLabel: readRestString(f, 'packageLabel') || 'Premium',
        status: readRestString(f, 'status'),
        expiresAtIso,
        expiresAtMs,
        paymentId: readRestString(f, 'approvedPaymentId') || readRestString(f, 'paymentId'),
        reminder7dPaymentId: readRestString(f, 'reminder7dPaymentId'),
        reminder1dPaymentId: readRestString(f, 'reminder1dPaymentId'),
        expiredNotifPaymentId: readRestString(f, 'expiredNotifPaymentId'),
        nowMs: effectiveNowMs,
        actorUid: verified.uid,
        actorEmail: verified.email,
        actorRole: verified.role,
        bearerToken: verified.idToken,
      });

      if (outcome === 'expired') expiredCount += 1;
      else if (outcome === 'reminded_7d') reminded7dCount += 1;
      else if (outcome === 'reminded_1d') reminded1dCount += 1;
    }

    res.json({
      ok: true,
      checked: docs.length,
      expiredCount,
      reminded7dCount,
      reminded1dCount,
      evaluatedAt: new Date(effectiveNowMs).toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Subscription lifecycle sync failed.',
    });
  }
});

// 9. Send Firebase Cloud Messaging (FCM) Push Notification for calls, messages, comments & @mentions
app.post('/api/notifications/send-push', async (req, res) => {
  if (!adminReady) {
    res.status(200).json({ ok: false, reason: 'FIREBASE_ADMIN_UNAVAILABLE' });
    return;
  }

  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  let callerUid = '';
  try {
    const decoded = await getAdminAuth(getApp()).verifyIdToken(idToken);
    callerUid = decoded.uid;
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid or expired authentication token.' });
    return;
  }

  const notifType = String(req.body?.type || 'mention').trim().slice(0, 24);
  const toUserId = String(req.body?.toUserId || '').trim();
  const postId = String(req.body?.postId || '').trim();
  const commentId = String(req.body?.commentId || '').trim();
  const chatId = String(req.body?.chatId || '').trim();
  const callId = String(req.body?.callId || '').trim();
  const fromUsername = String(req.body?.fromUsername || 'member').trim().slice(0, 50);
  const titleText = String(req.body?.title || 'Ethio Chat').trim().slice(0, 80);
  const defaultBody =
    notifType === 'call'
      ? `Incoming call from @${fromUsername}`
      : notifType === 'message'
      ? `@${fromUsername} sent you a message`
      : notifType === 'comment'
      ? `@${fromUsername} commented on your post`
      : `@${fromUsername} mentioned you`;
  const bodyText = String(req.body?.text || defaultBody).trim().slice(0, 240);

  if (!toUserId || (!postId && !chatId && !callId)) {
    res.status(400).json({ ok: false, error: 'toUserId and a target ID are required.' });
    return;
  }
  if (toUserId === callerUid) {
    res.json({ ok: true, sentCount: 0, skippedSelf: true });
    return;
  }

  try {
    const tokens: Array<{ tokenId: string; token: string }> = [];

    try {
      if (adminCredentialsAvailable) {
        const adminDb = getAdminFirestore(getApp(), firestoreDatabaseId);
        const snap = await adminDb
          .collection('users')
          .doc(toUserId)
          .collection('fcmTokens')
          .limit(20)
          .get();
        snap.forEach((d) => {
          const t = String(d.data()?.token || '').trim();
          if (t) tokens.push({ tokenId: d.id, token: t });
        });
      } else {
        throw new Error('NO_ADMIN_CREDENTIALS');
      }
    } catch {
      const listUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/users/${encodeURIComponent(toUserId)}/fcmTokens?pageSize=20${firebaseApiKey ? `&key=${firebaseApiKey}` : ''}`;
      const r = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${idToken}` },
      }).catch(() => null);
      if (r && r.ok) {
        const json = (await r.json()) as { documents?: Array<{ name: string; fields?: Record<string, any> }> };
        for (const docItem of json.documents || []) {
          const t = String(docItem.fields?.token?.stringValue || '').trim();
          const docId = docItem.name.split('/').pop() || '';
          if (t && docId) tokens.push({ tokenId: docId, token: t });
        }
      }
    }

    if (tokens.length === 0) {
      res.json({ ok: true, sentCount: 0, reason: 'NO_FCM_TOKENS' });
      return;
    }

    if (!adminCredentialsAvailable) {
      res.status(200).json({ ok: false, reason: 'FCM_CREDENTIALS_UNAVAILABLE' });
      return;
    }

    const appOrigin = (process.env.APP_URL || '').replace(/\/+$/, '');
    let relativePath = '/';
    if (callId) {
      relativePath = `/?call=${encodeURIComponent(callId)}`;
    } else if (postId) {
      relativePath = `/?post=${encodeURIComponent(postId)}${commentId ? `&comment=${encodeURIComponent(commentId)}` : ''}`;
    } else if (chatId) {
      relativePath = `/?chat=${encodeURIComponent(chatId)}`;
    }
    const fullLink = appOrigin ? `${appOrigin}${relativePath}` : relativePath;

    const dataPayload: Record<string, string> = {
      type: notifType,
      fromUsername,
      title: titleText,
      body: bodyText,
      url: relativePath,
      ...(postId ? { postId } : {}),
      ...(commentId ? { commentId } : {}),
      ...(chatId ? { chatId } : {}),
      ...(callId ? { callId } : {}),
    };

    const result = await getAdminMessaging(getApp()).sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: {
        title: titleText,
        body: bodyText,
      },
      data: dataPayload,
      webpush: {
        headers: {
          Urgency: notifType === 'call' ? 'high' : 'normal',
        },
        fcmOptions: {
          link: fullLink,
        },
        notification: {
          title: titleText,
          body: bodyText,
          icon: '/assets/aistudio/20261111_152710_57efcc53.png',
          requireInteraction: notifType === 'call',
        },
      },
    });

    // Clean up expired or unregistered FCM tokens safely
    const adminDb = getAdminFirestore(getApp(), firestoreDatabaseId);
    result.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const code = String(resp.error?.code || '');
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token')
        ) {
          const tokenId = tokens[idx]?.tokenId;
          if (tokenId) {
            adminDb
              .collection('users')
              .doc(toUserId)
              .collection('fcmTokens')
              .doc(tokenId)
              .delete()
              .catch(() => {});
          }
        }
      }
    });

    res.json({
      ok: true,
      sentCount: result.successCount,
      failureCount: result.failureCount,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      reason: err instanceof Error ? err.message : 'FCM_SEND_UNAVAILABLE',
    });
  }
});

// Background server-side expiration sweep (runs automatically when Firebase Admin Firestore IAM is enabled)
let adminFirestoreUnavailable = false;
async function runBackgroundAdminLifecycleSweep() {
  if (!adminReady || !adminCredentialsAvailable || adminFirestoreUnavailable) return;
  try {
    const adminDb = getAdminFirestore(getApp(), firestoreDatabaseId);
    const snap = await adminDb
      .collection('subscriptions')
      .where('status', '==', 'active')
      .limit(300)
      .get();

    if (snap.empty) return;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    for (const subDoc of snap.docs) {
      const sub = subDoc.data() as Record<string, any>;
      const userId = String(sub.userId || subDoc.id);
      const packageLabel = String(sub.packageLabel || 'Premium');
      const expiresAtIso = String(sub.premiumExpiryDate || sub.expiresAt || '');
      const expiresAtMs =
        Number(sub.expiresAtMs || 0) ||
        (expiresAtIso ? new Date(expiresAtIso).getTime() : 0);
      if (!expiresAtMs) continue;

      const payId = String(sub.approvedPaymentId || sub.paymentId || 'sub').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

      if (expiresAtMs <= nowMs) {
        const batch = adminDb.batch();
        batch.update(subDoc.ref, {
          status: 'expired',
          premiumStatus: 'expired',
          expiredAt: nowIso,
          expiredNotifPaymentId: payId,
          updatedAt: nowIso,
        });
        batch.set(
          adminDb.collection('users').doc(userId),
          {
            isPremium: false,
            goldVerified: false,
            subscriptionStatus: 'expired',
            premiumStatus: 'expired',
            updatedAt: nowIso,
          },
          { merge: true }
        );
        const logId = `log_exp_${userId.slice(0, 12)}_${payId.slice(0, 24)}`;
        batch.set(
          adminDb.collection('paymentAuditLogs').doc(logId),
          {
            logId,
            action: 'SUBSCRIPTION_EXPIRED',
            paymentId: String(sub.paymentId || payId),
            targetUserId: userId,
            targetUsername: String(sub.username || 'user'),
            actorUserId: SUBSCRIPTION_OWNER_UID,
            actorEmail: SUBSCRIPTION_OWNER_EMAIL,
            actorRole: 'owner',
            details: `Server auto-expired ${packageLabel} subscription after ${expiresAtIso}`,
            createdAt: nowIso,
          },
          { merge: true }
        );
        if (sub.expiredNotifPaymentId !== payId) {
          const notifId = `notif_sub_expired_${payId}`;
          batch.set(
            adminDb.collection('notifications').doc(notifId),
            {
              notificationId: notifId,
              recipientId: userId,
              actorId: SUBSCRIPTION_OWNER_UID,
              actorUsername: 'owner',
              actorDisplayName: 'Ethio Chat Premium',
              type: 'subscription',
              text: `Your ${packageLabel} Premium subscription has expired and your Gold Verified Badge has been removed. Renew anytime in Settings > Subscription.`,
              read: false,
              createdAt: nowIso,
            },
            { merge: true }
          );
        }
        await batch.commit();
      } else {
        const remainingMs = expiresAtMs - nowMs;
        if (remainingMs <= SUBSCRIPTION_DAY_MS && sub.reminder1dPaymentId !== payId) {
          const notifId = `notif_sub_1d_${payId}`;
          await adminDb
            .collection('notifications')
            .doc(notifId)
            .set(
              {
                notificationId: notifId,
                recipientId: userId,
                actorId: SUBSCRIPTION_OWNER_UID,
                actorUsername: 'owner',
                actorDisplayName: 'Ethio Chat Premium',
                type: 'subscription',
                text: `Reminder: Your ${packageLabel} Premium subscription expires in less than 1 day. Renew now to keep your Gold Verified Badge without interruption.`,
                read: false,
                createdAt: nowIso,
              },
              { merge: true }
            );
          await subDoc.ref.update({
            reminder1dPaymentId: payId,
            updatedAt: nowIso,
          });
        } else if (
          remainingMs > SUBSCRIPTION_DAY_MS &&
          remainingMs <= 7 * SUBSCRIPTION_DAY_MS &&
          sub.reminder7dPaymentId !== payId
        ) {
          const daysLeft = Math.ceil(remainingMs / SUBSCRIPTION_DAY_MS);
          const notifId = `notif_sub_7d_${payId}`;
          await adminDb
            .collection('notifications')
            .doc(notifId)
            .set(
              {
                notificationId: notifId,
                recipientId: userId,
                actorId: SUBSCRIPTION_OWNER_UID,
                actorUsername: 'owner',
                actorDisplayName: 'Ethio Chat Premium',
                type: 'subscription',
                text: `Reminder: Your ${packageLabel} Premium subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew early to extend from your current expiry date.`,
                read: false,
                createdAt: nowIso,
              },
              { merge: true }
            );
          await subDoc.ref.update({
            reminder7dPaymentId: payId,
            updatedAt: nowIso,
          });
        }
      }
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('NO_ADC_FOUND') ||
      msg.includes('Could not load the default credentials') ||
      err?.code === 7
    ) {
      // Quietly disable background Admin SDK sweep when SA/ADC credentials or Datastore IAM are unavailable
      adminFirestoreUnavailable = true;
      adminCredentialsAvailable = false;
    }
  }
}

async function startServer() {
  const httpServer = http.createServer(app);

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, app: 'Ethio Chat', ts: Date.now() });
  });

  app.get('/api/rtc-config', async (_req, res) => {
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
    const customUrls = readConfigValue('TURN_URLS');
    const customUser = readConfigValue('TURN_USERNAME');
    const customCred = readConfigValue('TURN_CREDENTIAL');
    if (customUrls) {
      const urls = customUrls.split(',').map((u) => u.trim()).filter(Boolean);
      if (urls.length > 0) {
        iceServers.push({
          urls,
          ...(customUser ? { username: customUser } : {}),
          ...(customCred ? { credential: customCred } : {}),
        });
      }
    }

    const meteredKey = readConfigValue('METERED_API_KEY');
    const meteredDomain = readConfigValue('METERED_DOMAIN');
    if (meteredKey && meteredDomain) {
      try {
        const resp = await fetch(`https://${meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredKey)}`);
        if (resp.ok) {
          const creds = await resp.json();
          if (Array.isArray(creds)) {
            iceServers.push(...creds);
          }
        }
      } catch {
        // fallback to client built-in TURN servers
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ iceServers });
  });

  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const candidates = [
      path.resolve(__dirname, 'dist', '.well-known', 'assetlinks.json'),
      path.resolve(__dirname, 'public', '.well-known', 'assetlinks.json'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
      res.status(404).json({ error: 'assetlinks.json not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(found);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr:
          process.env.DISABLE_HMR !== 'true'
            ? {
                server: httpServer,
              }
            : false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath, { dotfiles: 'allow' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Ethio Chat server running on http://0.0.0.0:${PORT}`);
    if (adminCredentialsAvailable) {
      setTimeout(() => {
        runBackgroundAdminLifecycleSweep().catch(() => {});
      }, 8000);
      setInterval(() => {
        runBackgroundAdminLifecycleSweep().catch(() => {});
      }, 5 * 60 * 1000);
    }

    const externalUrl = process.env.RENDER_EXTERNAL_URL?.trim();
    if (externalUrl) {
      const healthUrl = `${externalUrl.replace(/\/$/, '')}/api/health`;
      setInterval(() => {
        fetch(healthUrl).catch(() => {});
      }, 10 * 60 * 1000);
    }
  });

  // Real-Time WebRTC Signaling WebSocket for Team Live Voice/Video Stage
  interface LivePeerInfo {
    ws: WebSocket;
    teamId: string;
    userId: string;
    username: string;
    displayName: string;
    photoURL?: string;
    seatNumber: number | null;
    micMuted: boolean;
    cameraOn: boolean;
  }

  const teamLiveRooms = new Map<string, Map<string, LivePeerInfo>>();
  const wss = new WebSocketServer({ noServer: true });

  const broadcastToTeamRoom = (teamId: string, payload: Record<string, unknown>, excludeUserId?: string) => {
    const room = teamLiveRooms.get(teamId);
    if (!room) return;
    const raw = JSON.stringify(payload);
    for (const [uid, peer] of room.entries()) {
      if (excludeUserId && uid === excludeUserId) continue;
      if (peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(raw);
      }
    }
  };

  const getRoomPeersSnapshot = (teamId: string) => {
    const room = teamLiveRooms.get(teamId);
    if (!room) return [];
    return Array.from(room.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      photoURL: p.photoURL,
      seatNumber: p.seatNumber,
      micMuted: p.micMuted,
      cameraOn: p.cameraOn,
    }));
  };

  // Keep mobile & reverse-proxy WebSockets alive across idle periods
  const wsKeepAliveInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const tracked = client as WebSocket & { isAlive?: boolean };
      if (tracked.isAlive === false) {
        try {
          client.terminate();
        } catch {}
        return;
      }
      tracked.isAlive = false;
      try {
        client.ping();
      } catch {}
    });
  }, 25000);

  wss.on('close', () => {
    clearInterval(wsKeepAliveInterval);
  });

  wss.on('connection', (ws: WebSocket) => {
    const trackedWs = ws as WebSocket & { isAlive?: boolean };
    trackedWs.isAlive = true;
    ws.on('pong', () => {
      trackedWs.isAlive = true;
    });

    let joinedTeamId: string | null = null;
    let joinedUserId: string | null = null;

    ws.on('message', (data) => {
      trackedWs.isAlive = true;
      try {
        const msg = JSON.parse(String(data)) as Record<string, any>;
        const type = String(msg.type || '');

        if (type === 'join-room') {
          const teamId = String(msg.teamId || '');
          const userId = String(msg.userId || '');
          if (!teamId || !userId) return;

          joinedTeamId = teamId;
          joinedUserId = userId;

          let room = teamLiveRooms.get(teamId);
          if (!room) {
            room = new Map();
            teamLiveRooms.set(teamId, room);
          }

          const peerInfo: LivePeerInfo = {
            ws,
            teamId,
            userId,
            username: String(msg.username || 'member'),
            displayName: String(msg.displayName || 'Member'),
            photoURL: typeof msg.photoURL === 'string' ? msg.photoURL : undefined,
            seatNumber: typeof msg.seatNumber === 'number' ? msg.seatNumber : null,
            micMuted: Boolean(msg.micMuted),
            cameraOn: Boolean(msg.cameraOn),
          };
          const existingPeer = room.get(userId);
          if (existingPeer && existingPeer.ws !== ws) {
            try {
              existingPeer.ws.close();
            } catch {}
          }
          room.set(userId, peerInfo);

          // Send full current peer list back to joining client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'room-peers',
                teamId,
                peers: getRoomPeersSnapshot(teamId),
              })
            );
          }

          // Notify all other peers in the room
          broadcastToTeamRoom(
            teamId,
            {
              type: 'peer-joined',
              teamId,
              peer: {
                userId: peerInfo.userId,
                username: peerInfo.username,
                displayName: peerInfo.displayName,
                photoURL: peerInfo.photoURL,
                seatNumber: peerInfo.seatNumber,
                micMuted: peerInfo.micMuted,
                cameraOn: peerInfo.cameraOn,
              },
              peers: getRoomPeersSnapshot(teamId),
            },
            userId
          );
          return;
        }

        if (!joinedTeamId || !joinedUserId) return;
        const room = teamLiveRooms.get(joinedTeamId);
        if (!room) return;

        if (type === 'media-state') {
          const peer = room.get(joinedUserId);
          if (peer) {
            if (msg.seatNumber !== undefined) peer.seatNumber = msg.seatNumber;
            if (typeof msg.micMuted === 'boolean') peer.micMuted = msg.micMuted;
            if (typeof msg.cameraOn === 'boolean') peer.cameraOn = msg.cameraOn;
          }
          broadcastToTeamRoom(joinedTeamId, {
            type: 'media-state',
            teamId: joinedTeamId,
            userId: joinedUserId,
            seatNumber: peer?.seatNumber ?? null,
            micMuted: peer?.micMuted ?? false,
            cameraOn: peer?.cameraOn ?? false,
            peers: getRoomPeersSnapshot(joinedTeamId),
          });
          return;
        }

        if (
          type === 'webrtc-offer' ||
          type === 'webrtc-answer' ||
          type === 'webrtc-ice-candidate'
        ) {
          const toUserId = String(msg.toUserId || '');
          const targetPeer = room.get(toUserId);
          if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
            targetPeer.ws.send(
              JSON.stringify({
                ...msg,
                fromUserId: joinedUserId,
                teamId: joinedTeamId,
              })
            );
          }
          return;
        }

        if (type === 'leave-room') {
          room.delete(joinedUserId);
          broadcastToTeamRoom(joinedTeamId, {
            type: 'peer-left',
            teamId: joinedTeamId,
            userId: joinedUserId,
            peers: getRoomPeersSnapshot(joinedTeamId),
          });
          if (room.size === 0) teamLiveRooms.delete(joinedTeamId);
          joinedTeamId = null;
          joinedUserId = null;
        }
      } catch {
        // ignore malformed packets
      }
    });

    ws.on('close', () => {
      if (joinedTeamId && joinedUserId) {
        const room = teamLiveRooms.get(joinedTeamId);
        if (room) {
          const current = room.get(joinedUserId);
          if (current && current.ws === ws) {
            room.delete(joinedUserId);
            broadcastToTeamRoom(joinedTeamId, {
              type: 'peer-left',
              teamId: joinedTeamId,
              userId: joinedUserId,
              peers: getRoomPeersSnapshot(joinedTeamId),
            });
            if (room.size === 0) teamLiveRooms.delete(joinedTeamId);
          }
        }
      }
    });
  });

  // Real-Time WebSocket Audio + Video Media Relay (guarantees working calls & live stage on strict mobile NATs)
  const mediaRelayRooms = new Map<string, Map<string, WebSocket>>();
  const mediaRelayWss = new WebSocketServer({ noServer: true });

  const mediaRelayKeepAlive = setInterval(() => {
    mediaRelayWss.clients.forEach((client) => {
      const tracked = client as WebSocket & { isAlive?: boolean };
      if (tracked.isAlive === false) {
        try {
          client.terminate();
        } catch {}
        return;
      }
      tracked.isAlive = false;
      try {
        client.ping();
      } catch {}
    });
  }, 25000);

  mediaRelayWss.on('close', () => {
    clearInterval(mediaRelayKeepAlive);
  });

  mediaRelayWss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const trackedWs = ws as WebSocket & { isAlive?: boolean };
    trackedWs.isAlive = true;
    ws.on('pong', () => {
      trackedWs.isAlive = true;
    });

    let roomId = '';
    let userId = '';
    try {
      const parsed = new URL(req.url || '/ws/media-relay', 'http://localhost');
      roomId = String(parsed.searchParams.get('roomId') || '').trim().slice(0, 120);
      userId = String(parsed.searchParams.get('userId') || '').trim().slice(0, 80);
    } catch {
      roomId = '';
      userId = '';
    }

    if (!roomId || !userId) {
      ws.close();
      return;
    }

    let room = mediaRelayRooms.get(roomId);
    if (!room) {
      room = new Map();
      mediaRelayRooms.set(roomId, room);
    }
    const existing = room.get(userId);
    if (existing && existing !== ws) {
      try {
        existing.close();
      } catch {}
    }
    room.set(userId, ws);

    const userIdBuf = Buffer.from(userId, 'utf8');
    const idLenHeader = Buffer.from([Math.min(255, userIdBuf.length)]);

    ws.on('message', (data, isBinary) => {
      trackedWs.isAlive = true;
      const currentRoom = mediaRelayRooms.get(roomId);
      if (!currentRoom) return;

      if (isBinary) {
        const payloadBuf = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
        const framed = Buffer.concat([idLenHeader, userIdBuf.subarray(0, 255), payloadBuf]);
        for (const [peerId, peerWs] of currentRoom.entries()) {
          if (peerId === userId) continue;
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(framed, { binary: true });
          }
        }
        return;
      }

      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        const out = JSON.stringify({ ...msg, fromUserId: userId });
        for (const [peerId, peerWs] of currentRoom.entries()) {
          if (peerId === userId) continue;
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(out);
          }
        }
      } catch {
        // ignore malformed JSON
      }
    });

    ws.on('close', () => {
      const currentRoom = mediaRelayRooms.get(roomId);
      if (!currentRoom) return;
      if (currentRoom.get(userId) === ws) {
        currentRoom.delete(userId);
        if (currentRoom.size === 0) {
          mediaRelayRooms.delete(roomId);
        }
      }
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    if (reqUrl.startsWith('/ws/team-live')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (reqUrl.startsWith('/ws/media-relay')) {
      mediaRelayWss.handleUpgrade(request, socket, head, (ws) => {
        mediaRelayWss.emit('connection', ws, request);
      });
    }
  });
}

function isMissingAdcError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return (
    msg.includes('NO_ADC_FOUND') ||
    msg.includes('Could not load the default credentials') ||
    msg.includes('Unable to detect a Project Id')
  );
}

process.on('unhandledRejection', (reason) => {
  if (isMissingAdcError(reason)) {
    adminFirestoreUnavailable = true;
    adminCredentialsAvailable = false;
    console.warn('Firebase Admin ADC unavailable in this host environment; continuing with client/REST mode.');
    return;
  }
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  if (isMissingAdcError(err)) {
    adminFirestoreUnavailable = true;
    adminCredentialsAvailable = false;
    console.warn('Firebase Admin ADC unavailable in this host environment; continuing with client/REST mode.');
    return;
  }
  console.error('Uncaught exception:', err);
  process.exit(1);
});

startServer();
