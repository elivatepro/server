#!/bin/sh
set -e

# When a persistent volume is mounted at /notesx (e.g. on Railway), it shadows
# the db/ and userfiles/ folders that were baked into the image. The server
# opens ../db/database.db on startup and writes uploads to ../userfiles, so we
# recreate those directories here before Node boots. Safe to run every start.
mkdir -p /notesx/db \
         /notesx/userfiles/css \
         /notesx/userfiles/notes \
         /notesx/userfiles/files

exec node dist/index.js
