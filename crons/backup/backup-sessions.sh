#!/bin/bash
#
# backup-sessions.sh: local backup of your Claude Code sessions and memory.
#
# WHAT  Mirrors ~/.claude/projects/ (every session .jsonl plus each project's memory/)
#       to a local backup tree, and keeps dated compressed snapshots for point-in-time
#       recovery.
#
# WHY   Session files live in ~/.claude, which is not under git. The biggest risk is an
#       accidental delete. The mirror runs WITHOUT --delete, so a file you remove from
#       the source stays in the mirror. Snapshots add point-in-time copies.
#
# DATA PROTECTION
#       LOCAL ONLY. Session transcripts can hold customer or colleague names, private details, and
#       pasted credentials. This script never touches the network or a cloud folder,
#       and it creates the backup tree with owner-only permissions (700). If you want
#       off-machine protection, point Time Machine or an encrypted disk at the backup
#       folder yourself. Do not sync it to a shared or personal cloud drive.
#
# DISK USE
#       The mirror only grows (nothing is ever deleted from it), and each daily
#       snapshot is a compressed copy of the whole mirror. A heavy Claude Code user can
#       have several GB of session files, so budget for the mirror plus RETAIN_SNAPSHOTS
#       compressed copies of it. The script skips a snapshot when free space is short
#       (MIN_FREE_FACTOR). Lower RETAIN_SNAPSHOTS if space is tight.
#
# Configuration (environment variables, all optional):
#   CLAUDE_PROJECTS_DIR   source folder            default: ~/.claude/projects
#   CLAUDE_BACKUP_ROOT    where backups are kept   default: ~/.claude/backups
#   CLAUDE_BACKUP_LOGS    log folder               default: ~/.claude/crons/logs
#   RETAIN_SNAPSHOTS      snapshots to keep        default: 7
#   MIN_FREE_FACTOR       skip the snapshot unless the disk has at least this many times
#                         the mirror's size free   default: 2
#
# Usage:
#   ./backup-sessions.sh             # run a backup now
#   ./backup-sessions.sh --dry-run   # report what would happen; write nothing
#
# Opt-in schedule: `crons/manage.sh install --with-backup` (com.context.session-backup, twice a day).
# It never turns on by default, because it keeps a second copy of every session transcript.

set -uo pipefail
umask 077

SRC="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}/"
BACKUP_ROOT="${CLAUDE_BACKUP_ROOT:-$HOME/.claude/backups}"
MIRROR="$BACKUP_ROOT/projects-mirror"
SNAP_DIR="$BACKUP_ROOT/snapshots"
LOG_DIR="${CLAUDE_BACKUP_LOGS:-$HOME/.claude/crons/logs}"
LOCK="$BACKUP_ROOT/.backup.lock"
RETAIN_SNAPSHOTS="${RETAIN_SNAPSHOTS:-7}"
MIN_FREE_FACTOR="${MIN_FREE_FACTOR:-2}"
STALE_LOCK_MINUTES=360

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

TS="$(date '+%Y-%m-%d %H:%M:%S')"
log() { echo "[$TS] $*"; }

# Guard: RETAIN_SNAPSHOTS must be a positive integer, or the prune step could misbehave.
case "$RETAIN_SNAPSHOTS" in
  ''|*[!0-9]*|0) log "ERROR: RETAIN_SNAPSHOTS must be a positive integer (got '$RETAIN_SNAPSHOTS')."; exit 1 ;;
esac
case "$MIN_FREE_FACTOR" in
  ''|*[!0-9]*) log "ERROR: MIN_FREE_FACTOR must be a whole number (got '$MIN_FREE_FACTOR')."; exit 1 ;;
esac

# --- sanity: the source must exist and hold sessions before we touch any backup ---
if [ ! -d "$SRC" ]; then
  log "ERROR: source $SRC does not exist; aborting (will not touch backups)."
  exit 1
