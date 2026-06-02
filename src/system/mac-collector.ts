import { SystemCollector } from './base-collector.js'
import type {
  ArchData, AudioCard,
  DisplayServer, DesktopEnvironment, PlatformInfo, FirmwareInfo,
  AudioServerInfo, PciDevice, InputDevice,
  GpuInfo, NetworkIfaceDetail, DiskDetail, MonitorDetail,
  InitInfo, SecurityInfo, StorageInfo, StorageFs,
  CpuInfo, KernelInfo, ThermalZone, LuksDetail,
} from './types.js'

export class MacSystemCollector extends SystemCollector {
  protected getOSName(): string {
    const product = this.exec('sw_vers -productName')
    const version = this.exec('sw_vers -productVersion')
    if (product && version) return `macOS ${version} (${product})`
    return 'macOS'
  }

  protected getSystemPkgManagers(): string[] {
    return []
  }

  // ---- Display / DE / Platform ----

  protected collectDisplayServer(): DisplayServer | undefined {
    return { type: 'quartz', vendor: 'Apple' }
  }

  protected collectDesktopEnvironment(): DesktopEnvironment | undefined {
    return { name: 'macOS', windowManager: 'Quartz Compositor' }
  }

  protected collectPlatformInfo(): PlatformInfo | undefined {
    const product = this.exec('sysctl -n hw.model')
    return { vendor: 'Apple', product: product || 'Mac' } as PlatformInfo
  }

  protected collectFirmware(): FirmwareInfo | undefined {
    const json = this.exec('system_profiler SPHardwareDataType -json 2>/dev/null')
    if (json) {
      try {
        const parsed = JSON.parse(json)
        const hw = parsed.SPHardwareDataType?.[0]
        if (hw) {
          const fwResult: FirmwareInfo = { type: 'uefi' }
          const bv = hw.boot_rom_version?.toString()
          if (bv) fwResult.biosVersion = bv
          return fwResult
        }
      } catch {}
    }
    return { type: 'uefi' }
  }

  // ---- Audio server ----

  protected collectAudioServer(): AudioServerInfo | undefined {
    const json = this.exec('system_profiler SPAudioDataType -json 2>/dev/null')
    if (!json) return undefined
    try {
      const parsed = JSON.parse(json)
      const items = parsed.SPAudioDataType?.[0]?._items ?? []
      const defaultOutput = items.find((i: any) => i.coreaudio_default_audio_system_device)
      const audioResult: AudioServerInfo = {
        name: 'coreaudio',
        version: this.exec('sw_vers -productVersion'),
      }
      if (defaultOutput?._name) audioResult.defaultSink = defaultOutput._name
      return audioResult
    } catch {
      return { name: 'coreaudio', version: this.exec('sw_vers -productVersion') }
    }
  }

  // ---- CPU ----

  protected collectCPU(): CpuInfo {
    const model = this.exec('sysctl -n machdep.cpu.brand_string') || 'Apple Silicon'
    const cores = parseInt(this.exec('sysctl -n hw.ncpu') || '0')
    const arch = this.exec('uname -m')
    const result: CpuInfo = { model, cores, arch }
    const physicalCpus = parseInt(this.exec('sysctl -n hw.physicalcpu') || '0')
    if (physicalCpus > 0) {
      const tpc = Math.round(cores / physicalCpus)
      if (tpc > 0) result.threadsPerCore = tpc
    }
    const freqRaw = this.exec('sysctl -n hw.cpufrequency 2>/dev/null')
    if (freqRaw) result.maxFreq = Math.round(parseInt(freqRaw) / 1000000)
    return result
  }

  // ---- RAM ----

  protected collectRAM(): ArchData['hardware']['ram'] {
    const bytes = parseInt(this.exec('sysctl -n hw.memsize') || '0')
    const size = Math.round(bytes / (1024 * 1024 * 1024) * 10) / 10
    return { size, unit: 'GiB' }
  }

  // ---- GPU ----

