import axios, { AxiosError, AxiosInstance } from 'axios';
import https from 'https';
import { config, getJudge0LanguageId } from './config';
import { encodeBase64, decodeBase64, createZip, extractZip } from './utils';
import { getStorage } from './storage';
import type {
  LanguageCode,
  FileReference,
  ExecResponse,
  Judge0SubmissionRequest,
  Judge0SubmissionResponse,
} from './types';

// Judge0 response fields to request
const JUDGE0_FIELDS = 'stdout,stderr,status,compile_output,message,time,memory,post_execution_filesystem';

// Create axios instance with custom https agent (handles SSL certificate issues)
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === 'production', // Only strict in production
});

const axiosInstance: AxiosInstance = axios.create({
  httpsAgent,
  timeout: 60000,
});

/**
 * Judge0 API client
 */
export class Judge0Client {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.judge0ApiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.judge0ApiKey;
  }

  /**
   * Get common headers for Judge0 requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-Auth-Token'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Execute code via Judge0
   */
  async execute(
    lang: LanguageCode,
    code: string,
    files?: FileReference[],
    args?: string[]
  ): Promise<ExecResponse> {
    const storage = getStorage();
    
    // Translate LibreChat's /mnt/data paths to relative paths
    // LibreChat's prompt tells AI files are at /mnt/data/, but Judge0 uses current directory
    // Use negative lookbehind (?<!\.) to prevent path traversal (./mnt/data -> .. would escape sandbox)
    const pathPattern = /(?<!\.)\/mnt\/data(\/|(?=\b))/g;
    const pathTranslationOccurred = pathPattern.test(code);
    // Reset regex lastIndex after test() since we use /g flag
    pathPattern.lastIndex = 0;
    let translatedCode = code.replace(/(?<!\.)\/mnt\/data\//g, './');
    translatedCode = translatedCode.replace(/(?<!\.)\/mnt\/data\b/g, '.');
    
    // Prepare the submission request
    const languageId = getJudge0LanguageId(lang);
    const sourceCode = encodeBase64(translatedCode);
    
    const request: Judge0SubmissionRequest = {
      source_code: sourceCode,
      language_id: languageId,
    };

    // Add command line arguments if provided
    if (args && args.length > 0) {
      request.command_line_arguments = args.join(' ');
    }

    // Track input file names to exclude them from output
    const inputFileNames: string[] = [];

    // Handle input files - create a ZIP if files are referenced
    if (files && files.length > 0) {
      const fileBuffers: Array<{ name: string; data: Buffer }> = [];
      
      for (const fileRef of files) {
        const storedFile = await storage.getFile(fileRef.session_id, fileRef.id);
        if (storedFile) {
          fileBuffers.push({
            name: fileRef.name,
            data: storedFile.data,
          });
          inputFileNames.push(fileRef.name);
        } else {
          console.warn(`[Judge0] File not found: ${fileRef.session_id}/${fileRef.id}`);
        }
      }

      if (fileBuffers.length > 0) {
        request.additional_files = createZip(fileBuffers);
      }
    }

    try {
      // Submit to Judge0 with wait=true for synchronous execution
      const response = await axiosInstance.post<Judge0SubmissionResponse>(
        `${this.baseUrl}/submissions?base64_encoded=true&wait=true&fields=${JUDGE0_FIELDS}`,
        request,
        { headers: this.getHeaders() }
      );

      return await this.translateResponse(response.data, inputFileNames, pathTranslationOccurred);
    } catch (error) {
      return await this.handleError(error);
    }
  }

  /**
   * Translate Judge0 response to LibreChat format
   */
  private async translateResponse(j0Response: Judge0SubmissionResponse, inputFileNames: string[] = [], pathTranslationOccurred: boolean = false): Promise<ExecResponse> {
    const storage = getStorage();
    const statusId = j0Response.status?.id;
    
    // Create a new session for output files
    const sessionId = await storage.createSession();
    
    // Add FYI message if path translation occurred
    let stdout = pathTranslationOccurred ? 'FYI: judge0-bridge replaces /mnt/data to ./\n\n' : '';
    let stderr = '';
    const outputFiles: Array<{ id: string; name: string }> = [];

    // Decode stdout (append to FYI message if present)
    if (j0Response.stdout) {
      stdout += decodeBase64(j0Response.stdout);
    }

    // Handle different status codes
    switch (statusId) {
      case 6: // Compilation Error
        stderr = j0Response.compile_output 
          ? decodeBase64(j0Response.compile_output) 
          : 'Compilation error';
        break;

      case 5: // Time Limit Exceeded
      case 7: // Runtime Error (SIGSEGV)
      case 8: // Runtime Error (SIGXFSZ)
      case 9: // Runtime Error (SIGFPE)
      case 10: // Runtime Error (SIGABRT)
      case 11: // Runtime Error (NZEC)
      case 12: // Runtime Error (Other)
      case 14: // Exec Format Error
        stderr = j0Response.stderr ? decodeBase64(j0Response.stderr) : '';
        if (j0Response.status?.description) {
          stderr = `${stderr}\n[${j0Response.status.description}]`.trim();
        }
        break;

      case 13: // Internal Error
        stderr = j0Response.message 
          ? decodeBase64(j0Response.message) 
          : 'Internal execution error';
        break;

      case 3: // Accepted
      case 4: // Wrong Answer (still valid execution)
      default:
        if (j0Response.stderr) {
          stderr = decodeBase64(j0Response.stderr);
        }
        break;
    }

    // Extract output files from post_execution_filesystem
    // Filter out Judge0 artifacts (script.py, run.sh) and input files
    if (j0Response.post_execution_filesystem) {
      try {
        const extractedFiles = extractZip(j0Response.post_execution_filesystem, inputFileNames);
        
        for (const file of extractedFiles) {
          const fileId = await storage.addFile(sessionId, file.name, file.data);
          outputFiles.push({
            id: fileId,
            name: file.name,
          });
        }
      } catch (error) {
        console.error('[Judge0] Failed to extract output files:', error);
      }
    }

    const response: ExecResponse = {
      stdout,
      stderr,
      session_id: sessionId,
    };

    if (outputFiles.length > 0) {
      response.files = outputFiles;
    }

    return response;
  }

  /**
   * Handle errors from Judge0 API
   */
  private async handleError(error: unknown): Promise<ExecResponse> {
    const storage = getStorage();
    const sessionId = await storage.createSession();

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data as Record<string, unknown>;
        
        let errorMessage = `Judge0 error (${status})`;
        
        if (data && typeof data === 'object') {
          if (data.error) {
            errorMessage += `: ${data.error}`;
          } else if (data.message) {
            errorMessage += `: ${data.message}`;
          }
        }

        return {
          stdout: '',
          stderr: errorMessage,
          session_id: sessionId,
        };
      }

      if (axiosError.code === 'ECONNREFUSED') {
        return {
          stdout: '',
          stderr: 'Judge0 service unavailable',
          session_id: sessionId,
        };
      }

      if (axiosError.code === 'ETIMEDOUT' || axiosError.code === 'ECONNABORTED') {
        return {
          stdout: '',
          stderr: 'Execution timed out',
          session_id: sessionId,
        };
      }
    }

    return {
      stdout: '',
      stderr: `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      session_id: sessionId,
    };
  }

  /**
   * Check Judge0 health
   */
  async healthCheck(): Promise<{ healthy: boolean; version?: string; error?: string }> {
    try {
      const response = await axiosInstance.get(`${this.baseUrl}/about`, {
        headers: this.getHeaders(),
        timeout: 5000,
      });

      return {
        healthy: true,
        version: response.data?.version,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton client instance
let clientInstance: Judge0Client | null = null;

/**
 * Get the Judge0 client instance (singleton)
 */
export function getJudge0Client(): Judge0Client {
  if (!clientInstance) {
    clientInstance = new Judge0Client();
  }
  return clientInstance;
}

