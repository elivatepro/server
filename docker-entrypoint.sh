#!/bin/sh
set -e

# Persistence model for platforms with a single mountable volume (e.g. Railway).
#
# The app lives at /notesx/app and references its data via RELATIVE paths
# (../db, ../userfiles), i.e. /notesx/db and /notesx/userfiles. We cannot mount
# the volume at /notesx because it would shadow /notesx/app (the compiled
# server) and the seed data dirs. Instead we mount the volume at /notesx/data
# and symlink the expected locations onto it:
#
#   /notesx/db        -> /notesx/data/db
#   /notesx/userfiles -> /notesx/data/userfiles
#
# This keeps the app code in the image while all persistent data lives on the
# volume. No application source changes required.

DATA_DIR=/notesx/data

# Create the persistent layout on the volume (idempotent).
mkdir -p "$DATA_DIR/db" \
         "$DATA_DIR/userfiles/css" \
         "$DATA_DIR/userfiles/notes" \
         "$DATA_DIR/userfiles/files"

# Point the app's expected paths at the volume via symlinks.
# Remove any baked-in dirs first so ln can create the links cleanly.
for name in db userfiles; do
  target="/notesx/$name"
  if [ ! -L "$target" ]; then
    rm -rf "$target"
    ln -s "$DATA_DIR/$name" "$target"
  fi
done

cd /notesx/app
exec node dist/index.js
