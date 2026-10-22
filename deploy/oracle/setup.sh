#!/usr/bin/env bash
# One-time (and safe to re-run) setup for CertBench on an Oracle Cloud Ubuntu VM.
#
# The GitHub Actions workflow (.github/workflows/deploy-oracle.yml) copies the code to
# /opt/certbench and runs this script as root on every deploy, so the server always matches the
# repo. It can also be run by hand:
#
#   sudo DOMAIN=certbench.example.com bash /opt/certbench/deploy/oracle/setup.sh < certbench.env
#
# DOMAIN    the site's domain. Caddy gets a free HTTPS certificate for it. Leave it empty to serve
#           plain HTTP on port 80 (handy for a first test by IP address).
# stdin     optional: the app's environment variables (KEY=value lines, as copied from Railway's
#           Variables > Raw Editor). Written to /etc/certbench/certbench.env. If nothing is piped
#           in, the existing file is kept.
set -euo pipefail

APP_DIR=/opt/certbench
DATA_DIR=/var/lib/certbench
BACKUP_DIR=/var/backups/certbench
ENV_DIR=/etc/certbench
ENV_FILE=$ENV_DIR/certbench.env
DOMAIN=${DOMAIN:-}
HERE=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# ---- Swap: the free AMD VM has 1 GB RAM, which npm ci can run out of ----
if [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  echo "[setup] adding a 2 GB swap file"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- Packages: Node 22, Caddy ----
apt_updated=
apt_install(){ [ -n "$apt_updated" ] || { apt-get update -qq; apt_updated=1; }; apt-get install -y -qq "$@" >/dev/null; }

command -v rsync >/dev/null && command -v gpg >/dev/null || apt_install rsync gnupg ca-certificates curl

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 22 ]; then
  echo "[setup] installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt_updated=1
  apt_install nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "[setup] installing Caddy"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt_updated=
  apt_install caddy
fi

# ---- Firewall: Oracle's Ubuntu images reject everything but SSH in iptables ----
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true

# ---- User, folders ----
id certbench >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin certbench
install -d -o certbench -g certbench -m 750 "$DATA_DIR" "$BACKUP_DIR"
install -d -o root -g certbench -m 750 "$ENV_DIR"

# ---- Environment variables ----
# Values from stdin first, then the settings this server needs, which win over anything pasted
# (Railway's DB_PATH, for example, points at a folder that doesn't exist here).
# NODE_ENV=production also keeps the free "dev mode" checkout off (see src/payments.js).
if [ ! -t 0 ]; then
  pasted=$(cat)
  if [ -n "$pasted" ]; then
    echo "[setup] writing $ENV_FILE"
    {
      printf '%s\n' "$pasted" | tr -d '\r' | grep -Ev '^[[:space:]]*(export[[:space:]]+)?(NODE_ENV|DB_PATH|PORT|RAILWAY_[A-Z_]*)[[:space:]]*=' || true
      echo "NODE_ENV=production"
      echo "DB_PATH=$DATA_DIR/certbench.db"
      echo "PORT=3000"
    } > "$ENV_FILE.tmp"
    chown root:certbench "$ENV_FILE.tmp" && chmod 640 "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
fi
if [ ! -f "$ENV_FILE" ]; then
  printf 'NODE_ENV=production\nDB_PATH=%s/certbench.db\nPORT=3000\n' "$DATA_DIR" > "$ENV_FILE"
  chown root:certbench "$ENV_FILE" && chmod 640 "$ENV_FILE"
  echo "[setup] WARNING: $ENV_FILE has no JWT_SECRET, email or Razorpay keys yet" >&2
fi

# ---- Service, HTTPS proxy, nightly backup ----
install -m 644 "$HERE/certbench.service" /etc/systemd/system/certbench.service
systemctl daemon-reload
systemctl enable certbench >/dev/null 2>&1

site=${DOMAIN:-:80}
sed "s|__SITE__|$site|" "$HERE/Caddyfile" > /etc/caddy/Caddyfile.new
if ! cmp -s /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile; then
  mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
else
  rm /etc/caddy/Caddyfile.new
fi

# 21:00 UTC = 02:30 IST
cat > /etc/cron.d/certbench-backup <<CRON
30 21 * * * certbench /usr/bin/node $APP_DIR/deploy/oracle/backup.js >> $BACKUP_DIR/backup.log 2>&1
CRON

echo "[setup] done (site: $site)"
