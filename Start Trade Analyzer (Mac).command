#!/bin/bash
# Double-click this file to start the Fantasy Football Trade Analyzer on a Mac.
# It uses the bundled runtime if present, otherwise downloads a private copy of Node.js into ./runtime (once).
cd "$(dirname "$0")" || exit 1
clear
echo "=============================================="
echo "   Fantasy Football Trade Analyzer"
echo "=============================================="
# Files downloaded from the internet are marked "quarantined"; remove the mark from this folder only.
xattr -dr com.apple.quarantine . 2>/dev/null
NODE_VERSION="$(tr -d '[:space:]' < .node-version)"
if [ "$(uname -m)" = "arm64" ]; then ARCH=arm64; else ARCH=x64; fi
NODE="runtime/darwin-$ARCH/bin/node"
if [ ! -x "$NODE" ]; then
  if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 18 ] 2>/dev/null; then
    NODE="node"
  else
    echo
    echo "First-time setup: downloading the app's engine (Node.js, about 45 MB)."
    echo "This only happens once. Please wait..."
    TMP="$(mktemp -d)"
    if curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$ARCH.tar.gz" -o "$TMP/node.tgz" \
       && mkdir -p "runtime/darwin-$ARCH" \
       && tar -xzf "$TMP/node.tgz" -C "runtime/darwin-$ARCH" --strip-components=1 "node-v$NODE_VERSION-darwin-$ARCH/bin/node"; then
      rm -rf "$TMP"
    else
      rm -rf "$TMP"
      echo
      echo "Download failed. Please check your internet connection and double-click this file again."
      read -n 1 -s -r -p "Press any key to close this window."
      exit 1
    fi
  fi
fi
echo
"$NODE" server/index.js --open
echo
read -n 1 -s -r -p "The Trade Analyzer has stopped. Press any key to close this window."
