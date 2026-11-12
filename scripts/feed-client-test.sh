#!/usr/bin/env bash
# Real-client test for the signed apk feed.
#
# Takes a generated, unsigned Pages site directory, signs its index with a
# throwaway EC P-256 key, serves it over HTTP, boots a throwaway ImmortalWrt
# 25.12.2 x86_64 rootfs with apk-tools 3.0.9 and installs all six packages.
# Then it proves that a tampered index and a tampered apk are rejected.
#
# Usage: scripts/feed-client-test.sh --site site [--work-dir DIR] [--port 19090]
#        [--apk-tool /path/to/apk.static] [--rootfs /path/to/rootfs.tar.gz]
#
# Requires: bash, curl, openssl, python3, tar, chroot (root or sudo).
set -euo pipefail

SITE=""
WORK_DIR=""
PORT=19090
APK_TOOL=""
ROOTFS_TAR=""
PACKAGES=(luci-lib-xterm taskd luci-lib-taskd luci-app-store luci-app-substore luci-app-fwlive)
ROOTFS_URL="https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/immortalwrt-25.12.2-x86-64-rootfs.tar.gz"
APK_URL="https://dl-cdn.alpinelinux.org/alpine/v3.23/main/x86_64/apk-tools-static-3.0.9-r0.apk"

log() { printf 'feed-client-test: %s\n' "$*"; }
die() { printf 'feed-client-test: ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="$2"; shift 2 ;;
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --apk-tool) APK_TOOL="$2"; shift 2 ;;
    --rootfs) ROOTFS_TAR="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$SITE" ] || die "--site is required"
[ -f "$SITE/catalog.json" ] || die "$SITE/catalog.json not found"
[ -d "$SITE/x86_64" ] || die "$SITE/x86_64 not found"

if [ -z "$WORK_DIR" ]; then
  WORK_DIR="$(mktemp -d)"
fi
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"

SUDO=()
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "not root and sudo is unavailable"
  SUDO=(sudo)
fi

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- apk-tools 3.0.9 -------------------------------------------------------
if [ -z "$APK_TOOL" ]; then
  APK_TOOL="$WORK_DIR/apk.static"
  if [ ! -x "$APK_TOOL" ]; then
    log "downloading apk-tools 3.0.9"
    curl -fsSL --retry 3 -o "$WORK_DIR/apk-tools-static.apk" "$APK_URL"
    mkdir -p "$WORK_DIR/apk-tools"
    tar -xzf "$WORK_DIR/apk-tools-static.apk" --ignore-zeros -C "$WORK_DIR/apk-tools"
    cp "$WORK_DIR/apk-tools/sbin/apk.static" "$APK_TOOL"
    chmod +x "$APK_TOOL"
  fi
fi
[ -x "$APK_TOOL" ] || die "apk tool not executable: $APK_TOOL"
"$APK_TOOL" version >/dev/null 2>&1 || "$APK_TOOL" --version >/dev/null

# --- throwaway signing key -------------------------------------------------
KEY="$WORK_DIR/test-feed-key.pem"
PUB="$WORK_DIR/test-feed.pub.pem"
if [ ! -f "$KEY" ]; then
  log "generating throwaway EC P-256 signing key"
  openssl ecparam -name prime256v1 -genkey -noout -out "$KEY" 2>/dev/null
  chmod 600 "$KEY"
fi
openssl ec -in "$KEY" -pubout -out "$PUB" 2>/dev/null

# --- isolated copy of the site --------------------------------------------
FEED="$WORK_DIR/site"
rm -rf "$FEED"
cp -a "$SITE" "$FEED"
mkdir -p "$FEED/keys"
cp "$PUB" "$FEED/keys/combinewrt-feed.pub.pem"

