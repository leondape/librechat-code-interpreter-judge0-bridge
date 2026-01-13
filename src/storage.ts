import { nanoid } from 'nanoid';
import Redis from 'ioredis';
import type { Session, StoredFile, SessionStorage } from './types';
import { config } from './config';

/**
 * In-memory session storage implementation
 * Stores sessions and files in memory with TTL-based expiration
 */
export class MemoryStorage implements SessionStorage {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Create a new session and return its ID
   */
  async createSession(): Promise<string> {
    const id = nanoid();
    const now = new Date();
    
    const session: Session = {
      id,
      files: new Map(),
      createdAt: now,
      lastAccessedAt: now,
    };
    
    this.sessions.set(id, session);
    return id;
  }

  /**
   * Get a session by ID, updating last accessed time
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check if session has expired
    if (!(await this.isSessionValid(sessionId))) {
      this.sessions.delete(sessionId);
      return null;
    }
    
    // Update last accessed time
    session.lastAccessedAt = new Date();
    return session;
  }

  /**
   * Add a file to a session
   * Creates session if it doesn't exist
   * Returns the file ID
   */
  async addFile(sessionId: string, name: string, data: Buffer): Promise<string> {
    let session = await this.getSession(sessionId);
    
    // Create session if it doesn't exist
    if (!session) {
      // Use the provided sessionId instead of generating a new one
      const now = new Date();
      session = {
        id: sessionId,
        files: new Map(),
        createdAt: now,
        lastAccessedAt: now,
      };
      this.sessions.set(sessionId, session);
    }
    
    const fileId = nanoid();
    const storedFile: StoredFile = {
      id: fileId,
      name,
      data,
      size: data.length,
      createdAt: new Date(),
    };
    
    session.files.set(fileId, storedFile);
    return fileId;
  }

  /**
   * Get a file from a session
   */
  async getFile(sessionId: string, fileId: string): Promise<StoredFile | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    
    return session.files.get(fileId) || null;
  }

  /**
   * List all files in a session
   */
  async listFiles(sessionId: string): Promise<Array<{ id: string; name: string; size: number; lastModified: string }>> {
    const session = await this.getSession(sessionId);
    if (!session) return [];
    
    const files: Array<{ id: string; name: string; size: number; lastModified: string }> = [];
    
    for (const [, file] of session.files) {
      files.push({
        id: file.id,
        name: file.name,
        size: file.size,
        lastModified: file.createdAt.toISOString(),
      });
    }
    
    return files;
  }

  /**
   * Check if a session is still valid (not expired)
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    const now = Date.now();
    const lastAccessed = session.lastAccessedAt.getTime();
    
    return (now - lastAccessed) < config.sessionExpiryMs;
  }

  /**
   * Remove expired sessions
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.sessions) {
      const lastAccessed = session.lastAccessedAt.getTime();
      if ((now - lastAccessed) >= config.sessionExpiryMs) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Storage] Cleaned up ${cleaned} expired session(s)`);
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ sessionCount: number; totalFiles: number; totalSize: number }> {
    let totalFiles = 0;
    let totalSize = 0;
    
    for (const [, session] of this.sessions) {
      totalFiles += session.files.size;
      for (const [, file] of session.files) {
        totalSize += file.size;
      }
    }
    
    return {
      sessionCount: this.sessions.size,
      totalFiles,
      totalSize,
    };
  }
}

/**
 * Redis session storage implementation
 * Stores sessions and files in Redis with TTL-based expiration
 * 
 * Key structure:
 *   session:{sessionId}        → Hash { createdAt, lastAccessedAt }
 *   session:{sessionId}:files  → Hash { fileId → JSON metadata }
 *   file:{sessionId}:{fileId}  → String (base64 encoded binary data)
 */
export class RedisStorage implements SessionStorage {
  private redis: Redis;
  private ttlSeconds: number;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.ttlSeconds = Math.floor(config.sessionExpiryMs / 1000);
    
    this.redis.on('connect', () => {
      console.log('[Storage] Connected to Redis');
    });
    
