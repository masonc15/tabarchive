#!/bin/bash
# Uninstall Tab Archive native messaging host for Firefox
set -e

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
DATA_DIR="$HOME/.tabarchive"

# Remove manifest
if [ -f "$MANIFEST_FILE" ]; then
    rm "$MANIFEST_FILE"
    echo "Removed native messaging manifest: $MANIFEST_FILE"
else
    echo "Manifest not found: $MANIFEST_FILE"
fi

# Ask about data directory
if [ -d "$DATA_DIR" ]; then
    echo ""
    echo "Data directory exists: $DATA_DIR"
    read -p "Remove data directory and all archived tabs? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$DATA_DIR"
        echo "Removed data directory"
    else
        echo "Data directory preserved"
    fi
fi

echo ""
echo "Tab Archive native host uninstalled"
