/**
 * Test script for Judge0-LibreChat Bridge
 * 
 * Usage:
 *   npm run test
 *   # or
 *   npx tsx scripts/test-bridge.ts
 * 
 * Make sure the bridge is running first:
 *   npm run dev
 */

import axios, { AxiosError } from 'axios';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:3001';
const API_KEY = process.env.LIBRECHAT_CODE_API_KEY || '';

// =============================================================================
// Test Helpers
// =============================================================================

const client = axios.create({
  baseURL: BRIDGE_URL,
  headers: API_KEY ? { 'X-API-Key': API_KEY } : {},
  timeout: 60000,
});

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  console.log(`\n▶ ${name}`);
  
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`  ✓ Passed (${duration}ms)`);
    results.push({ name, passed: true, duration });
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ✗ Failed: ${message}`);
    results.push({ name, passed: false, error: message, duration });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// =============================================================================
// Tests
// =============================================================================

async function testHealthCheck(): Promise<void> {
  const response = await client.get('/health');
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.status === 'ok', 'Expected status to be ok');
  console.log(`  Judge0: ${response.data.judge0.healthy ? 'healthy' : 'unhealthy'} (${response.data.judge0.version || 'unknown version'})`);
}

async function testSimplePythonExec(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'py',
    code: 'print("Hello from Python!")',
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stdout.includes('Hello from Python!'), 'Expected stdout to contain greeting');
  assert(response.data.session_id, 'Expected session_id in response');
  console.log(`  stdout: ${response.data.stdout.trim()}`);
  console.log(`  session_id: ${response.data.session_id}`);
}

async function testSimpleJavaScriptExec(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'js',
    code: 'console.log("Hello from JavaScript!");',
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stdout.includes('Hello from JavaScript!'), 'Expected stdout to contain greeting');
  console.log(`  stdout: ${response.data.stdout.trim()}`);
}

async function testPythonWithArgs(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'py',
    code: `
import sys
print(f"Arguments: {sys.argv[1:]}")
`,
    args: ['arg1', 'arg2', 'arg3'],
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stdout.includes('arg1'), 'Expected stdout to contain arg1');
  console.log(`  stdout: ${response.data.stdout.trim()}`);
}

async function testPythonFileGeneration(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'py',
    code: `
# Create a text file
with open('output.txt', 'w') as f:
    f.write('This is generated content!')

print('File created successfully')
`,
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stdout.includes('File created'), 'Expected success message');
  
  // Check if files were returned
  if (response.data.files && response.data.files.length > 0) {
    console.log(`  Generated ${response.data.files.length} file(s)`);
    for (const file of response.data.files) {
      console.log(`    - ${file.name} (id: ${file.id})`);
    }
    
    // Try to download the file
    const sessionId = response.data.session_id;
    const fileId = response.data.files[0].id;
    
    const downloadResponse = await client.get(`/download/${sessionId}/${fileId}`, {
      responseType: 'arraybuffer',
    });
    
    assert(downloadResponse.status === 200, 'Expected download status 200');
    const content = Buffer.from(downloadResponse.data).toString('utf-8');
    console.log(`  Downloaded content: "${content}"`);
    assert(content.includes('generated content'), 'Expected file to contain generated content');
  } else {
    console.log('  Note: No output files returned (Judge0 may not support post_execution_filesystem)');
  }
}

async function testCompilationError(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'py',
    code: 'print("Missing closing parenthesis"',
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stderr.length > 0, 'Expected stderr to contain error');
  console.log(`  stderr: ${response.data.stderr.substring(0, 100)}...`);
}

async function testInvalidLanguage(): Promise<void> {
  try {
    await client.post('/exec', {
      lang: 'invalid',
      code: 'print("test")',
    });
    throw new Error('Expected 400 error');
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 400) {
      console.log(`  Correctly rejected invalid language`);
      return;
    }
    throw error;
  }
}

async function testMissingCode(): Promise<void> {
  try {
    await client.post('/exec', {
      lang: 'py',
    });
    throw new Error('Expected 400 error');
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 400) {
      console.log(`  Correctly rejected missing code`);
      return;
    }
    throw error;
  }
}

async function testFileUpload(): Promise<void> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', Buffer.from('Hello, World!'), 'test.txt');
  
  const response = await client.post('/upload', form, {
    headers: {
      ...form.getHeaders(),
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.message === 'success', 'Expected success message');
  assert(response.data.session_id, 'Expected session_id');
  assert(response.data.files.length === 1, 'Expected one file');
  
  const sessionId = response.data.session_id;
  const fileId = response.data.files[0].fileId;
  
  console.log(`  Uploaded: ${response.data.files[0].filename}`);
  console.log(`  Session: ${sessionId}`);
  console.log(`  File ID: ${fileId}`);
  
  // List files in session
  const listResponse = await client.get(`/files/${sessionId}?detail=full`);
  assert(listResponse.status === 200, 'Expected list status 200');
  assert(listResponse.data.length === 1, 'Expected one file in list');
  console.log(`  Listed files: ${listResponse.data.length}`);
  
  // Download the file
  const downloadResponse = await client.get(`/download/${sessionId}/${fileId}`, {
    responseType: 'arraybuffer',
  });
  const content = Buffer.from(downloadResponse.data).toString('utf-8');
  assert(content === 'Hello, World!', 'Expected file content to match');
  console.log(`  Downloaded content matches`);
}

async function testSessionNotFound(): Promise<void> {
  try {
    await client.get('/files/nonexistent-session-id');
    throw new Error('Expected 404 error');
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.log(`  Correctly returned 404 for nonexistent session`);
      return;
    }
    throw error;
  }
}

async function testCppExec(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'cpp',
    code: `
