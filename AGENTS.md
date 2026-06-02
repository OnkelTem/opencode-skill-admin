# Agent Notes — Opencode Skill: admin

## Overview

This repository is an Opencode skill that we are developing.
Its primary function (for now) is collecting system information — hardware, OS, software,
and configuration — for consumption by the LLM agent. Other functions may be added later.

---

## System Information

System data is read from `system.xml`. When Opencode loads this skill,
it checks the cache (see `SKILL.md`): if `system.xml` is missing or older than 7 days,
a regeneration is triggered.

`system.xml` lives in the project root and is gitignored — each machine generates its own.

### Generator: `src/system/`

For simplicity, `system.xml` is filled by a script under `src/system/`.
The script auto-detects the platform (Linux/macOS), runs system commands,
collects data, and writes the XML.

#### Class structure

```
src/system/
├── types.ts                # All type definitions (ArchData, DiskInfo, etc.)
├── base-collector.ts       # Abstract SystemCollector
├── linux-collector.ts      # LinuxSystemCollector extends SystemCollector
├── mac-collector.ts        # MacSystemCollector extends SystemCollector
└── index.ts                # Entry point — picks subclass by process.platform
```

- **`SystemCollector`** — abstract base class. Contains:
  - Shared helpers (`exec`, `execLines`, `readProc`, `homeDir`)
  - Template collection methods (`collectSystem`, `collectSoftware`, `collectConfig`, etc.)
  - XML serialization (`toXML`)
  - `run()` method — entry point that assembles everything into `ArchData` and writes `system.xml`
  - Abstract methods that subclasses must implement (CPU, RAM, GPU, disks, etc.)

- **`LinuxSystemCollector`** — Linux implementation: reads `/proc`, calls `lspci`, `nvidia-smi`, `xrandr`, `ip`, `lsblk`, ALSA.

- **`MacSystemCollector`** — macOS implementation: calls `sysctl`, `system_profiler`, `ifconfig`, `sw_vers`.

- **`index.ts`** — selects the right class and runs `collector.run()`.

#### Key decisions

| Decision | Why |
|---|---|
| `system.xml` generated from scratch each run | No need to preserve manual edits |
| Abstract class per platform | Easy to add a new OS — just create a subclass |
| `process.cwd()` for system.xml path | Script always runs from project root |
| `.js` extensions in imports | Required by `module: nodenext` in tsconfig |

#### Adding a new OS

Create a subclass and register it in `src/system/index.ts`:

```typescript
class WindowsSystemCollector extends SystemCollector {
  // implement all abstract methods
}
```

```typescript
const collector: SystemCollector = process.platform === 'darwin'
  ? new MacSystemCollector()
  : process.platform === 'win32'
    ? new WindowsSystemCollector()
    : new LinuxSystemCollector()
```

#### Architecture

```
Opencode Agent
  └─ loads skill → SKILL.md
     └─ reads cache → system.xml
        └─ if cache missing or older than 7 days
           └─ bun run update:system
              └─ src/system/index.ts
                 └─ auto-detect platform
                    └─ run LinuxSystemCollector / MacSystemCollector
                       └─ generate system.xml
```
