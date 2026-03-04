#!/bin/bash
# Install Tab Archive native messaging host for Firefox/Chrome/Chromium.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/tabarchive-host.py"
HOST_NAME="tabarchive"
DEFAULT_FIREFOX_EXTENSION_ID="tabarchive@localhost"

BROWSER="firefox"
EXTENSION_ID="${TABARCHIVE_EXTENSION_ID:-}"
FIREFOX_EXTENSION_ID="${TABARCHIVE_FIREFOX_EXTENSION_ID:-$DEFAULT_FIREFOX_EXTENSION_ID}"

usage() {
  cat <<'EOF'
Usage: native/install.sh [options]

Options:
  --browser <firefox|chrome|chrome-for-testing|chromium|all>
      Default: firefox
  --extension-id <id>
      Required for chrome/chrome-for-testing/chromium/all.
      Example: abcdefghijklmnopqrstuvwxyzabcdef
  --firefox-extension-id <id>
      Default: tabarchive@localhost
  --help

Examples:
  native/install.sh
  native/install.sh --browser chrome --extension-id <chrome_extension_id>
  native/install.sh --browser all --extension-id <chrome_extension_id>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      BROWSER="${2:-}"
      shift 2
      ;;
    --extension-id)
      EXTENSION_ID="${2:-}"
      shift 2
      ;;
    --firefox-extension-id)
      FIREFOX_EXTENSION_ID="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$BROWSER" in
  firefox|chrome|chrome-for-testing|chromium|all) ;;
  *)
    echo "Error: unsupported browser '$BROWSER'" >&2
    usage
    exit 1
    ;;
esac

if [[ "$BROWSER" != "firefox" ]] && [[ -z "$EXTENSION_ID" ]]; then
  echo "Error: --extension-id is required for browser '$BROWSER'." >&2
  echo "Hint: copy the extension ID from chrome://extensions (Developer mode)." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin|Linux) ;;
  *)
    echo "Error: Unsupported operating system"
    exit 1
    ;;
esac

firefox_manifest_dir() {
  case "$(uname -s)" in
    Darwin)
      echo "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
      ;;
    Linux)
      echo "$HOME/.mozilla/native-messaging-hosts"
      ;;
  esac
}

chromium_manifest_dir() {
  local browser="$1"
  case "$(uname -s)" in
    Darwin)
      case "$browser" in
        chrome)
          echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
          ;;
        chrome-for-testing)
          echo "$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"
          ;;
        chromium)
          echo "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
          ;;
      esac
      ;;
    Linux)
      case "$browser" in
        chrome)
          echo "$HOME/.config/google-chrome/NativeMessagingHosts"
          ;;
        chrome-for-testing)
          echo "$HOME/.config/google-chrome-for-testing/NativeMessagingHosts"
          ;;
        chromium)
          echo "$HOME/.config/chromium/NativeMessagingHosts"
          ;;
      esac
      ;;
  esac
}

write_firefox_manifest() {
  local manifest_dir
  local manifest_file
  manifest_dir="$(firefox_manifest_dir)"
  manifest_file="$manifest_dir/$HOST_NAME.json"
  mkdir -p "$manifest_dir"

  cat > "$manifest_file" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Tab Archive native messaging host for SQLite-backed tab storage",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_EXTENSION_ID"]
}
EOF

  echo "Installed Firefox manifest:"
  echo "  $manifest_file"
}

write_chromium_manifest() {
  local browser="$1"
  local manifest_dir
  local manifest_file
  manifest_dir="$(chromium_manifest_dir "$browser")"
  manifest_file="$manifest_dir/$HOST_NAME.json"
  mkdir -p "$manifest_dir"

  cat > "$manifest_file" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Tab Archive native messaging host for SQLite-backed tab storage",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

  echo "Installed $browser manifest:"
  echo "  $manifest_file"
}

# Make host executable
chmod +x "$HOST_PATH"

# Create data directory
mkdir -p "$HOME/.tabarchive"

case "$BROWSER" in
  firefox)
    write_firefox_manifest
    ;;
  chrome|chrome-for-testing|chromium)
    write_chromium_manifest "$BROWSER"
    ;;
  all)
    write_firefox_manifest
    write_chromium_manifest chrome
    write_chromium_manifest chrome-for-testing
    write_chromium_manifest chromium
    ;;
esac

echo "Tab Archive native host installed successfully"
echo "  Host: $HOST_PATH"
echo "  Data: $HOME/.tabarchive/"