#include <iostream>
int main() {
    std::cout << "Hello from C++!" << std::endl;
    return 0;
}
`,
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stdout.includes('Hello from C++'), 'Expected stdout to contain greeting');
  console.log(`  stdout: ${response.data.stdout.trim()}`);
}

async function testGoExec(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'go',
    code: `
package main

import "fmt"

func main() {
    fmt.Println("Hello from Go!")
}
`,
  });
  
  assert(response.status === 200, 'Expected status 200');
  assert(response.data.stdout.includes('Hello from Go'), 'Expected stdout to contain greeting');
  console.log(`  stdout: ${response.data.stdout.trim()}`);
}

// =============================================================================
// File Handling Tests (LibreChat Compatibility)
// =============================================================================

/**
 * LibreChat's backend validates IDs with this regex: /^[A-Za-z0-9_-]{21}$/
 * IDs must be exactly 21 characters using base64url-safe characters
 */
function isLibreChatValidID(str: string): boolean {
  return /^[A-Za-z0-9_-]{21}$/.test(str);
}

async function testSessionIdFormat(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'py',
    code: 'print("test")',
  });
  
  const sessionId = response.data.session_id;
  assert(sessionId, 'Expected session_id in response');
  assert(typeof sessionId === 'string', 'session_id should be a string');
  assert(sessionId.length === 21, `session_id should be 21 chars, got ${sessionId.length}: "${sessionId}"`);
  assert(isLibreChatValidID(sessionId), `session_id should match LibreChat format: "${sessionId}"`);
  console.log(`  session_id: ${sessionId} (valid format)`);
}

async function testFileIdFormat(): Promise<void> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', Buffer.from('test content'), 'test.txt');
  
  const response = await client.post('/upload', form, {
    headers: {
      ...form.getHeaders(),
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
  });
  
  const sessionId = response.data.session_id;
  const fileId = response.data.files[0].fileId;
  
  assert(isLibreChatValidID(sessionId), `session_id should match LibreChat format: "${sessionId}"`);
  assert(isLibreChatValidID(fileId), `fileId should match LibreChat format: "${fileId}"`);
  console.log(`  session_id: ${sessionId} (valid)`);
  console.log(`  fileId: ${fileId} (valid)`);
}

async function testGeneratedFileIdFormat(): Promise<void> {
  const response = await client.post('/exec', {
    lang: 'py',
    code: `
