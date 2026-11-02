#!/usr/bin/env bash
# Run on the Pi as root: sudo ./install-wifi-watchdog.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 0755 "$here/wifi-watchdog.sh" /usr/local/sbin/wifi-watchdog.sh
install -m 0644 "$here/wifi-watchdog.service" /etc/systemd/system/wifi-watchdog.service
install -m 0644 "$here/wifi-watchdog.timer" /etc/systemd/system/wifi-watchdog.timer
systemctl daemon-reload
systemctl enable --now wifi-watchdog.timer
systemctl list-timers wifi-watchdog.timer --no-pager
