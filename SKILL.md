---
name: admin
description: User's system architecture: hardware, OS, software, configs, common tasks. Load when discussing system setup, package installation, environment config, troubleshooting.
---

# System Architecture

## Setup (one-time)
```bash
cd ~/.config/opencode/skills/admin && bun install
```

## Cache rule
`system.xml` is a cache. When this skill is loaded, **always**:
1. If `system.xml` doesn't exist → run `bun run update:system` in the skill directory
2. If `system.xml` is older than **7 days** → run `bun run update:system`
3. Then read `system.xml` for all machine-specific data

If the user asks to update/refresh system info, run `bun run update:system` first.

If direct shell is not available in this session, use `task` with `subagent_type=build` to run the script.

## File reference
Always read [`system.xml`](system.xml) — it contains all hardware, OS, software and config data.

## Live diagnostics (run on demand)

For real-time data not cached in system.xml, run these commands when needed:

### Linux

- **Listening ports:** `ss -tlnp`
- **Connections:** `ss -tulpn` (all), `ss -tupn` (active)
- **Processes:** `ps aux --forest`
- **CPU/RAM/load:** `top -bn1 | head -5`
- **CPU frequency / governor:** `lscpu`, `cat /proc/cpuinfo | grep MHz`, `cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq`
- **Temperatures:** `sensors`
- **Disk usage:** `df -h`
- **Kernel log:** `dmesg | tail -50`
- **Failed services:** `systemctl --failed`
- **PCI devices:** `lspci -nnk`
- **USB devices:** `lsusb`
- **Network throughput:** `iftop` or `nload`
- **Network namespaces:** `ip netns list`
- **WireGuard:** `wg show`
- **Firewall rules:** `nft list ruleset`
- **Thermal zones:** `cat /sys/class/thermal/thermal_zone*/temp`
- **Kernel cmdline:** `cat /proc/cmdline`
- **Loaded modules:** `lsmod`

### macOS

- **Listening ports:** `lsof -iTCP -sTCP:LISTEN -P -n`
- **Connections:** `lsof -i -P -n`
- **Processes:** `ps aux`
- **CPU/RAM/load:** `top -l 1 | head -5`
- **CPU frequency:** `sysctl hw.cpufrequency` (Intel), `sysctl hw.cpufamily` (Apple Silicon)
- **Disk usage:** `df -h`
- **System log:** `log show --last 1h` or `log show --predicate 'eventMessage contains "error"' --last 1h`
- **Launchd services:** `launchctl list`
- **PCI devices:** `system_profiler SPPCIDataType`
- **USB devices:** `system_profiler SPUSBDataType`
- **Network throughput:** `nettop`
- **WireGuard:** `wg show`
- **Firewall rules:** `sudo pfctl -s rules`
- **Loaded kexts:** `kextstat`
- **Hardware overview:** `system_profiler SPHardwareDataType`