with open('test.txt', 'w') as f:
    f.write('hello')
print('done')
`,
  });
  
  assert(response.data.files && response.data.files.length > 0, 'Expected generated files');
  
  const sessionId = response.data.session_id;
  const fileId = response.data.files[0].id;
  
  assert(isLibreChatValidID(sessionId), `session_id should match LibreChat format: "${sessionId}"`);
  assert(isLibreChatValidID(fileId), `file id should match LibreChat format: "${fileId}"`);
  console.log(`  Generated file id: ${fileId} (valid format)`);
}

async function testFilesListFormat(): Promise<void> {
  // Upload a file first
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', Buffer.from('test content'), 'myfile.txt');
  
  const uploadResponse = await client.post('/upload', form, {
    headers: {
      ...form.getHeaders(),
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
  });
  
  const sessionId = uploadResponse.data.session_id;
  const fileId = uploadResponse.data.files[0].fileId;
  
  // Get files list with detail=full (what LibreChat uses)
  const listResponse = await client.get(`/files/${sessionId}?detail=full`);
  
  assert(listResponse.status === 200, 'Expected status 200');
  assert(Array.isArray(listResponse.data), 'Response should be an array');
  assert(listResponse.data.length === 1, 'Should have one file');
  
  const file = listResponse.data[0];
  
  // LibreChat expects: { name: "session_id/file_id", metadata: { "original-filename": "..." }, lastModified: "..." }
  assert(file.name, 'File should have name field');
  assert(file.name === `${sessionId}/${fileId}`, `File name should be session_id/file_id format, got: "${file.name}"`);
  assert(file.metadata, 'File should have metadata');
  assert(file.metadata['original-filename'] === 'myfile.txt', 'Metadata should have original-filename');
  assert(file.lastModified, 'File should have lastModified');
  
  console.log(`  File name format: ${file.name} ✓`);
  console.log(`  Original filename: ${file.metadata['original-filename']} ✓`);
}

async function testFullDownloadFlow(): Promise<void> {
  // This simulates the full LibreChat flow:
  // 1. Execute code that generates a file
  // 2. Get files list
  // 3. Parse file info and download
  
  const execResponse = await client.post('/exec', {
    lang: 'py',
    code: `
with open('result.csv', 'w') as f:
    f.write('name,value\\ntest,123')
