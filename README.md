# Judge0-LibreChat Bridge

A stateful proxy service that bridges LibreChat's Code Interpreter API with Judge0's stateless execution API.  
This is work in Progress but fully works. As far as I see it the bridge brings full feature parity to LibreChat Code interpreter API. Redis is very wip and not yet tested.

## Overview

LibreChat expects a stateful code execution API with persistent sessions and file management, but Judge0 is stateless per-submission. This bridge handles:

- **Session Management**: Creates and manages sessions with configurable TTL (default 24 hours)
- **File Storage**: Stores uploaded files and execution output files
- **API Translation**: Translates between LibreChat and Judge0 request/response formats
- **ZIP Handling**: Manages `additional_files` and `post_execution_filesystem` ZIP encoding

## Prerequisites

- Docker (recommended) OR Node.js 18+
- Judge0 API >=v1.14 (see [File Output Support](#file-output-support) for limitations)

## Quick Start (Docker)

The easiest way to run the bridge:

```bash
# 1. Download the compose file 
curl -O https://raw.githubusercontent.com/leondape/librechat-code-interpreter-judge0-bridge/main/docker-compose.yml
# OR Redis compose file for persistent TTL storage 
curl -O https://raw.githubusercontent.com/leondape/librechat-code-interpreter-judge0-bridge/main/docker-compose.redis.yml
# 2. Configure .env.example
curl -O https://raw.githubusercontent.com/leondape/librechat-code-interpreter-judge0-bridge/main/.env.example

# 3. Configure environment
mv .env.example .env
# Edit .env with your Judge0 API key and other settings

# 4. Start the bridge
docker compose up -d
# OR when using redis
docker compose -f docker-compose.redis.yml up -d
```

## Quick Start (Node.js)

If you prefer running without Docker:

```bash
# 1. Clone and install
git clone https://github.com/leondape/librechat-code-interpreter-judge0-bridge.git
cd librechat-code-interpreter-judge0-bridge
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env as needed

# 3. Start the bridge
npm run build
npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `localhost` | Server host (use `0.0.0.0` for containers) |
| `JUDGE0_API_URL` | `https://ce.judge0.com` | Judge0 API URL |
| `JUDGE0_API_KEY` | (empty) | Judge0 auth token (if required) |
| `LIBRECHAT_CODE_API_KEY` | (empty) | API key for bridge authentication |
| `STORAGE_TYPE` | `memory` | Storage type: `memory` or `redis` |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL (if using Redis) |
| `SESSION_EXPIRY_MS` | `86400000` | Session expiry (24 hours) |
| `MAX_FILE_SIZE` | `157286400` | Max file size (150MB) |

## API Endpoints

### POST /exec

Execute code.

**Request:**
```json
{
  "lang": "py",
  "code": "print('Hello, World!')",
  "files": [{"session_id": "...", "id": "...", "name": "input.txt"}],
  "args": ["arg1", "arg2"]
}
```

**Response:**
```json
{
  "stdout": "Hello, World!\n",
  "stderr": "",
  "session_id": "abc123",
  "files": [{"id": "file123", "name": "output.txt"}]
}
```

### POST /upload

Upload a file.

**Request:** `multipart/form-data` with `file` field

**Response:**
```json
{
  "message": "success",
  "session_id": "abc123",
  "files": [{"fileId": "file123", "filename": "input.txt"}]
}
```

### GET /files/:session_id

List files in a session.

**Query:** `?detail=full` or `?detail=summary`

**Response (detail=full):**
```json
[
  {
    "name": "abc123/file123",
    "metadata": {"original-filename": "output.txt"},
    "lastModified": "2024-01-01T00:00:00.000Z"
  }
]
```

### GET /download/:session_id/:file_id

Download a file.

**Response:** Binary file stream

### GET /health

Health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "judge0": {"url": "https://ce.judge0.com", "healthy": true, "version": "1.13.1"},
  "storage": {"type": "memory", "sessions": 5, "files": 12, "totalSize": 1024}
}
```

## Supported Languages

| Code | Language |
|------|----------|
| `py` | Python 3.8.1 |
| `js` | JavaScript (Node.js 12.14.0) |
| `ts` | TypeScript 3.7.4 |
| `c` | C (GCC 9.2.0) |
| `cpp` | C++ (GCC 9.2.0) |
| `java` | Java (OpenJDK 13.0.1) |
| `php` | PHP 7.4.1 |
| `rs` | Rust 1.40.0 |
| `go` | Go 1.13.5 |
| `d` | D (DMD 2.089.1) |
| `f90` | Fortran (GFortran 9.2.0) |
| `r` | R 4.0.0 |

## LibreChat Integration

After deploying the bridge, configure LibreChat:

```env
LIBRECHAT_CODE_BASEURL=http://localhost:3001
LIBRECHAT_CODE_API_KEY=your-secret-key
```

For production behind a reverse proxy:

```env
LIBRECHAT_CODE_BASEURL=https://bridge.yourdomain.com
LIBRECHAT_CODE_API_KEY=your-secret-key
```

## File Output Support

| Judge0 Instance | Version | File Output (`post_execution_filesystem`) |
|-----------------|---------|-------------------------------------------|
| `https://ce.judge0.com` | 1.14.0 | ✅ Supported |
| `https://extra-ce.judge0.com` | 1.14.0 | ✅ Supported |
| Self-hosted (open-source) | 1.13.1 | ❌ Not available |

This bridge uses `post_execution_filesystem` to retrieve files created during code execution (e.g., matplotlib graphs, generated CSVs). This is very much needed for LibreChat parity as it has vast file support. Therefore the bridge will not support lower Judge0 versions without file support.  
Currently self-hosted images (<v1.14) do not support `post_execution_filesystem` so it only works with hosted. But this is only the case until v1.14.0 is released.  

## Architecture

```
┌─────────────┐     ┌───────────────────────────┐     ┌─────────────┐
│  LibreChat  │────▶│    Judge0-LibreChat      │────▶│   Judge0    │
│             │◀────│         Bridge            │◀────│     API     │
└─────────────┘     │                           │     └─────────────┘
                    │  ┌─────────────────────┐  │
                    │  │   Session Storage   │  │
                    │  │   (Memory/Redis)    │  │
                    │  └─────────────────────┘  │
                    └───────────────────────────┘
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run tests
npm run test

# Quick curl tests
./scripts/test-bridge.sh
```

### Building Docker Image Locally

For contributors who want to build the Docker image locally instead of pulling from the registry:

```bash
# Memory storage
docker compose -f docker-compose.dev.yml up -d

# With Redis
docker compose -f docker-compose.dev.redis.yml up -d
```

## Security Notes

- Set `LIBRECHAT_CODE_API_KEY` in production
- Judge0's sandbox handles path traversal protection
- Errors from Judge0 pass through to the client

## License

MIT

