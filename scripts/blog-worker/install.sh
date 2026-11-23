#!/bin/bash
# Installs (or reinstalls) the Blog worker as a login item for the current user:
#   bash scripts/blog-worker/install.sh
# Remove it with:
#   bash scripts/blog-worker/uninstall.sh
set -euo pipefail
LABEL="com.bullorbear.blog-worker"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/BullOrBear"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/bb-blog-worker.log"

mkdir -p "$SUPPORT" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
# Copied off the external drive so launchd can start it before the drive mounts.
cp "$HERE/run.sh" "$SUPPORT/blog-worker.sh"
chmod 755 "$SUPPORT/blog-worker.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SUPPORT/blog-worker.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart if it crashes or the drive is unplugged; never more than once a minute. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <!-- Give a running article time to save before a logout/shutdown kills it. -->
  <key>ExitTimeOut</key>
  <integer>60</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL — starts at every login. Log: $LOG"
