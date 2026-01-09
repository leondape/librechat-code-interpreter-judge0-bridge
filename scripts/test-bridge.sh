#!/bin/bash
# Quick curl-based tests for Judge0-LibreChat Bridge
# Usage: ./scripts/test-bridge.sh

BRIDGE_URL="${BRIDGE_URL:-http://localhost:3001}"
API_KEY="${LIBRECHAT_CODE_API_KEY:-}"

echo "============================================================"
echo "Judge0-LibreChat Bridge - Curl Tests"
echo "============================================================"
echo "Bridge URL: $BRIDGE_URL"
echo "API Key: ${API_KEY:+configured}"
echo ""

# Build headers
HEADERS="-H 'Content-Type: application/json'"
if [ -n "$API_KEY" ]; then
  HEADERS="$HEADERS -H 'X-API-Key: $API_KEY'"
fi

# Test 1: Health Check
echo "▶ Test 1: Health Check"
curl -s "$BRIDGE_URL/health" | jq .
echo ""

# Test 2: Simple Python Execution
echo "▶ Test 2: Simple Python Execution"
curl -s -X POST "$BRIDGE_URL/exec" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -d '{
    "lang": "py",
    "code": "print(\"Hello from Python!\")"
  }' | jq .
echo ""

# Test 3: JavaScript Execution
echo "▶ Test 3: JavaScript Execution"
curl -s -X POST "$BRIDGE_URL/exec" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -d '{
    "lang": "js",
    "code": "console.log(\"Hello from JavaScript!\");"
  }' | jq .
echo ""

# Test 4: Python with Error
echo "▶ Test 4: Python with Syntax Error"
curl -s -X POST "$BRIDGE_URL/exec" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -d '{
    "lang": "py",
    "code": "print(\"Missing paren\""
  }' | jq .
echo ""

# Test 5: File Upload
echo "▶ Test 5: File Upload"
UPLOAD_RESULT=$(curl -s -X POST "$BRIDGE_URL/upload" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -F "file=@/dev/stdin;filename=test.txt" <<< "Hello from uploaded file!")
echo "$UPLOAD_RESULT" | jq .

SESSION_ID=$(echo "$UPLOAD_RESULT" | jq -r '.session_id')
FILE_ID=$(echo "$UPLOAD_RESULT" | jq -r '.files[0].fileId')
echo ""

# Test 6: List Files
if [ "$SESSION_ID" != "null" ]; then
  echo "▶ Test 6: List Files in Session"
  curl -s "$BRIDGE_URL/files/$SESSION_ID?detail=full" \
    ${API_KEY:+-H "X-API-Key: $API_KEY"} | jq .
  echo ""
  
  # Test 7: Download File
  echo "▶ Test 7: Download File"
  echo "Content: $(curl -s "$BRIDGE_URL/download/$SESSION_ID/$FILE_ID" \
    ${API_KEY:+-H "X-API-Key: $API_KEY"})"
  echo ""
fi

# Test 8: Invalid Language
echo "▶ Test 8: Invalid Language (should return 400)"
curl -s -X POST "$BRIDGE_URL/exec" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -d '{
    "lang": "invalid",
    "code": "test"
  }' | jq .
echo ""

# Test 9: Python File Generation
echo "▶ Test 9: Python File Generation"
curl -s -X POST "$BRIDGE_URL/exec" \
  -H "Content-Type: application/json" \
  ${API_KEY:+-H "X-API-Key: $API_KEY"} \
  -d '{
    "lang": "py",
    "code": "with open(\"output.txt\", \"w\") as f:\n    f.write(\"Generated!\")\nprint(\"Done\")"
  }' | jq .
echo ""

echo "============================================================"
echo "Tests completed!"
echo "============================================================"

