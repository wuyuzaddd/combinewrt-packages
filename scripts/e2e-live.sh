#!/usr/bin/env bash
# End-to-end acceptance for the live package feed.
#
# 1. Reads the live deployment audit (publish.json) and downloads every apk.
# 2. Checks every downloaded apk's sha256 against the audit record.
# 3. Installs all six packages from the live Pages feed into a throwaway
#    ImmortalWrt 25.12.2 rootfs with apk-tools 3.0.9 (no --allow-untrusted).
# 4. Re-runs the signed-index tamper tests against a local copy of the feed.
# 5. Optionally rolls the deployment back to an earlier build artifact and
#    proves the old index still installs, then restores the current build.
#
# Usage:
#   scripts/e2e-live.sh [--site-url URL] [--work-dir DIR]
#                       [--rollback-run RUN_ID] [--restore-run RUN_ID] [--rootfs TAR]
#
# Requires: bash, curl, node, python3, tar, chroot (root), gh for rollback.
set -euo pipefail

SITE_URL="https://wuyuzaddd.github.io/combinewrt-packages"
WORK_DIR=""
ROLLBACK_RUN=""
RESTORE_RUN=""
ROOTFS_ARG=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGES=(luci-lib-xterm taskd luci-lib-taskd luci-app-store luci-app-substore luci-app-fwlive)
ROOTFS_URL="https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/immortalwrt-25.12.2-x86_64-rootfs.tar.gz"
APK_URL="https://dl-cdn.alpinelinux.org/alpine/v3.23/main/x86_64/apk-tools-static-3.0.9-r0.apk"

log() { printf 'e2e-live: %s\n' "$*"; }
die() { printf 'e2e-live: ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --site-url) SITE_URL="$2"; shift 2 ;;
    --work-dir) WORK_DIR="$2"; shift 2 ;;
    --rollback-run) ROLLBACK_RUN="$2"; shift 2 ;;
    --restore-run) RESTORE_RUN="$2"; shift 2 ;;
    --rootfs) ROOTFS_ARG="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [ -z "$WORK_DIR" ]; then
  WORK_DIR="$(mktemp -d)"
fi
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"
ROOT="$WORK_DIR/root"
SITE_DIR="$WORK_DIR/site"
mkdir -p "$ROOT" "$SITE_DIR/x86_64" "$SITE_DIR/keys"

if [ "$(id -u)" -ne 0 ]; then
  die "must run as root to chroot"
fi

log "deployment $SITE_URL"

# --- live audit + feed -----------------------------------------------------
curl -fsSL --retry 3 -H 'Cache-Control: no-cache' "$SITE_URL/publish.json?t=$(date +%s)" -o "$WORK_DIR/publish.json"
curl -fsSL --retry 3 -H 'Cache-Control: no-cache' "$SITE_URL/catalog.json?t=$(date +%s)" -o "$SITE_DIR/catalog.json"
curl -fsSL --retry 3 -H 'Cache-Control: no-cache' "$SITE_URL/x86_64/packages.adb?t=$(date +%s)" -o "$SITE_DIR/x86_64/packages.adb"
mkdir -p "$SITE_DIR/keys"
curl -fsSL --retry 3 "$SITE_URL/keys/combinewrt-feed.pub.pem" -o "$SITE_DIR/keys/combinewrt-feed.pub.pem"

node -e '
  const a = require(process.argv[1]);
  console.log(`build ${a.buildRunId}, ${a.packages.length} versions, index ${a.index.sha256.slice(0, 12)}`);
' "$WORK_DIR/publish.json"

node -e '
  const fs = require("node:fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const out = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  for (const p of out.packages) {
    for (const v of p.versions) {
      console.log(`${p.name} ${v.version} ${v.fileSize} ${v.sha256}`);
    }
  }
' "$WORK_DIR/publish.json" "$SITE_DIR/catalog.json" > "$WORK_DIR/versions.txt"

while read -r name version size sha; do
  curl -fsSL --retry 3 -H 'Cache-Control: no-cache' \
    "$SITE_URL/x86_64/${name}-${version}.apk" -o "$SITE_DIR/x86_64/${name}-${version}.apk"
  actual="$(sha256sum "$SITE_DIR/x86_64/${name}-${version}.apk" | awk '{print $1}')"
  [ "$actual" = "$sha" ] || die "${name}-${version}.apk sha256 mismatch"
  [ "$(stat -c%s "$SITE_DIR/x86_64/${name}-${version}.apk")" = "$size" ] || die "${name}-${version}.apk size mismatch"
done < "$WORK_DIR/versions.txt"
log "downloaded $(wc -l < "$WORK_DIR/versions.txt") apks, sha256 matches the audit"

