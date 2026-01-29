#!/bin/bash
# Install Tab Archive native messaging host for Firefox
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/tabarchive-host.py"
EXTENSION_ID="tabarchive@localhost"

# Detect OS and set manifest directory
case "$(uname -s)" in
    Darwin)
        MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
        ;;
    Linux)
        MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
        ;;
    *)
        echo "Error: Unsupported operating system"
        exit 1
        ;;
esac

MANIFEST_FILE="$MANIFEST_DIR/tabarchive.json"

# Create manifest directory
mkdir -p "$MANIFEST_DIR"

# Create native messaging manifest
cat > "$MANIFEST_FILE" << EOF
{
  "name": "tabarchive",
  "description": "Tab Archive native messaging host for SQLite-backed tab storage",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_extensions": ["$EXTENSION_ID"]
}
EOF

# Make host executable
chmod +x "$HOST_PATH"

# Create data directory
mkdir -p "$HOME/.tabarchive"

echo "Tab Archive native host installed successfully"
echo "  Manifest: $MANIFEST_FILE"
echo "  Host: $HOST_PATH"
echo "  Data: $HOME/.tabarchive/"
