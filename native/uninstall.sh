#!/bin/bash
# Uninstall Tab Archive native messaging host for Firefox/Chrome/Chromium.
set -euo pipefail

HOST_NAME="tabarchive"
BROWSER="firefox"
DATA_DIR="$HOME/.tabarchive"

usage() {
  cat <<'EOF'
Usage: native/uninstall.sh [options]

Options:
  --browser <firefox|chrome|chrome-for-testing|chromium|all>
      Default: firefox
  --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      BROWSER="${2:-}"
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

remove_manifest() {
  local manifest_file="$1"
  if [[ -f "$manifest_file" ]]; then
    rm "$manifest_file"
    echo "Removed native messaging manifest: $manifest_file"
  else
    echo "Manifest not found: $manifest_file"
  fi
}

remove_firefox_manifest() {
  local manifest_dir
  manifest_dir="$(firefox_manifest_dir)"
  remove_manifest "$manifest_dir/$HOST_NAME.json"
}

remove_chromium_manifest() {
  local browser="$1"
  local manifest_dir
  manifest_dir="$(chromium_manifest_dir "$browser")"
  remove_manifest "$manifest_dir/$HOST_NAME.json"
}

case "$BROWSER" in
  firefox)
    remove_firefox_manifest
    ;;
  chrome|chrome-for-testing|chromium)
    remove_chromium_manifest "$BROWSER"
    ;;
  all)
    remove_firefox_manifest
    remove_chromium_manifest chrome
    remove_chromium_manifest chrome-for-testing
    remove_chromium_manifest chromium
    ;;
esac

# Ask about data directory
if [[ -d "$DATA_DIR" ]]; then
  echo ""
  echo "Data directory exists: $DATA_DIR"
  read -r -p "Remove data directory and all archived tabs? [y/N] " reply
  if [[ "$reply" =~ ^[Yy]$ ]]; then
    rm -rf "$DATA_DIR"
    echo "Removed data directory"
  else
    echo "Data directory preserved"
  fi
fi

echo ""
echo "Tab Archive native host uninstalled"
