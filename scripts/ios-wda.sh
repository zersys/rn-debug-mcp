#!/bin/sh
set -eu

PROJECT_PATH="${WDA_PROJECT_PATH:-./WebDriverAgent/WebDriverAgent.xcodeproj}"
SCHEME="${WDA_SCHEME:-WebDriverAgentRunner}"
DEVICE_ID="${WDA_DEVICE_ID:-}"
DESTINATION="${WDA_DESTINATION:-}"

if [ -z "$DEVICE_ID" ] && [ -z "$DESTINATION" ]; then
  DEVICE_ID="$(xcrun simctl list devices | sed -n 's/.*(\([A-Fa-f0-9-][A-Fa-f0-9-]*\)) (Booted).*/\1/p' | head -n 1)"
fi

if [ -z "$DESTINATION" ]; then
  if [ -z "$DEVICE_ID" ]; then
    echo "No booted iOS simulator found. Boot a simulator or set WDA_DEVICE_ID/WDA_DESTINATION." >&2
    exit 1
  fi
  DESTINATION="id=$DEVICE_ID"
fi

echo "Starting WebDriverAgent..."
echo "  project: $PROJECT_PATH"
echo "  scheme: $SCHEME"
echo "  destination: $DESTINATION"

if [ "${WDA_DRY_RUN:-0}" = "1" ]; then
  echo "Dry run enabled; skipping xcodebuild."
  exit 0
fi

exec xcodebuild -project "$PROJECT_PATH" -scheme "$SCHEME" -destination "$DESTINATION" test