fi
SRC_COUNT=$(find "$SRC" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
if [ "$SRC_COUNT" -eq 0 ]; then
  log "ERROR: source has 0 session files, which looks wrong; aborting to protect existing backups."
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "dry run: would mirror $SRC_COUNT session files from $SRC to $MIRROR"
  log "dry run: would write snapshot $SNAP_DIR/projects-$(date '+%Y-%m-%d').tar.gz if none exists today"
  log "dry run: would keep the newest $RETAIN_SNAPSHOTS snapshots"
  exit 0
fi

mkdir -p "$MIRROR" "$SNAP_DIR" "$LOG_DIR"
chmod 700 "$BACKUP_ROOT" "$MIRROR" "$SNAP_DIR" 2>/dev/null || true

# --- single-instance lock. A lock older than STALE_LOCK_MINUTES is a crashed run; clear it. ---
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +"$STALE_LOCK_MINUTES" 2>/dev/null)" ]; then
  log "clearing stale lock (older than $STALE_LOCK_MINUTES minutes)"
  rmdir "$LOCK" 2>/dev/null || true
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  log "another backup is running (lock present); skipping."
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# --- 1. MIRROR (incremental, never --delete: a deleted source stays backed up) ---
log "mirroring $SRC_COUNT session files -> $MIRROR"
rsync -a --no-perms --chmod=Du+rwx,Fu+rw "$SRC" "$MIRROR/" 2>>"$LOG_DIR/session-backup.err"
MIRROR_RC=$?
if [ "$MIRROR_RC" -ne 0 ]; then
  log "WARN: rsync exited $MIRROR_RC (see $LOG_DIR/session-backup.err)"
fi

# --- 2. SNAPSHOT (one compressed, dated tarball per day) ---
TODAY="$(date '+%Y-%m-%d')"
SNAP="$SNAP_DIR/projects-$TODAY.tar.gz"
if [ -f "$SNAP" ]; then
  log "snapshot for $TODAY already exists; skipping snapshot."
else
  # Disk guard: a snapshot is a compressed copy of the whole mirror. Skip it (the mirror
  # above still ran) when the disk is too full to hold one comfortably.
  MIRROR_KB=$(du -sk "$MIRROR" 2>/dev/null | cut -f1)
  FREE_KB=$(df -Pk "$BACKUP_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')
  if [ -n "$MIRROR_KB" ] && [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt $((MIRROR_KB * MIN_FREE_FACTOR)) ]; then
    log "WARN: only ${FREE_KB} KB free for a ${MIRROR_KB} KB mirror (needs ${MIN_FREE_FACTOR}x); skipping snapshot."
  else
    log "creating snapshot $SNAP"
    # Tar from the mirror (stable, just synced) rather than the live source.
    if tar -czf "$SNAP.tmp" -C "$BACKUP_ROOT" "projects-mirror" 2>>"$LOG_DIR/session-backup.err"; then
      mv "$SNAP.tmp" "$SNAP"
      log "snapshot done ($(du -h "$SNAP" | cut -f1))"
    else
      rm -f "$SNAP.tmp"
      log "WARN: snapshot failed (see $LOG_DIR/session-backup.err)"
    fi
  fi
fi

# --- 3. PRUNE old snapshots (keep the newest RETAIN_SNAPSHOTS) ---
SNAP_TOTAL=$(ls -1 "$SNAP_DIR"/projects-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
if [ "$SNAP_TOTAL" -gt "$RETAIN_SNAPSHOTS" ]; then
  ls -1t "$SNAP_DIR"/projects-*.tar.gz | tail -n +$((RETAIN_SNAPSHOTS + 1)) | while read -r old; do
    log "pruning old snapshot $(basename "$old")"
    rm -f "$old"
  done
fi

MIRROR_COUNT=$(find "$MIRROR" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
log "done. source=$SRC_COUNT mirror=$MIRROR_COUNT snapshots=$(ls -1 "$SNAP_DIR"/projects-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
[ "$MIRROR_RC" -ne 0 ] && exit 1
exit 0
