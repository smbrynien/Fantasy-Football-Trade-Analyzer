#!/bin/bash
# Run this file to start the Fantasy Football Trade Analyzer on Linux
# (in most file managers: right-click → "Run as a Program", or run ./"Start Trade Analyzer (Linux).sh" in a terminal).
cd "$(dirname "$0")" || exit 1
echo "Fantasy Football Trade Analyzer"
NODE_VERSION="$(tr -d '[:space:]' < .node-version)"
case "$(uname -m)" in aarch64|arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
NODE="runtime/linux-$ARCH/bin/node"
if [ ! -x "$NODE" ]; then
  if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 18 ] 2>/dev/null; then
    NODE="node"
  else
    echo "First-time setup: downloading Node.js (about 45 MB, only once)..."
    TMP="$(mktemp -d)"
    curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.gz" -o "$TMP/node.tgz" \
      && mkdir -p "runtime/linux-$ARCH" \
      && tar -xzf "$TMP/node.tgz" -C "runtime/linux-$ARCH" --strip-components=1 "node-v$NODE_VERSION-linux-$ARCH/bin/node" \
      || { rm -rf "$TMP"; echo "Download failed — check your internet connection and try again."; read -r -p "Press Enter to close."; exit 1; }
    rm -rf "$TMP"
  fi
fi
"$NODE" server/index.js --open
read -r -p "The Trade Analyzer has stopped. Press Enter to close."
