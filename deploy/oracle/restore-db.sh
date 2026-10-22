#!/usr/bin/env bash
# Replace the live database with a copy, for example the one taken from Railway.
#
#   sudo bash /opt/certbench/deploy/oracle/restore-db.sh ~/certbench.db
#
# Accepts a plain .db file, a .db.gz from the nightly backups, or a base64 text dump. The current
# database is kept next to it as certbench.db.before-restore-<time>.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ $# = 1 ] && [ -f "$1" ] || { echo "Usage: $0 <backup file>" >&2; exit 1; }

DB=/var/lib/certbench/certbench.db
NEW=$DB.incoming

node "$(dirname "$0")/decode-backup.js" "$1" "$NEW"
chown certbench:certbench "$NEW"

systemctl stop certbench
old=$DB.before-restore-$(date -u +%Y%m%d-%H%M%S)
for ext in "" -wal -shm; do
  if [ -f "$DB$ext" ]; then mv "$DB$ext" "$old$ext"; fi
done
mv "$NEW" "$DB"
systemctl start certbench
echo "Restored. The site is running on the copied data."