log "signing index with throwaway key"
(
  cd "$FEED/x86_64"
  # shellcheck disable=SC2012
  "$APK_TOOL" mkndx --allow-untrusted --sign-key "$KEY" \
    --description "combinewrt feed client test $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --output packages.adb ./*.apk
)
"$APK_TOOL" adbdump --format json "$FEED/x86_64/packages.adb" > "$WORK_DIR/index.json"
node -e '
  const fs = require("node:fs");
  const index = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const catalog = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const idx = new Map(index.packages.map((p) => [p.name + "@" + p.version, p]));
  let expected = 0;
  for (const pkg of catalog.packages) {
    for (const v of pkg.versions) {
      expected += 1;
      if (!idx.has(pkg.name + "@" + v.version)) {
        throw new Error("index missing " + pkg.name + "@" + v.version);
      }
    }
  }
  if (index.packages.length !== expected) throw new Error("index/catalog version count mismatch");
' "$WORK_DIR/index.json" "$SITE/catalog.json"

# --- throwaway rootfs ------------------------------------------------------
ROOT="$WORK_DIR/root"
if [ ! -d "$ROOT" ]; then
  if [ -z "$ROOTFS_TAR" ]; then
    ROOTFS_TAR="$WORK_DIR/rootfs.tar.gz"
    if [ ! -f "$ROOTFS_TAR" ]; then
      log "downloading ImmortalWrt 25.12.2 x86_64 rootfs"
      curl -fsSL --retry 3 -o "$ROOTFS_TAR" "$ROOTFS_URL"
    fi
  fi
  mkdir -p "$ROOT"
  log "extracting rootfs"
  "${SUDO[@]}" tar -xzf "$ROOTFS_TAR" -C "$ROOT"
fi

"${SUDO[@]}" cp "$APK_TOOL" "$ROOT/tmp/apk"
"${SUDO[@]}" chmod +x "$ROOT/tmp/apk"
"${SUDO[@]}" rm -f "$ROOT/etc/resolv.conf"
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' | "${SUDO[@]}" tee "$ROOT/etc/resolv.conf" >/dev/null
"${SUDO[@]}" mkdir -p "$ROOT/etc/apk/keys"
"${SUDO[@]}" cp "$PUB" "$ROOT/etc/apk/keys/combinewrt-feed.pub.pem"
"${SUDO[@]}" rm -f "$ROOT/etc/apk/repositories"
printf 'http://127.0.0.1:%s/x86_64/packages.adb\n' "$PORT" | "${SUDO[@]}" tee -a "$ROOT/etc/apk/repositories" >/dev/null
"${SUDO[@]}" rm -rf "$ROOT/var/cache/apk"
"${SUDO[@]}" mkdir -p "$ROOT/var/cache/apk"

# --- serve the feed -------------------------------------------------------
log "serving $FEED on 127.0.0.1:$PORT"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$FEED" >"$WORK_DIR/http.log" 2>&1 &
SERVER_PID=$!
ready=0
for _ in $(seq 1 50); do
  if curl -fs --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/catalog.json" 2>/dev/null; then ready=1; break; fi
  sleep 0.2
done
[ "$ready" = 1 ] || die "feed server did not start"
curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/x86_64/packages.adb" || die "feed server did not serve packages.adb"

apk_guest() { "${SUDO[@]}" chroot "$ROOT" /tmp/apk "$@"; }

log "apk update (signed index, trusted key, no --allow-untrusted)"
apk_guest update 2>&1 | tee "$WORK_DIR/apk-update.log"
! grep -qiE 'untrusted|BAD signature|verification failed|invalid signature' "$WORK_DIR/apk-update.log" \
  || die "apk update rejected the signed index"

log "installing six packages"
apk_guest add "${PACKAGES[@]}" 2>&1 | tee "$WORK_DIR/apk-add.log"

node -e '
  const fs = require("node:fs");
  const catalog = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const pkg of catalog.packages) {
    process.stdout.write(pkg.name + " " + pkg.latest.version + "\n");
  }
' "$SITE/catalog.json" > "$WORK_DIR/expected-versions.txt"

while read -r name version; do
  listing="$(apk_guest list --installed "$name" 2>/dev/null | head -1 || true)"
  case "$listing" in
    *"$name-$version"*) ;;
    *) die "expected $name-$version installed, got: ${listing:-<not installed>}" ;;
  esac
done < "$WORK_DIR/expected-versions.txt"
log "all six packages installed at catalog versions"

