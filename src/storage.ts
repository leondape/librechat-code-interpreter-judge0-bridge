import { v4 as uuidv4 } from 'uuid';
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
  createSession(): string {
    const id = uuidv4();
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
  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check if session has expired
    if (!this.isSessionValid(sessionId)) {
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
  addFile(sessionId: string, name: string, data: Buffer): string {
    let session = this.getSession(sessionId);
    
    // Create session if it doesn't exist
    if (!session) {
      this.createSession();
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
    
    const fileId = uuidv4();
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
  getFile(sessionId: string, fileId: string): StoredFile | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    
    return session.files.get(fileId) || null;
  }

  /**
   * List all files in a session
   */
  listFiles(sessionId: string): Array<{ id: string; name: string; size: number; lastModified: string }> {
    const session = this.getSession(sessionId);
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
  isSessionValid(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    const now = Date.now();
    const lastAccessed = session.lastAccessedAt.getTime();
    
    return (now - lastAccessed) < config.sessionExpiryMs;
  }

  /**
   * Remove expired sessions
   */
  cleanup(): void {
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
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get storage statistics
   */
  getStats(): { sessionCount: number; totalFiles: number; totalSize: number } {
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

// Singleton storage instance
let storageInstance: MemoryStorage | null = null;

/**
 * Get the storage instance (singleton)
 */
export function getStorage(): MemoryStorage {
  if (!storageInstance) {
    if (config.storageType === 'redis') {
      console.warn('[Storage] Redis storage not implemented yet, falling back to memory');
    }
    storageInstance = new MemoryStorage();
  }
  return storageInstance;
}

