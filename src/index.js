import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import VectorUser from './vectorModels/VectorUser.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import adminUsersRoutes from './routes/adminUsers.js';
import docsRoutes from './routes/docs.js';
import securityRoutes from './routes/security.js';
import vectorRoutes from './routes/vectorRoutes.js';
import vectorJobRoutes from './routes/vectorJobRoutes.js';
import printRoutes from './routes/printRoutes.js';
import { ipSecurity, checkLoginAttempts, checkIPWhitelist } from './middleware/ipSecurity.js';
import { startVectorPdfWorkers } from './workers/vectorPdfWorker.js';
import { startJobCleanupLoop } from './services/jobCleanup.js';
import { getVectorFlowProducer } from './workers/vectorPdfWorker.js';
import { spawn } from 'child_process';

// Load env from backend/.env (you can also point to project root if needed)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '900mb' }));
app.use(express.urlencoded({ extended: true, limit: '900mb' }));

app.use(ipSecurity);
app.use(checkLoginAttempts);

app.use('/api/auth', authRoutes);

app.use(checkIPWhitelist);
app.use('/api/security', securityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminUsersRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/vector', vectorRoutes);
app.use('/api/vector', vectorJobRoutes);
app.use('/api', printRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function ensureAdminUser() {
  const adminEmail = 'akshit@gmail.com';
  const adminPassword = 'akshit';

  // If the shared system already has users, do NOT seed a Vector admin.
  // Migration must preserve original _id values and relationships.
  const sharedUserCount = await mongoose.connection.db
    .collection('users')
    .estimatedDocumentCount()
    .catch(() => 0);
  if (sharedUserCount > 0) {
    return;
  }

  const existing = await VectorUser.findOne({ email: adminEmail.toLowerCase() });
  if (existing) {
    
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await VectorUser.create({
    email: adminEmail.toLowerCase(),
    passwordHash,
    role: 'admin',
  });

 
}

async function start() {
  try {
    const mongoUri =
      process.env.MONGO_URI ||
      'mongodb+srv://gajeraakshit53_db_user:lvbGcIFW0ul5Bao6@akshit.thyfwea.mongodb.net/securepdf?retryWrites=true&w=majority';

    if (!mongoUri) {
      console.error('MONGO_URI is not set in environment');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('[MongoDB] Connected successfully');

    // Test Redis connection
    try {
      const flowProducer = getVectorFlowProducer();
      if (flowProducer) {
        console.log('[Redis] BullMQ connected successfully');
      } else {
        console.warn('[Redis] BullMQ disabled - Redis unavailable');
      }
    } catch (redisErr) {
      console.warn('[Redis] Connection failed:', redisErr.message);
    }

    // Test Inkscape availability
    const inkscapeBin = process.env.INKSCAPE_BIN || 'inkscape';
    await new Promise((resolve, reject) => {
      const test = spawn(inkscapeBin, ['--version'], { stdio: 'pipe' });
      test.on('error', (err) => {
        if (err.code === 'ENOENT') {
          console.warn(`[Inkscape] Binary not found at "${inkscapeBin}". Install Inkscape or set INKSCAPE_BIN env var`);
        } else {
          console.warn('[Inkscape] Error:', err.message);
        }
        resolve();
      });
      test.on('exit', (code) => {
        if (code === 0) {
          console.log('[Inkscape] Available and working');
        } else {
          console.warn(`[Inkscape] Failed with exit code ${code}`);
        }
        resolve();
      });
      test.stdout?.on('data', (data) => {
        const version = data.toString().trim();
        if (version) console.log(`[Inkscape] Version: ${version}`);
      });
    });
   

    await ensureAdminUser();

    startVectorPdfWorkers();
    startJobCleanupLoop();

    const server = app.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);
    });

    // Handle low-level client connection errors like ECONNRESET gracefully
    server.on('clientError', (err, socket) => {
      if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
        try {
          socket.destroy();
        } catch (_) {
          // ignore
        }
        return;
      }

      console.error('HTTP client error:', err);
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      } catch (_) {
        // ignore
      }
    });
  } catch (err) {
    console.error('Failed to start backend', err);
    process.exit(1);
  }
}

start();
