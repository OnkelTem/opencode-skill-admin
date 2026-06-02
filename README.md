# Opencode Skill: admin

Implements a skill for administering your PC.

Auto-detects your machine's hardware, OS, software, and configuration and
exports it all as structured XML consumed by the skill.

Designed as an [Opencode](https://github.com/opencode) admin skill.

## Features

- CPU, RAM, GPU detection (Linux: `/proc`, `nvidia-smi`, `lspci` / macOS: `sysctl`, `system_profiler`)
- Disk listing with auto-classification (NVMe, SSD, HDD)
- Monitor configuration (Linux: `xrandr` / macOS: `system_profiler`)
- Audio cards and devices (Linux: ALSA / macOS: `system_profiler`)
- Network interfaces and Docker networks
- Installed languages (Node.js, Go, Rust, Python, Java), databases, CLI tools
- Git and SSH config detection
- Clean XML output — ready for use by LLM agents

## Requirements

- [Bun](https://bun.sh) >= 1.0

## Installation

Clone the repo into your Opencode skills directory:

```bash
git clone <repo-url> ~/.config/opencode/skills/admin
cd ~/.config/opencode/skills/admin && bun install
```

## Usage

```bash
bun run update:system
```

This regenerates `system.xml` from scratch with current machine data.

The script auto-detects your platform (Linux or macOS) and uses the
appropriate system commands.

## Collector script

Source code lives in `src/`:

```
src/
└── system/
    ├── types.ts            # type definitions
    ├── base-collector.ts   # abstract SystemCollector
    ├── linux-collector.ts  # Linux implementation
    ├── mac-collector.ts    # macOS implementation
    └── index.ts            # entry point
```

The skill entry point (`SKILL.md`) references the `update:system` script which
runs `src/index.ts`.

## Output (`system.xml`)

The XML contains every aspect of your system:

```xml
<system-arch collected="2026-06-02T19:09:00.112Z">
  <system os="Ubuntu 24.04.4 LTS" kernel="6.8.0-117-generic" .../>
  <hardware>
    <cpu .../>  <ram .../>  <gpu .../>
    <disks> ... </disks>
    <monitors> ... </monitors>
    <audio> ... </audio>
    <network> ... </network>
  </hardware>
  <software>
    <languages> ... </languages>
    <containers> ... </containers>
    <databases> ... </databases>
    <cli-tools> ... </cli-tools>
  </software>
  <config>
    <git .../>  <ssh .../>  <proxy .../>
  </config>
</system-arch>
```

`system.xml` is gitignored — each machine generates its own.

## Integration with Opencode

This repo doubles as an Opencode skill. Place it at:

```
~/.config/opencode/skills/admin/
```

The `SKILL.md` instructs the agent to auto-refresh `system.xml` when it's
missing or older than 7 days, giving the LLM an accurate picture of the
machine it's running on.

## Platform Support

| Feature            | Linux                               | macOS                             |
| ------------------ | ----------------------------------- | --------------------------------- |
| OS / Kernel        | ✅ `lsb_release`, `/etc/os-release` | ✅ `sw_vers`                      |
| CPU / RAM          | ✅ `/proc/cpuinfo`, `/proc/meminfo` | ✅ `sysctl`                       |
| GPU                | ✅ `nvidia-smi`, `lspci`            | ✅ `system_profiler`              |
| Disks              | ✅ `lsblk`                          | ✅ `system_profiler` / `diskutil` |
| Monitors           | ✅ `xrandr`                         | ✅ `system_profiler`              |
| Audio              | ✅ ALSA (`/proc/asound`)            | ⚠️ Basic                          |
| Network            | ✅ `ip`                             | ✅ `ifconfig`                     |
| Software detection | ✅                                  | ✅                                |
| Docker             | ✅                                  | ✅                                |

## Development

```bash
npx tsc --noEmit       # type-check
npx prettier --check . # format check (config in .prettierrc.json)
```

## License

MIT
