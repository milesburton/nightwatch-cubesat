#!/usr/bin/env bash
# Escalating Wi-Fi recovery for a headless Pi. Run once a minute (see wifi-watchdog.timer).
#
# Each run pings the default gateway. After N consecutive failed runs it escalates:
#   3  -> reconnect the interface
#   6  -> restart NetworkManager
#   12 -> reload the Wi-Fi driver
#   30 -> reboot (never while dpkg/apt is running, at most once an hour, at most 3 times
#         in a row without a successful check in between)
# A successful ping resets everything.
#
# Every external effect is a command variable (WD_CMD_*), so the logic can be tested
# without root or a network. State lives in WD_STATE_DIR as small text files.

set -euo pipefail

STATE_DIR="${WD_STATE_DIR:-/var/lib/wifi-watchdog}"
IFACE="${WD_IFACE:-wlan0}"
NOW="${WD_NOW:-$(date +%s)}"

T_RECONNECT="${WD_T_RECONNECT:-3}"
T_RESTART_NM="${WD_T_RESTART_NM:-6}"
T_RELOAD_DRIVER="${WD_T_RELOAD_DRIVER:-12}"
T_REBOOT="${WD_T_REBOOT:-30}"
REBOOT_MIN_INTERVAL="${WD_REBOOT_MIN_INTERVAL:-3600}"
REBOOT_MAX_STREAK="${WD_REBOOT_MAX_STREAK:-3}"

CMD_GATEWAY="${WD_CMD_GATEWAY:-ip -4 route show default | awk '/default/ {print \$3; exit}'}"
CMD_PING="${WD_CMD_PING:-ping -c2 -W2}"
CMD_RECONNECT="${WD_CMD_RECONNECT:-nmcli device disconnect $IFACE; nmcli device connect $IFACE}"
CMD_RESTART_NM="${WD_CMD_RESTART_NM:-systemctl restart NetworkManager}"
CMD_RELOAD_DRIVER="${WD_CMD_RELOAD_DRIVER:-rfkill unblock wifi; modprobe -r brcmfmac && modprobe brcmfmac}"
CMD_DPKG_BUSY="${WD_CMD_DPKG_BUSY:-fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock}"
CMD_REBOOT="${WD_CMD_REBOOT:-systemctl reboot}"

log() { logger -t wifi-watchdog "$*" 2>/dev/null || true; echo "wifi-watchdog: $*"; }

read_num() { local v; v="$(cat "$STATE_DIR/$1" 2>/dev/null || echo 0)"; [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }
write_num() { echo "$2" > "$STATE_DIR/$1"; }

mkdir -p "$STATE_DIR"

gateway="$(bash -c "$CMD_GATEWAY" 2>/dev/null || true)"

if [[ -n "$gateway" ]] && $CMD_PING "$gateway" >/dev/null 2>&1; then
  if [[ "$(read_num failures)" -gt 0 ]]; then
    log "network recovered after $(read_num failures) failed checks"
  fi
  write_num failures 0
  write_num reboot_streak 0
  exit 0
fi

failures=$(( $(read_num failures) + 1 ))
write_num failures "$failures"
log "gateway unreachable (check $failures)"

run_step() { # name command
  log "escalating: $1"
  bash -c "$2" || log "$1 failed"
}

[[ "$failures" -eq "$T_RECONNECT" ]] && run_step "reconnect $IFACE" "$CMD_RECONNECT"
[[ "$failures" -eq "$T_RESTART_NM" ]] && run_step "restart NetworkManager" "$CMD_RESTART_NM"
[[ "$failures" -eq "$T_RELOAD_DRIVER" ]] && run_step "reload Wi-Fi driver" "$CMD_RELOAD_DRIVER"

if [[ "$failures" -ge "$T_REBOOT" ]]; then
  streak="$(read_num reboot_streak)"
  last="$(read_num last_reboot)"
  if bash -c "$CMD_DPKG_BUSY" >/dev/null 2>&1; then
    log "reboot deferred: package manager is running"
  elif [[ "$streak" -ge "$REBOOT_MAX_STREAK" ]]; then
    log "reboot suppressed: $streak reboots without recovery"
  elif [[ "$last" -gt 0 && $(( NOW - last )) -lt "$REBOOT_MIN_INTERVAL" ]]; then
    log "reboot deferred: last reboot was $(( NOW - last ))s ago"
  else
    write_num last_reboot "$NOW"
    write_num reboot_streak $(( streak + 1 ))
    run_step "reboot" "$CMD_REBOOT"
  fi
fi
