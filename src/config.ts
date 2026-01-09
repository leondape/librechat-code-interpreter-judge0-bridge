import { config as dotenvConfig } from 'dotenv';
import type { Config, LanguageCode } from './types';

// Load environment variables
dotenvConfig();

/**
 * Language mapping from LibreChat codes to Judge0 language IDs
 * Based on Judge0 CE v1.13.1
 */
export const LANGUAGE_MAP: Record<LanguageCode, number> = {
  'py': 71,    // Python 3.8.1
  'js': 63,    // JavaScript (Node.js 12.14.0)
  'ts': 74,    // TypeScript 3.7.4
  'c': 50,     // C (GCC 9.2.0)
  'cpp': 54,   // C++ (GCC 9.2.0)
  'java': 62,  // Java (OpenJDK 13.0.1)
  'php': 68,   // PHP 7.4.1
  'rs': 73,    // Rust 1.40.0
  'go': 60,    // Go 1.13.5
  'd': 56,     // D (DMD 2.089.1)
  'f90': 59,   // Fortran (GFortran 9.2.0)
  'r': 80,     // R 4.0.0
};

/**
 * Supported language codes
 */
export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_MAP) as LanguageCode[];

/**
 * Check if a language code is valid
 */
export function isValidLanguage(lang: string): lang is LanguageCode {
  return lang in LANGUAGE_MAP;
}

/**
 * Get Judge0 language ID from LibreChat language code
 */
export function getJudge0LanguageId(lang: LanguageCode): number {
  return LANGUAGE_MAP[lang];
}

/**
 * Parse environment variable as integer with default
 */
function parseIntEnv(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Application configuration loaded from environment
 */
export const config: Config = {
  port: parseIntEnv(process.env.PORT, 3001),
  host: process.env.HOST || 'localhost',
  judge0ApiUrl: process.env.JUDGE0_API_URL || 'https://ce.judge0.com',
  judge0ApiKey: process.env.JUDGE0_API_KEY || '',
  librechatCodeApiKey: process.env.LIBRECHAT_CODE_API_KEY || '',
  storageType: (process.env.STORAGE_TYPE as 'memory' | 'redis') || 'memory',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  sessionExpiryMs: parseIntEnv(process.env.SESSION_EXPIRY_MS, 86400000), // 24 hours
  maxFileSize: parseIntEnv(process.env.MAX_FILE_SIZE, 157286400), // 150MB
};

/**
 * Validate required configuration
 */
export function validateConfig(): void {
  // In production, warn if no API key is set
  if (process.env.NODE_ENV === 'production' && !config.librechatCodeApiKey) {
    console.warn('WARNING: LIBRECHAT_CODE_API_KEY is not set. The bridge is unprotected.');
  }
}

