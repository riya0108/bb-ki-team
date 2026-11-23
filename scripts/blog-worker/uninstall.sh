#!/bin/bash
# Stops the Blog worker and removes it from login items.
set -u
LABEL="com.bullorbear.blog-worker"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" "$HOME/Library/Application Support/BullOrBear/blog-worker.sh"
echo "Removed $LABEL"