print('CSV created')
`,
  });
  
  assert(execResponse.data.files && execResponse.data.files.length > 0, 'Expected generated file');
  const sessionId = execResponse.data.session_id;
  console.log(`  1. Executed code, session: ${sessionId}`);
  
  // Get files list (like LibreChat does)
  const listResponse = await client.get(`/files/${sessionId}?detail=full`);
  assert(listResponse.data.length > 0, 'Should have files in list');
  
  const fileInfo = listResponse.data[0];
  console.log(`  2. Listed files, found: ${fileInfo.name}`);
  
  // Parse session_id and file_id from name (like LibreChat does)
  const nameParts = fileInfo.name.split('/');
  assert(nameParts.length === 2, 'File name should be session_id/file_id format');
  const [parsedSessionId, parsedFileId] = nameParts;
  
  // Validate IDs match LibreChat's expected format
  assert(isLibreChatValidID(parsedSessionId), `Parsed session_id invalid: "${parsedSessionId}"`);
  assert(isLibreChatValidID(parsedFileId), `Parsed file_id invalid: "${parsedFileId}"`);
  
  // Download file
  const downloadResponse = await client.get(`/download/${parsedSessionId}/${parsedFileId}`, {
    responseType: 'arraybuffer',
  });
  
  assert(downloadResponse.status === 200, 'Download should succeed');
  const content = Buffer.from(downloadResponse.data).toString('utf-8');
  assert(content.includes('name,value'), 'File content should match');
  console.log(`  3. Downloaded file successfully`);
  console.log(`  Content preview: "${content.substring(0, 30)}..."`);
}

async function testBinaryFileHandling(): Promise<void> {
  // Test with binary data (like an image would be)
  const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
  
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', binaryData, 'test.png');
  
  const uploadResponse = await client.post('/upload', form, {
    headers: {
      ...form.getHeaders(),
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
  });
  
  const sessionId = uploadResponse.data.session_id;
  const fileId = uploadResponse.data.files[0].fileId;
  
  // Download and verify binary content is preserved
  const downloadResponse = await client.get(`/download/${sessionId}/${fileId}`, {
    responseType: 'arraybuffer',
  });
  
  const downloadedData = Buffer.from(downloadResponse.data);
  assert(downloadedData.equals(binaryData), 'Binary content should be preserved exactly');
  console.log(`  Binary data preserved: ${downloadedData.length} bytes`);
}

async function testDownloadHeaders(): Promise<void> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', Buffer.from('test'), 'document.pdf');
  
  const uploadResponse = await client.post('/upload', form, {
    headers: {
      ...form.getHeaders(),
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
  });
  
  const sessionId = uploadResponse.data.session_id;
  const fileId = uploadResponse.data.files[0].fileId;
  
  const downloadResponse = await client.get(`/download/${sessionId}/${fileId}`, {
    responseType: 'arraybuffer',
  });
  
  // Check response headers
  const contentType = downloadResponse.headers['content-type'];
  const contentDisposition = downloadResponse.headers['content-disposition'];
  
  assert(contentType, 'Should have Content-Type header');
  assert(contentDisposition, 'Should have Content-Disposition header');
  assert(contentDisposition.includes('document.pdf'), 'Content-Disposition should include filename');
  
  console.log(`  Content-Type: ${contentType}`);
  console.log(`  Content-Disposition: ${contentDisposition}`);
}

async function testFileNotFound(): Promise<void> {
  // Test with valid format IDs that don't exist
  const fakeSessionId = 'abcdefghijklmnopqrstu'; // 21 chars
  const fakeFileId = 'zyxwvutsrqponmlkjihgf'; // 21 chars
  
  try {
    await client.get(`/download/${fakeSessionId}/${fakeFileId}`);
    throw new Error('Expected 404 error');
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.log(`  Correctly returned 404 for non-existent file`);
      return;
    }
    throw error;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Judge0-LibreChat Bridge Test Suite');
  console.log('='.repeat(60));
  console.log(`Bridge URL: ${BRIDGE_URL}`);
  console.log(`API Key: ${API_KEY ? 'configured' : 'not configured'}`);
  
  // Basic functionality tests
  console.log('\n--- Basic Functionality ---');
  await runTest('Health Check', testHealthCheck);
  await runTest('Simple Python Execution', testSimplePythonExec);
  await runTest('Simple JavaScript Execution', testSimpleJavaScriptExec);
  await runTest('Python with Arguments', testPythonWithArgs);
  await runTest('Python File Generation', testPythonFileGeneration);
  await runTest('Compilation Error Handling', testCompilationError);
  await runTest('Invalid Language Rejection', testInvalidLanguage);
  await runTest('Missing Code Rejection', testMissingCode);
  await runTest('C++ Execution', testCppExec);
  await runTest('Go Execution', testGoExec);
  
  // File handling tests (LibreChat compatibility)
  console.log('\n--- File Handling (LibreChat Compatibility) ---');
  await runTest('Session ID Format (21 chars)', testSessionIdFormat);
  await runTest('File ID Format (21 chars)', testFileIdFormat);
  await runTest('Generated File ID Format', testGeneratedFileIdFormat);
  await runTest('Files List Response Format', testFilesListFormat);
  await runTest('Full Download Flow', testFullDownloadFlow);
  await runTest('Binary File Handling', testBinaryFileHandling);
  await runTest('Download Response Headers', testDownloadHeaders);
  await runTest('File Not Found (404)', testFileNotFound);
  await runTest('File Upload and Download', testFileUpload);
  await runTest('Session Not Found', testSessionNotFound);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${totalDuration}ms`);
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`  - ${result.name}: ${result.error}`);
    }
    process.exit(1);
  }
  
  console.log('\n✓ All tests passed!');
}

main().catch(error => {
  console.error('Test suite error:', error);
  process.exit(1);
});