    this.redis.on('error', (err) => {
      console.error('[Storage] Redis error:', err.message);
    });
  }

  /**
   * Get the session key for Redis
   */
  private sessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  /**
   * Get the files hash key for Redis
   */
  private filesKey(sessionId: string): string {
    return `session:${sessionId}:files`;
  }

  /**
   * Get the file data key for Redis
   */
  private fileDataKey(sessionId: string, fileId: string): string {
    return `file:${sessionId}:${fileId}`;
  }

  /**
   * Refresh TTL on all session-related keys
   */
  private async refreshTTL(sessionId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.expire(this.sessionKey(sessionId), this.ttlSeconds);
    pipeline.expire(this.filesKey(sessionId), this.ttlSeconds);
    await pipeline.exec();
  }

  /**
   * Create a new session and return its ID
   */
  async createSession(): Promise<string> {
    const id = nanoid();
    const now = new Date().toISOString();
    
    await this.redis.hset(this.sessionKey(id), {
      id,
      createdAt: now,
      lastAccessedAt: now,
    });
    await this.redis.expire(this.sessionKey(id), this.ttlSeconds);
    
    return id;
  }

  /**
   * Get a session by ID, updating last accessed time
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const sessionData = await this.redis.hgetall(this.sessionKey(sessionId));
    
    if (!sessionData || !sessionData.id) {
      return null;
    }
    
    // Update last accessed time
    const now = new Date();
    await this.redis.hset(this.sessionKey(sessionId), 'lastAccessedAt', now.toISOString());
    await this.refreshTTL(sessionId);
    
    // Get files metadata
    const filesData = await this.redis.hgetall(this.filesKey(sessionId));
    const files = new Map<string, StoredFile>();
    
    for (const [fileId, metadataJson] of Object.entries(filesData)) {
      try {
        const metadata = JSON.parse(metadataJson);
        // File data is loaded lazily via getFile()
        files.set(fileId, {
          id: fileId,
          name: metadata.name,
          data: Buffer.alloc(0), // Placeholder, actual data loaded by getFile
          size: metadata.size,
          createdAt: new Date(metadata.createdAt),
        });
      } catch {
        // Skip invalid entries
      }
    }
    
    return {
      id: sessionData.id,
      files,
      createdAt: new Date(sessionData.createdAt),
      lastAccessedAt: now,
    };
  }

  /**
   * Add a file to a session
   * Creates session if it doesn't exist
   * Returns the file ID
   */
  async addFile(sessionId: string, name: string, data: Buffer): Promise<string> {
    // Ensure session exists
    const exists = await this.redis.exists(this.sessionKey(sessionId));
    if (!exists) {
      const now = new Date().toISOString();
      await this.redis.hset(this.sessionKey(sessionId), {
        id: sessionId,
        createdAt: now,
        lastAccessedAt: now,
      });
    }
    
    const fileId = nanoid();
    const now = new Date();
    
    // Store file metadata in the files hash
    const metadata = {
      name,
      size: data.length,
      createdAt: now.toISOString(),
    };
    await this.redis.hset(this.filesKey(sessionId), fileId, JSON.stringify(metadata));
    
    // Store file data as base64
    await this.redis.set(this.fileDataKey(sessionId, fileId), data.toString('base64'));
    await this.redis.expire(this.fileDataKey(sessionId, fileId), this.ttlSeconds);
    
    // Refresh TTL on session keys
    await this.refreshTTL(sessionId);
    
    return fileId;
  }

  /**
   * Get a file from a session
   */
  async getFile(sessionId: string, fileId: string): Promise<StoredFile | null> {
    // Check if session exists
    const exists = await this.redis.exists(this.sessionKey(sessionId));
    if (!exists) return null;
    
    // Get file metadata
    const metadataJson = await this.redis.hget(this.filesKey(sessionId), fileId);
    if (!metadataJson) return null;
    
    // Get file data
    const dataBase64 = await this.redis.get(this.fileDataKey(sessionId, fileId));
    if (!dataBase64) return null;
    
    try {
      const metadata = JSON.parse(metadataJson);
      const data = Buffer.from(dataBase64, 'base64');
      
      // Refresh TTL
      await this.refreshTTL(sessionId);
      
      return {
        id: fileId,
        name: metadata.name,
        data,
        size: metadata.size,
        createdAt: new Date(metadata.createdAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * List all files in a session
   */
  async listFiles(sessionId: string): Promise<Array<{ id: string; name: string; size: number; lastModified: string }>> {
    const exists = await this.redis.exists(this.sessionKey(sessionId));
    if (!exists) return [];
    
    const filesData = await this.redis.hgetall(this.filesKey(sessionId));
    const files: Array<{ id: string; name: string; size: number; lastModified: string }> = [];
    
    for (const [fileId, metadataJson] of Object.entries(filesData)) {
      try {
        const metadata = JSON.parse(metadataJson);
        files.push({
          id: fileId,
          name: metadata.name,
          size: metadata.size,
          lastModified: metadata.createdAt,
        });
      } catch {
        // Skip invalid entries
      }
    }
    
    // Refresh TTL
    await this.refreshTTL(sessionId);
    
    return files;
  }

  /**
   * Check if a session is still valid (not expired)
   */
  async isSessionValid(sessionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.sessionKey(sessionId));
    return exists === 1;
  }

  /**
   * Remove expired sessions (no-op for Redis, TTL handles this)
   */
  async cleanup(): Promise<void> {
    // Redis handles expiration via TTL, nothing to do
  }

  /**
   * Close Redis connection (for graceful shutdown)
   */
  async destroy(): Promise<void> {
    await this.redis.quit();
    console.log('[Storage] Redis connection closed');
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{ sessionCount: number; totalFiles: number; totalSize: number }> {
    // Count sessions by scanning keys (note: expensive for large datasets)
    let sessionCount = 0;
    let totalFiles = 0;
    let totalSize = 0;
    
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
      cursor = nextCursor;
      
      for (const key of keys) {
        // Only count main session keys (not :files suffix)
        if (!key.includes(':files')) {
          sessionCount++;
          
          // Count files for this session
          const sessionId = key.replace('session:', '');
          const filesData = await this.redis.hgetall(this.filesKey(sessionId));
          
          for (const metadataJson of Object.values(filesData)) {
            try {
              const metadata = JSON.parse(metadataJson);
              totalFiles++;
              totalSize += metadata.size || 0;
            } catch {
              // Skip invalid entries
            }
          }
        }
      }
    } while (cursor !== '0');
    
    return {
      sessionCount,
      totalFiles,
      totalSize,
    };
  }
}

// Singleton storage instance
let storageInstance: SessionStorage | null = null;

/**
 * Get the storage instance (singleton)
 */
export function getStorage(): SessionStorage {
  if (!storageInstance) {
    if (config.storageType === 'redis') {
      console.log('[Storage] Using Redis storage');
      storageInstance = new RedisStorage(config.redisUrl);
    } else {
      console.log('[Storage] Using in-memory storage');
      storageInstance = new MemoryStorage();
    }
  }
  return storageInstance;
}