  protected collectGPU(): GpuInfo[] {
    const json = this.exec('system_profiler SPDisplaysDataType -json 2>/dev/null')
    if (!json) return [{ model: 'unknown', vram: 0, unit: 'MiB' } as GpuInfo]
    try {
      const parsed = JSON.parse(json)
      const gpu = parsed.SPDisplaysDataType?.[0]
      if (!gpu) return [{ model: 'unknown', vram: 0, unit: 'MiB' } as GpuInfo]
      const model = gpu.sppci_model ?? 'unknown'
      const vram = parseInt(gpu['spdisplays_vram'] ?? '0') || 0
      const vendor = gpu.spdisplays_vendor ?? gpu.sppci_vendor ?? ''
      const gpuEntry: GpuInfo = { model, vram, unit: 'MiB' }
      if (vendor) gpuEntry.driver = vendor
      return [gpuEntry]
    } catch {
      return [{ model: 'unknown', vram: 0, unit: 'MiB' }]
    }
  }

  // ---- Disks ----

  protected collectDisks(): DiskDetail[] {
    const json = this.exec('system_profiler SPStorageDataType -json 2>/dev/null')
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      return (parsed.SPStorageDataType ?? []).map((s: any) => ({
        device: s.bsd_name ?? '',
        model: s._name ?? '',
        size: s.size ?? '',
        type: 'ssd' as const,
      }))
    } catch { return [] }
  }

  // ---- Monitors ----

  protected collectMonitors(): MonitorDetail[] {
    const json = this.exec('system_profiler SPDisplaysDataType -json 2>/dev/null')
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      return (parsed.SPDisplaysDataType ?? []).flatMap((display: any) => {
        const resolutions: MonitorDetail[] = []
        const ndisplays = display.spdisplays_ndisplays ?? []
        const arr = Array.isArray(ndisplays) ? ndisplays : [ndisplays]
        arr.forEach((d: any, i: number) => {
          const res = d['_spdisplay_resolution'] ?? ''
          resolutions.push({
            port: d['_name'] ?? `Display ${i}`,
            resolution: res,
            primary: i === 0,
            manufacturer: display.sppci_model,
            connector: display.spdisplays_display_type || undefined,
          })
        })
        return resolutions
      })
    } catch { return [] }
  }

  // ---- Audio ----

  protected collectAudio(): AudioCard[] {
    // macOS audio cards detected via system_profiler
    const json = this.exec('system_profiler SPAudioDataType -json 2>/dev/null')
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      const items = parsed.SPAudioDataType?.[0]?._items ?? []
      return items.map((item: any, idx: number) => ({
        index: idx,
        name: item._name ?? 'Unknown',
        driver: item.coreaudio_device_transport ?? '',
        devices: [],
      }))
    } catch { return [] }
  }

  // ---- Network ----

  protected collectNetworkInterfaces(): NetworkIfaceDetail[] {
    const interfaces: NetworkIfaceDetail[] = []
    for (const line of this.execLines("ifconfig 2>/dev/null | grep -E '^[a-z]'")) {
      const name = line.split(':')[0]
      if (!name || name === 'lo0') continue
      const ipLine = this.execLines(`ifconfig ${name} 2>/dev/null | grep 'inet '`)[0]
      if (!ipLine) continue
      const ip = ipLine.trim().split(/\s+/)[1] ?? ''

      const status = this.exec(`ifconfig ${name} 2>/dev/null`).includes('status: active') ? 'up' as const : 'down' as const
      const type = name.startsWith('en') ? 'wired' as const : 'other' as const

      // Try to get driver from networksetup or kextstat
      const driver = this.exec(`kextstat 2>/dev/null | grep -i "${name}" | head -1 | awk '{print $6}'`) ||
        this.exec(`networksetup -listallhardwareports 2>/dev/null | grep -A1 "${name}" | head -1`) || undefined

      const iface: NetworkIfaceDetail = { name, type, ip, status }
      if (driver) iface.driver = driver
      interfaces.push(iface)
    }
    return interfaces
  }

  // ---- PCI Devices (macOS) ----

  protected collectPciDevices(): PciDevice[] {
    const json = this.exec('system_profiler SPPCIDataType -json 2>/dev/null')
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      const items = parsed.SPPCIDataType?.[0]?._items ?? []
      return items.map((item: any, idx: number) => ({
        pciId: item.spcirevision ?? `pci-${idx}`,
        class: item._name ?? 'Unknown',
        vendor: item.spcivendor ?? '',
        device: item.spcidevice ?? '',
        driver: item.spcidriver ?? undefined,
      }))
    } catch { return [] }
  }

  // ---- Input Devices ----

  protected collectInputDevices(): InputDevice[] {
    return [] // No portable equivalent of xinput on macOS
  }

  protected collectInit(): InitInfo | undefined {
    return { type: 'other' }
  }

  protected collectSecurity(): SecurityInfo | undefined {
    const result: SecurityInfo = { secureBoot: false }
    const sip = this.exec('csrutil status 2>/dev/null')
    if (sip) result.secureBoot = sip.includes('enabled')
    const pf = this.exec('pfctl -s info 2>/dev/null | grep "Status:"')
    if (pf) result.firewall = { name: 'pf', active: pf.includes('Enabled') }
    return result
  }

  protected collectStorage(): StorageInfo | undefined {
    const fsList: StorageFs[] = []
    const json = this.exec('system_profiler SPStorageDataType -json 2>/dev/null')
    if (json) {
      try {
        const parsed = JSON.parse(json)
        for (const item of (parsed.SPStorageDataType ?? [])) {
          if (item.mountpoint) {
            fsList.push({
              device: item.bsd_name ?? '',
              type: item.file_system ?? '',
              mountpoint: item.mountpoint,
            })
          }
        }
      } catch {}
    }
    const swapRaw = this.exec('sysctl vm.swapusage 2>/dev/null')
    let swap: StorageInfo['swap']
    if (swapRaw) {
      const m = swapRaw.match(/total\s*=\s*([\d.]+)([A-Z]+)/)
      if (m) {
        swap = { size: parseFloat(m[1] ?? '0'), unit: m[2] ?? 'M', type: 'file' }
      }
    }
    const storageResult: StorageInfo = { filesystems: fsList }
    if (swap) storageResult.swap = swap
    return storageResult
  }

  protected collectFlatpak(): string | undefined {
    const fv = this.exec('flatpak --version 2>/dev/null')
    if (fv) return fv.match(/[\d.]+/)?.[0]
    return undefined
  }

  protected collectGaming(): { steam?: boolean; wine?: string } | undefined {
    const result: { steam?: boolean; wine?: string } = {}
    const steamBin = this.exec('which steam 2>/dev/null')
    if (steamBin) result.steam = true
    const wineVer = this.exec('wine --version 2>/dev/null')
    if (wineVer) result.wine = wineVer.match(/wine-?([\d.]+)/)?.[1] ?? wineVer.trim()
    return Object.keys(result).length ? result : undefined
  }

  protected collectDnsServers(): string[] {
    const scutil = this.exec('scutil --dns 2>/dev/null')
    const servers: string[] = []
    for (const line of scutil.split('\n')) {
      const m = line.match(/nameserver\[.+\]\s*:\s*(.+)/)
      if (m) servers.push(m[1]!.trim())
    }
    return [...new Set(servers)]
  }

  protected collectGateway(): { iface: string; ip: string } | undefined {
    const route = this.exec("route -n get default 2>/dev/null")
    let iface = '', ip = ''
    for (const line of route.split('\n')) {
      const im = line.match(/interface:\s+(.+)/)
      if (im) iface = im[1]!.trim()
      const gm = line.match(/gateway:\s+(.+)/)
      if (gm) ip = gm[1]!.trim()
    }
    if (iface && ip) return { iface, ip }
    return undefined
  }

  protected collectNetworkManager(): { name: string; version?: string } | undefined {
    return undefined
  }

  protected collectKernelInfo(): KernelInfo {
    const release = this.exec('uname -r')
    return { release, bpf: false }
  }

  protected collectThermalZones(): ThermalZone[] {
    return []
  }

  protected collectAuditd(): { enabled: boolean } | undefined {
    return undefined
  }

  protected collectJournaldStorage(): 'persistent' | 'volatile' | 'auto' | undefined {
    return undefined
  }

  protected collectTpm(): { available: boolean; version?: string } | undefined {
    return undefined
  }

  protected collectLuksDetails(): LuksDetail[] {
    return []
  }
}
