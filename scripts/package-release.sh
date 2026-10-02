#!/usr/bin/env bash
# Builds ready-to-run ZIPs for non-technical users (no installation needed):
#   dist/TradeAnalyzer-Windows.zip   app + Node.js for Windows (x64; runs on ARM via emulation)
#   dist/TradeAnalyzer-Mac.zip       app + Node.js for Apple Silicon and Intel Macs
#   dist/TradeAnalyzer-Linux.zip     app + Node.js for Linux x64
# Uses only committed files (git archive), so cached data / secrets are never included.
# Requires: git, curl, tar, unzip, zip.  Usage: bash scripts/package-release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(tr -d '[:space:]' < .node-version)"
APP="Fantasy Football Trade Analyzer"
OUT="dist"
CACHE="${NODE_DIST_CACHE:-scripts/.cache/node-dist}"
rm -rf "$OUT"; mkdir -p "$OUT" "$CACHE"

fetch() { # $1 = file name on nodejs.org
  [ -f "$CACHE/$1" ] || curl -fsSL "https://nodejs.org/dist/v$V/$1" -o "$CACHE/$1"
}

stage() { # $1 = platform label; leaves a clean copy of the app in $OUT/stage-$1/$APP
  local dir="$OUT/stage-$1/$APP"
  mkdir -p "$dir"
  git archive --format=tar HEAD | tar -x -C "$dir"
  rm -rf "$dir/tests" "$dir/.github" "$dir/CLAUDE.md" "$dir/docs/img" "$dir/scripts/package-release.sh"
  echo "$dir"
}

zipit() { # $1 = platform label, $2 = zip name
  (cd "$OUT/stage-$1" && zip -qr -X "../$2" "$APP")
  rm -rf "$OUT/stage-$1"
  echo "  built $OUT/$2 ($(du -h "$OUT/$2" | cut -f1))"
}

echo "Packaging with Node.js v$V"

# ---------- Windows ----------
d="$(stage windows)"
rm -f "$d/Start Trade Analyzer (Mac).command" "$d/Start Trade Analyzer (Linux).sh"
fetch "node-v$V-win-x64.zip"
mkdir -p "$d/runtime/win-x64"
unzip -q -j "$CACHE/node-v$V-win-x64.zip" "node-v$V-win-x64/node.exe" -d "$d/runtime/win-x64"
zipit windows TradeAnalyzer-Windows.zip

# ---------- Mac (both chips) ----------
d="$(stage mac)"
rm -f "$d/Start Trade Analyzer (Windows).bat" "$d/Start Trade Analyzer (Linux).sh"
for A in arm64 x64; do
  fetch "node-v$V-darwin-$A.tar.gz"
  mkdir -p "$d/runtime/darwin-$A"
  tar -xzf "$CACHE/node-v$V-darwin-$A.tar.gz" -C "$d/runtime/darwin-$A" --strip-components=1 "node-v$V-darwin-$A/bin/node"
done
chmod +x "$d/Start Trade Analyzer (Mac).command"
zipit mac TradeAnalyzer-Mac.zip

# ---------- Linux ----------
d="$(stage linux)"
rm -f "$d/Start Trade Analyzer (Windows).bat" "$d/Start Trade Analyzer (Mac).command"
fetch "node-v$V-linux-x64.tar.gz"
mkdir -p "$d/runtime/linux-x64"
tar -xzf "$CACHE/node-v$V-linux-x64.tar.gz" -C "$d/runtime/linux-x64" --strip-components=1 "node-v$V-linux-x64/bin/node"
chmod +x "$d/Start Trade Analyzer (Linux).sh"
zipit linux TradeAnalyzer-Linux.zip
