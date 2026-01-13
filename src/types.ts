// =============================================================================
// LibreChat API Types (what the bridge receives/sends to LibreChat)
// =============================================================================

/**
 * Supported language codes from LibreChat CodeExecutor tool
 */
export type LanguageCode = 
  | 'py' | 'js' | 'ts' | 'c' | 'cpp' | 'java' 
  | 'php' | 'rs' | 'go' | 'd' | 'f90' | 'r';

/**
 * File reference from a previous session
 */
export interface FileReference {
  session_id: string;
  id: string;
  name: string;
}

/**
 * POST /exec request body from LibreChat
 */
export interface ExecRequest {
  lang: LanguageCode;
  code: string;
  files?: FileReference[];
  args?: string[];
  user_id?: string;
}

/**
 * Output file info in response
 */
export interface OutputFile {
  id: string;
  name: string;
}

/**
 * POST /exec response to LibreChat
 */
export interface ExecResponse {
  stdout: string;
  stderr: string;
  session_id: string;
  files?: OutputFile[];
}

/**
 * POST /upload response to LibreChat
 */
export interface UploadResponse {
  message: 'success';
  session_id: string;
  files: Array<{ fileId: string; filename: string }>;
}

/**
 * GET /files/:session_id response item (detail=full)
 */
export interface FileListItem {
  name: string;  // Format: "{session_id}/{file_id}"
  metadata: { 'original-filename': string };
  lastModified: string;
}

/**
 * GET /files/:session_id response item (detail=summary)
 */
export interface FileListItemSummary {
  name: string;
  lastModified: string;
}

// =============================================================================
// Judge0 API Types (what the bridge sends/receives from Judge0)
// =============================================================================

/**
 * Judge0 submission request body
 */
export interface Judge0SubmissionRequest {
  source_code: string;       // base64 encoded
  language_id: number;
  additional_files?: string; // base64 encoded ZIP
  command_line_arguments?: string;
  stdin?: string;
  cpu_time_limit?: number;
  wall_time_limit?: number;
  memory_limit?: number;
}

/**
 * Judge0 submission status
 */
export interface Judge0Status {
  id: number;
  description: string;
}

/**
 * Judge0 submission response
 */
export interface Judge0SubmissionResponse {
  token?: string;
  stdout?: string;           // base64 encoded
  stderr?: string;           // base64 encoded
  compile_output?: string;   // base64 encoded
  message?: string;          // base64 encoded
  status?: Judge0Status;
  time?: string;
  memory?: number;
  post_execution_filesystem?: string; // base64 encoded ZIP
}

/**
 * Judge0 status codes
 */
export enum Judge0StatusId {
  InQueue = 1,
  Processing = 2,
  Accepted = 3,
  WrongAnswer = 4,
  TimeLimitExceeded = 5,
  CompilationError = 6,
  RuntimeErrorSIGSEGV = 7,
  RuntimeErrorSIGXFSZ = 8,
  RuntimeErrorSIGFPE = 9,
  RuntimeErrorSIGABRT = 10,
  RuntimeErrorNZEC = 11,
  RuntimeErrorOther = 12,
  InternalError = 13,
  ExecFormatError = 14,
}

// =============================================================================
// Internal Storage Types
// =============================================================================

/**
 * Stored file metadata
 */
export interface StoredFile {
  id: string;
  name: string;
  data: Buffer;
  size: number;
  createdAt: Date;
}

/**
 * Session data
 */
export interface Session {
  id: string;
  files: Map<string, StoredFile>;
  createdAt: Date;
  lastAccessedAt: Date;
}

/**
 * Storage interface for session/file management (async)
 */
export interface SessionStorage {
  createSession(): Promise<string>;
  getSession(sessionId: string): Promise<Session | null>;
  addFile(sessionId: string, name: string, data: Buffer): Promise<string>;
  getFile(sessionId: string, fileId: string): Promise<StoredFile | null>;
  listFiles(sessionId: string): Promise<Array<{ id: string; name: string; size: number; lastModified: string }>>;
  isSessionValid(sessionId: string): Promise<boolean>;
  cleanup(): Promise<void>;
  destroy(): Promise<void>;
  getStats(): Promise<{ sessionCount: number; totalFiles: number; totalSize: number }>;
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface Config {
  port: number;
  host: string;
  judge0ApiUrl: string;
  judge0ApiKey: string;
  librechatCodeApiKey: string;
  storageType: 'memory' | 'redis';
  redisUrl: string;
  sessionExpiryMs: number;
  maxFileSize: number;
}

