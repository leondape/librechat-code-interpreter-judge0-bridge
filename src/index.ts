import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { config, validateConfig, isValidLanguage } from './config';
import { getStorage } from './storage';
import { getJudge0Client } from './judge0-client';
import { getMimeType } from './utils';
import type { ExecRequest, FileListItem, FileListItemSummary, UploadResponse } from './types';

// Validate configuration on startup
validateConfig();

const app = express();

// =============================================================================
// Middleware
// =============================================================================

// CORS - permissive defaults for backend-to-backend service
app.use(cors());

// JSON body parser
app.use(express.json({ limit: '50mb' }));

// Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSize },
});

/**
 * API Key authentication middleware
 */
function authenticate(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no API key is configured
  if (!config.librechatCodeApiKey) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey || apiKey !== config.librechatCodeApiKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  next();
}

/**
 * Request logging middleware
 */
function logRequest(req: Request, _res: Response, next: NextFunction): void {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
}

app.use(logRequest);

// =============================================================================
// Health Check Endpoint
// =============================================================================

app.get('/health', async (_req: Request, res: Response) => {
  const storage = getStorage();
  const judge0 = getJudge0Client();
  
  const judge0Health = await judge0.healthCheck();
  const storageStats = await storage.getStats();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    judge0: {
      url: config.judge0ApiUrl,
      healthy: judge0Health.healthy,
      version: judge0Health.version,
      error: judge0Health.error,
    },
    storage: {
      type: config.storageType,
      sessions: storageStats.sessionCount,
      files: storageStats.totalFiles,
      totalSize: storageStats.totalSize,
    },
  });
});

// =============================================================================
// POST /exec - Execute code
// =============================================================================

app.post('/exec', authenticate, async (req: Request, res: Response) => {
  try {
    const body = req.body as ExecRequest;

    // Validate required fields
    if (!body.lang) {
      res.status(400).json({ error: 'Missing required field: lang' });
      return;
    }

    if (!body.code) {
      res.status(400).json({ error: 'Missing required field: code' });
      return;
    }

    // Validate language
    if (!isValidLanguage(body.lang)) {
      res.status(400).json({ 
        error: `Unsupported language: ${body.lang}. Supported: py, js, ts, c, cpp, java, php, rs, go, d, f90, r` 
      });
      return;
    }

    // Execute via Judge0
    const judge0 = getJudge0Client();
    const result = await judge0.execute(body.lang, body.code, body.files, body.args);

    res.json(result);
  } catch (error) {
    console.error('[/exec] Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// =============================================================================
// POST /upload - Upload file to session
// =============================================================================

app.post('/upload', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const storage = getStorage();
    const entityId = req.body.entity_id as string | undefined;

    // Create a new session for the upload
    const sessionId = await storage.createSession();
    
    // Store the file
    const fileId = await storage.addFile(sessionId, req.file.originalname, req.file.buffer);

    const response: UploadResponse = {
      message: 'success',
      session_id: sessionId,
      files: [{
        fileId,
        filename: req.file.originalname,
      }],
    };

    // Log entity_id if provided (for tracking/debugging)
    if (entityId) {
      console.log(`[/upload] File uploaded for entity: ${entityId}`);
    }

    res.json(response);
  } catch (error) {
    console.error('[/upload] Error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// =============================================================================
// GET /files/:session_id - List files in session
// =============================================================================

app.get('/files/:session_id', authenticate, async (req: Request, res: Response) => {
  try {
    const { session_id } = req.params;
    const detail = req.query.detail as string || 'summary';

    const storage = getStorage();
    
    // Check if session exists
    if (!(await storage.isSessionValid(session_id))) {
      res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    const files = await storage.listFiles(session_id);

    if (detail === 'full') {
      // Full detail format expected by LibreChat
      const response: FileListItem[] = files.map(file => ({
        name: `${session_id}/${file.id}`,
        metadata: {
          'original-filename': file.name,
        },
        lastModified: file.lastModified,
      }));
      res.json(response);
    } else {
      // Summary format
      const response: FileListItemSummary[] = files.map(file => ({
        name: `${session_id}/${file.id}`,
        lastModified: file.lastModified,
      }));
      res.json(response);
    }
  } catch (error) {
    console.error('[/files] Error:', error);
    res.status(500).json({ 
      error: 'Failed to list files',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// =============================================================================
// GET /download/:session_id/:file_id - Download a file
// =============================================================================

app.get('/download/:session_id/:file_id', authenticate, async (req: Request, res: Response) => {
  try {
    const { session_id, file_id } = req.params;

    const storage = getStorage();
    const file = await storage.getFile(session_id, file_id);

    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const mimeType = getMimeType(file.name);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.setHeader('Content-Length', file.size);
    res.send(file.data);
  } catch (error) {
    console.error('[/download] Error:', error);
    res.status(500).json({ 
      error: 'Download failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// =============================================================================
// 404 Handler
// =============================================================================

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// =============================================================================
// Error Handler
// =============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// =============================================================================
// Start Server
// =============================================================================

const server = app.listen(config.port, config.host, () => {
  console.log('='.repeat(60));
  console.log('Judge0-LibreChat Bridge');
  console.log('='.repeat(60));
  console.log(`Server:     http://${config.host}:${config.port}`);
  console.log(`Judge0:     ${config.judge0ApiUrl}`);
  console.log(`Storage:    ${config.storageType}`);
  console.log(`Auth:       ${config.librechatCodeApiKey ? 'Enabled' : 'Disabled'}`);
  console.log('='.repeat(60));
  console.log('Endpoints:');
  console.log('  POST /exec           - Execute code');
  console.log('  POST /upload         - Upload file');
  console.log('  GET  /files/:sid     - List session files');
  console.log('  GET  /download/:s/:f - Download file');
  console.log('  GET  /health         - Health check');
  console.log('='.repeat(60));
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down...`);
  const storage = getStorage();
  await storage.destroy();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

