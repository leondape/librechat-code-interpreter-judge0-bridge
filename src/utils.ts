import AdmZip from 'adm-zip';

/**
 * Encode a string to base64
 */
export function encodeBase64(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

/**
 * Decode a base64 string
 */
export function decodeBase64(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Create a ZIP file from an array of files
 * Returns base64 encoded ZIP
 */
export function createZip(files: Array<{ name: string; data: Buffer }>): string {
  const zip = new AdmZip();
  
  for (const file of files) {
    zip.addFile(file.name, file.data);
  }
  
  const zipBuffer = zip.toBuffer();
  return zipBuffer.toString('base64');
}

/**
 * Judge0 artifact files that should be excluded from output
 * These are files Judge0 creates internally, not user-generated output
 */
const JUDGE0_ARTIFACTS = new Set([
  'script.py',      // Python source
  'script.js',      // JavaScript source
  'script.ts',      // TypeScript source
  'main.c',         // C source
  'main.cpp',       // C++ source
  'Main.java',      // Java source
  'script.php',     // PHP source
  'main.rs',        // Rust source
  'main.go',        // Go source
  'main.d',         // D source
  'main.f90',       // Fortran source
  'script.r',       // R source
  'run.sh',         // Judge0 runner script
  'compile.sh',     // Judge0 compile script
]);

/**
 * Extract files from a base64 encoded ZIP
 * Returns array of extracted files, excluding Judge0 artifacts
 */
export function extractZip(
  base64Zip: string, 
  inputFileNames?: string[]
): Array<{ name: string; data: Buffer }> {
  const zipBuffer = Buffer.from(base64Zip, 'base64');
  const zip = new AdmZip(zipBuffer);
  const files: Array<{ name: string; data: Buffer }> = [];
  
  // Create a set of input file names to exclude them from output
  const inputFiles = new Set(inputFileNames || []);
  
  for (const entry of zip.getEntries()) {
    // Skip directories and hidden files
    if (entry.isDirectory || entry.entryName.startsWith('.')) {
      continue;
    }
    
    // Get the filename without directory path
    const name = entry.entryName.split('/').pop() || entry.entryName;
    
    // Skip Judge0 artifacts (source files, runner scripts)
    if (JUDGE0_ARTIFACTS.has(name)) {
      continue;
    }
    
    // Skip input files (files that were passed to the execution)
    if (inputFiles.has(name)) {
      continue;
    }
    
    files.push({
      name,
      data: entry.getData(),
    });
  }
  
  return files;
}

/**
 * Get MIME type from filename
 */
export function getMimeType(filename: string): string {
  const mimeTypes = require('mime-types');
  return mimeTypes.lookup(filename) || 'application/octet-stream';
}

/**
 * Check if a filename represents an image
 */
export function isImageFile(filename: string): boolean {
  const imageExtRegex = /\.(jpg|jpeg|png|gif|webp)$/i;
  return imageExtRegex.test(filename);
}

/**
 * Sanitize a filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  // Remove path traversal attempts and special characters
  return filename
    .replace(/\.\./g, '')
    .replace(/[\/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255); // Limit length
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

