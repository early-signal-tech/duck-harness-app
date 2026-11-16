#!/bin/sh
# Build DH-1 as a real Mac app from this checkout and open it (npm run dh1:app).
#
# A built app is what macOS dictation needs: `npm run dh1` runs a bare binary, where
# dictation starts but inserts nothing. The build is a debug one (quick, about 20 s) and
# doesn't update itself: run this again after pulling changes. The agent isn't built in:
# the app runs it from the checkout next to this repo, so agent changes need only a restart.
set -e
cd "$(dirname "$0")/.."

APP="apps/dh1/src-tauri/target/debug/bundle/macos/DH-1.app"

npm run tauri -w dh1-app -- build --debug --bundles app

# `open` only brings a running copy forward, so quit the built DH-1 first (not the dev one,
# which runs from target/debug without an app bundle) and give it a moment to close.
if pkill -f "$APP/Contents/MacOS/" 2>/dev/null; then
  sleep 1
fi
open "$APP"
echo "Opened $APP"
