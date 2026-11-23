#!/bin/bash
# Launcher for the Blog worker, run at login by the com.bullorbear.blog-worker
# LaunchAgent (installed by install.sh). launchd gives a bare PATH, so node, npm and
# the claude CLI are added explicitly. The repo lives on the external T7 drive,
# which may not be mounted yet at login, so this waits for it instead of failing.
set -u
REPO="${BB_REPO:-/Volumes/T7 Shield/BB-ki-Team}"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

waited=0
until [ -f "$REPO/package.json" ] && [ -x "$REPO/node_modules/.bin/tsx" ]; do
  if [ "$waited" -eq 0 ]; then echo "$(date '+%F %T') waiting for $REPO (T7 drive not mounted?)"; fi
  waited=1
  sleep 30
done

cd "$REPO" || exit 1
echo "$(date '+%F %T') starting Blog worker from $REPO"
# exec: launchd's stop signal goes straight to the worker, which finishes the job
# in progress before exiting.
exec ./node_modules/.bin/tsx --env-file=.env apps/api/src/blogWorker.ts