# --- tools -----------------------------------------------------------------
APK_TOOL="$WORK_DIR/apk.static"
if [ ! -x "$APK_TOOL" ]; then
  curl -fsSL --retry 3 -o "$WORK_DIR/apk-tools.apk" "$APK_URL"
  mkdir -p "$WORK_DIR/apkstatic"
  tar -xzf "$WORK_DIR/apk-tools.apk" -C "$WORK_DIR/apkstatic" --ignore-zeros
  cp "$WORK_DIR/apkstatic/sbin/apk.static" "$APK_TOOL"
  chmod +x "$APK_TOOL"
fi
[ -x "$APK_TOOL" ] || die "apk tool not executable"

ROOTFS_TAR="$WORK_DIR/rootfs.tar.gz"
if [ -n "$ROOTFS_ARG" ]; then
  ROOTFS_TAR="$ROOTFS_ARG"
fi
if [ ! -f "$ROOTFS_TAR" ]; then
  curl -fsSL --retry 5 --retry-all-errors -o "$ROOTFS_TAR" "$ROOTFS_URL"
fi
if [ ! -d "$ROOT/etc/apk" ]; then
  tar -xzf "$ROOTFS_TAR" -C "$ROOT"
fi

mkdir -p "$ROOT/etc/apk/keys" "$ROOT/tmp"
cp "$APK_TOOL" "$ROOT/tmp/apk"
chmod +x "$ROOT/tmp/apk"
cp "$SITE_DIR/keys/combinewrt-feed.pub.pem" "$ROOT/etc/apk/keys/"
if [ -f /etc/resolv.conf ]; then
  rm -f "$ROOT/tmp/resolv.conf"
  cp /etc/resolv.conf "$ROOT/tmp/resolv.conf"
fi

LIVE_FEED="$SITE_URL/x86_64/packages.adb"
echo "$LIVE_FEED" > "$ROOT/etc/apk/repositories"

# --- install from the live Pages feed -------------------------------------
log "apk update (live feed)"
chroot "$ROOT" /tmp/apk update >/dev/null
log "apk add ${PACKAGES[*]}"
chroot "$ROOT" /tmp/apk add "${PACKAGES[@]}" >/dev/null
installed="$(chroot "$ROOT" /tmp/apk list --installed)"
while read -r name version _; do
  echo "$installed" | awk -v pkg="${name}-${version}" '$1 == pkg { found = 1 } END { exit !found }' \
    || die "${name}-${version} is not installed"
done < <(awk '{print $1, $2}' "$WORK_DIR/versions.txt")
log "all six packages installed from $LIVE_FEED"

# --- tamper negatives against the local copy ------------------------------
log "running signed-index tamper tests on a local copy"
"$SCRIPT_DIR/feed-client-test.sh" --site "$SITE_DIR" --work-dir "$WORK_DIR/tamper" \
  --apk-tool "$APK_TOOL" --rootfs "$ROOTFS_TAR"
log "tamper tests passed"

# --- deployment rollback ---------------------------------------------------
wait_for_publish() {
  local previous="$1"
  local id=""
  for _ in $(seq 1 60); do
    id="$(gh run list -R wuyuzaddd/combinewrt-packages --workflow publish --limit 1 --json databaseId --jq '.[0].databaseId')"
    if [ "$id" != "$previous" ]; then
      status="$(gh run view "$id" -R wuyuzaddd/combinewrt-packages --json status,conclusion --jq '"\(.status) \(.conclusion)"')"
      case "$status" in
        "completed success") log "publish run $id succeeded"; return 0 ;;
        completed*) die "publish run $id failed: $status" ;;
      esac
    fi
    sleep 10
  done
  die "publish run did not finish in time"
}

if [ -n "$ROLLBACK_RUN" ]; then
  [ -n "$RESTORE_RUN" ] || die "--restore-run is required with --rollback-run"
  before="$(gh run list -R wuyuzaddd/combinewrt-packages --workflow publish --limit 1 --json databaseId --jq '.[0].databaseId')"
  log "rolling back to build artifact $ROLLBACK_RUN"
  gh workflow run publish.yml -R wuyuzaddd/combinewrt-packages -f build_run_id="$ROLLBACK_RUN"
  wait_for_publish "$before"
  rolled="$(curl -fsSL -H 'Cache-Control: no-cache' "$SITE_URL/publish.json?t=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).buildRunId))')"
  [ "$rolled" = "$ROLLBACK_RUN" ] || die "rollback published build $rolled, expected $ROLLBACK_RUN"
  chroot "$ROOT" /tmp/apk update >/dev/null
  chroot "$ROOT" /tmp/apk add "${PACKAGES[@]}" >/dev/null
  log "old index still installs after rollback"

  before="$(gh run list -R wuyuzaddd/combinewrt-packages --workflow publish --limit 1 --json databaseId --jq '.[0].databaseId')"
  log "restoring deployment from build artifact $RESTORE_RUN"
  gh workflow run publish.yml -R wuyuzaddd/combinewrt-packages -f build_run_id="$RESTORE_RUN"
  wait_for_publish "$before"
fi

log "PASS"