# --- negative: tampered index must be rejected ----------------------------
cp "$FEED/x86_64/packages.adb" "$WORK_DIR/packages.adb.orig"
python3 - "$FEED/x86_64/packages.adb" <<'PY'
import sys
path = sys.argv[1]
with open(path, "r+b") as f:
    data = bytearray(f.read())
    data[-1] ^= 0xFF
    f.seek(0)
    f.write(data)
PY
touch -d '2030-01-01 00:00:00' "$FEED/x86_64/packages.adb"
"${SUDO[@]}" rm -rf "$ROOT/var/cache/apk"/*
set +e
apk_guest update >"$WORK_DIR/tampered-index.log" 2>&1
status=$?
set -e
cp "$WORK_DIR/packages.adb.orig" "$FEED/x86_64/packages.adb"
touch -d '2030-01-01 00:00:00' "$FEED/x86_64/packages.adb"
[ "$status" -ne 0 ] || die "apk update accepted a tampered index"
grep -qiE 'untrusted|BAD signature|verification failed|invalid signature|checksum|ADB block error|file format is invalid' "$WORK_DIR/tampered-index.log" \
  || die "tampered index failed without a signature/checksum error"
log "tampered index rejected (exit $status)"

# --- negative: structurally valid index signed by a rogue key ------------
ROGUE_KEY="$WORK_DIR/rogue-key.pem"
if [ ! -f "$ROGUE_KEY" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$ROGUE_KEY" 2>/dev/null
fi
(
  cd "$FEED/x86_64"
  "$APK_TOOL" mkndx --allow-untrusted --sign-key "$ROGUE_KEY" \
    --description "rogue test index" --output packages.adb ./*.apk
)
touch -d '2030-01-01 00:00:00' "$FEED/x86_64/packages.adb"
"${SUDO[@]}" rm -rf "$ROOT/var/cache/apk"/*
set +e
apk_guest update >"$WORK_DIR/rogue-index.log" 2>&1
status=$?
set -e
cp "$WORK_DIR/packages.adb.orig" "$FEED/x86_64/packages.adb"
touch -d '2030-01-01 00:00:00' "$FEED/x86_64/packages.adb"
[ "$status" -ne 0 ] || die "apk update accepted an index signed by an untrusted key"
grep -qiE 'untrusted|BAD signature|verification failed' "$WORK_DIR/rogue-index.log" \
  || die "rogue-signed index failed without an untrusted-signature error"
log "rogue-signed index rejected (exit $status)"

# --- negative: tampered apk must be rejected ------------------------------
VICTIM="luci-app-store"
VICTIM_VERSION="$(awk -v n="$VICTIM" '$1 == n { print $2 }' "$WORK_DIR/expected-versions.txt")"
[ -n "$VICTIM_VERSION" ] || die "no version for $VICTIM"
VICTIM_FILE="$FEED/x86_64/${VICTIM}-${VICTIM_VERSION}.apk"
[ -f "$VICTIM_FILE" ] || die "missing $VICTIM_FILE"
cp "$VICTIM_FILE" "$WORK_DIR/victim.apk.orig"
python3 - "$VICTIM_FILE" <<'PY'
import sys
path = sys.argv[1]
with open(path, "r+b") as f:
    data = bytearray(f.read())
    if len(data) < 256:
        raise SystemExit("apk too small to tamper")
    data[128] ^= 0xFF
    f.seek(0)
    f.write(data)
PY
touch -d '2030-01-01 00:00:00' "$VICTIM_FILE"
apk_guest del "$VICTIM" >/dev/null 2>&1 || true
set +e
apk_guest add "$VICTIM" >"$WORK_DIR/tampered-apk.log" 2>&1
status=$?
set -e
cp "$WORK_DIR/victim.apk.orig" "$VICTIM_FILE"
touch -d '2030-01-01 00:00:00' "$VICTIM_FILE"
[ "$status" -ne 0 ] || die "apk add accepted a tampered package"
grep -qiE 'checksum|BAD signature|verification failed|invalid|corrupt' "$WORK_DIR/tampered-apk.log" \
  || die "tampered apk failed without a checksum/signature error"
log "tampered apk rejected (exit $status)"

log "PASS"
