import { existsSync } from 'fs'
import { SystemCollector } from './base-collector.js'
import type {
  ArchData, AudioCard, AudioDevice,
  LsblkOutput, DisplayServer, DesktopEnvironment, PlatformInfo, FirmwareInfo,
  AudioServerInfo, PciDevice, InputDevice,
  GpuInfo, NetworkIfaceDetail, DiskDetail, MonitorDetail,
  InitInfo, SecurityInfo, StorageInfo, StorageFs,
  CpuInfo, KernelInfo, ThermalZone, LuksDetail,
} from './types.js'

export class LinuxSystemCollector extends SystemCollector {
  protected getOSName(): string {
    const osRelease = this.readProc('/etc/os-release')
    return this.exec('lsb_release -ds') || osRelease.match(/^PRETTY_NAME="(.+)"$/m)?.[1] || 'Linux'
  }

  protected getSystemPkgManagers(): string[] {
    const found: string[] = []
    for (const pm of ['apt-get', 'snap', 'pacman', 'dnf', 'yum', 'zypper', 'apk']) {
      if (this.exec(`which ${pm} 2>/dev/null`)) {
        found.push(pm === 'apt-get' ? 'apt' : pm)
      }
    }
    return found
  }

  // ---- Display / DE / Platform ----

  protected collectDisplayServer(): DisplayServer | undefined {
    const type = (process.env.XDG_SESSION_TYPE ||
      this.exec("loginctl show-session $(loginctl list-sessions --no-legend | awk '{print $1}' | head -1) -p Type 2>/dev/null | cut -d= -f2")) || 'x11'
    if (type === 'x11') {
      const xInfo = this.exec('xdpyinfo 2>/dev/null | head -3')
      const vendor = xInfo.match(/vendor string:\s+(.+)$/m)?.[1]
      const ver = xInfo.match(/X\.Org version:\s+([\d.]+)/)?.[1]
      return { type: 'x11', version: ver, vendor } as DisplayServer
    }
    if (type === 'wayland') return { type: 'wayland' }
    return { type: 'x11', version: '', vendor: '' }
  }

  protected collectDesktopEnvironment(): DesktopEnvironment | undefined {
    const de = process.env.XDG_CURRENT_DESKTOP ?? ''
    const session = process.env.DESKTOP_SESSION ?? ''
    let wm = ''
    let deVer = ''
    let wmVer = ''
    let plasmaVersion: string | undefined
    let frameworksVersion: string | undefined
    let qtVersion: string | undefined

    // Detect WM/compositor from process list
    const wmProcs = this.execLines("ps aux | grep -E '(kwin_x11|kwin_wayland|mutter|gnome-shell|i3\\b|sway|hyprland|picom|compton|xcompmgr|openbox|fluxbox|xfwm4|marco|budgie-wm|weston|river|niri|awesome|dwm|bspwm|qtile|cage|labs)' | grep -v grep")
    if (wmProcs.length > 0) {
      const first = wmProcs[0] ?? ''
      const parts = first.split(/\s+/)
      wm = parts.slice(10).join(' ').split(' ')[0] || 'unknown'
    }

    // KDE/Plasma
    if (/kde/i.test(de) || /plasma/i.test(session)) {
      deVer = this.exec("kstart5 --version 2>/dev/null | head -1 | grep -oP '[\\d.]+'")
      wmVer = deVer

      const kinfo = this.exec('kinfo 2>/dev/null')
      if (kinfo) {
        const pm = kinfo.match(/KDE Plasma Version:\s+([\d.]+)/)
        if (pm) plasmaVersion = pm[1]
        const fw = kinfo.match(/KDE Frameworks Version:\s+([\d.]+)/)
        if (fw) frameworksVersion = fw[1]
        const qt = kinfo.match(/Qt Version:\s+([\d.]+)/)
        if (qt) qtVersion = qt[1]
      }
    }
    // GNOME
    if (/gnome/i.test(de)) {
      const gv = this.exec('gnome-shell --version 2>/dev/null')
      deVer = gv.match(/[\d.]+/)?.[0] ?? ''
    }

    return {
      name: de || session,
      version: deVer,
      plasmaVersion,
      frameworksVersion,
      qtVersion,
      windowManager: wm || 'unknown',
      wmVersion: wmVer,
    } as DesktopEnvironment
  }

  protected collectPlatformInfo(): PlatformInfo | undefined {
    const vendor = this.readProc('/sys/devices/virtual/dmi/id/board_vendor') ||
      this.readProc('/sys/devices/virtual/dmi/id/sys_vendor')
    const product = this.readProc('/sys/devices/virtual/dmi/id/board_name') ||
      this.readProc('/sys/devices/virtual/dmi/id/product_name')
    if (!vendor && !product) return undefined

    const chipset = this.exec("lspci -nn 2>/dev/null | grep -i 'chipset' | head -1 | sed 's/.*\\[AMD\\] //;s/ \\[.*//'")
    return { vendor: vendor || 'unknown', product: product || 'unknown', chipset: chipset || undefined } as PlatformInfo
  }

  protected collectFirmware(): FirmwareInfo | undefined {
    const isUefi = existsSync('/sys/firmware/efi')
    const biosVersion = this.readProc('/sys/devices/virtual/dmi/id/bios_version')
    const biosDate = this.readProc('/sys/devices/virtual/dmi/id/bios_date')
    return { type: isUefi ? 'uefi' : 'legacy', biosVersion, biosDate } as FirmwareInfo
  }

  // ---- Audio server ----

  protected collectAudioServer(): AudioServerInfo | undefined {
    const info = this.exec('pactl info 2>/dev/null')
    if (!info) return undefined

    const serverLine = info.match(/Server Name:\s+(.+)$/m)?.[1] ?? ''
    const version = info.match(/Server Version:\s+([\d.]+)/m)?.[1]
    const defaultSink = info.match(/Default Sink:\s+(.+)$/m)?.[1]
    const defaultSource = info.match(/Default Source:\s+(.+)$/m)?.[1]

    if (/pipewire/i.test(serverLine)) {
      const pwVer = serverLine.match(/PipeWire\s+([\d.]+)/)?.[1] || version || ''
      return { name: 'pipewire', version: pwVer, defaultSink, defaultSource } as AudioServerInfo
    }
    if (/pulseaudio/i.test(serverLine)) {
      return { name: 'pulseaudio', version: version || '', defaultSink, defaultSource } as AudioServerInfo
    }
    return undefined
  }

  // ---- CPU ----

  protected collectCPU(): CpuInfo {
    const cpuinfo = this.readProc('/proc/cpuinfo')
    const model = cpuinfo.match(/^model name\s+:\s+(.+)$/m)?.[1]?.trim() || 'unknown'
    const cores = parseInt(cpuinfo.match(/^cpu cores\s+:\s+(\d+)$/m)?.[1] ?? '0')
    const arch = this.exec('uname -m')

    const result: CpuInfo = { model, cores, arch }

    // Threads & sockets
    const siblings = parseInt(cpuinfo.match(/^siblings\s+:\s+(\d+)$/m)?.[1] ?? '0')
    if (cores > 0) {
      const tpc = Math.round(siblings / cores)
      if (tpc > 0) result.threadsPerCore = tpc
    }
    const physicalIdMatches = cpuinfo.match(/^physical id\s+:\s+(\d+)$/gm)
    if (physicalIdMatches) {
      const ids = [...new Set(physicalIdMatches.map(m => m.match(/(\d+)/)?.[1] ?? '').filter(Boolean))]
      if (ids.length > 0) result.sockets = ids.length
    }

    // Scaling governor
    const gov = this.readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor')
    if (gov) result.scalingGovernor = gov
    const govs = this.readProc('/sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors')
    if (govs) {
      const list = govs.split(/\s+/).filter(Boolean)
      if (list.length) result.availableGovernors = list
    }

    // Frequencies (kHz → MHz)
    const minRaw = this.readProc('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq')
    if (minRaw) result.minFreq = Math.round(parseInt(minRaw) / 1000)
    const maxRaw = this.readProc('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq')
    if (maxRaw) result.maxFreq = Math.round(parseInt(maxRaw) / 1000)

    // Virtualization
    const flags = cpuinfo.match(/^flags\s+:\s+(.+)$/m)?.[1] ?? ''
    if (flags.includes('svm')) result.virtualization = 'svm'
    else if (flags.includes('vmx')) result.virtualization = 'vmx'

    return result
  }

  // ---- RAM ----

  protected collectRAM(): ArchData['hardware']['ram'] {
    const meminfo = this.readProc('/proc/meminfo')
    const kb = parseInt(meminfo.match(/^MemTotal:\s+(\d+) kB$/m)?.[1] ?? '0')
    return { size: Math.round(kb / (1024 * 1024) * 10) / 10, unit: 'GiB' }
  }

  // ---- GPU ----

  protected collectGPU(): GpuInfo[] {
    const gpus: GpuInfo[] = []

    // Try NVIDIA first
    const nvidia = this.exec("nvidia-smi --query-gpu=name,memory.total,driver_version,pci.device_id --format=csv,noheader 2>/dev/null")
    if (nvidia) {
      for (const line of nvidia.split('\n')) {
        if (!line.trim()) continue
        const parts = line.split(', ')
        const model = parts[0] || 'unknown'
        const vram = parseInt(parts[1] ?? '') || 0
        const driverVersion = (parts[2] ?? '').trim()
        // pciId больше не собираем (privacy)

        const moduleVer = this.exec("modinfo nvidia 2>/dev/null | grep '^version:' | awk '{print $2}'")

        const glx = this.exec('glxinfo -B 2>/dev/null')
        const openGL = glx.match(/OpenGL version string:\s+(.+)$/m)?.[1]
        const vk = this.exec("vulkaninfo --summary 2>/dev/null | grep 'Vulkan Instance Version:' | grep -oP '[\\d.]+'")

        gpus.push({
          model, vram, unit: 'MiB',
          driver: 'nvidia',
          driverVersion: driverVersion || moduleVer,
          openGLVersion: openGL,
          vulkanVersion: vk || undefined,
        } as GpuInfo)
      }
      return gpus
    }

    // Fallback to lspci
    const lspciLines = this.execLines("lspci -nn 2>/dev/null | grep -iE 'vga|3d|display'")
    for (const line of lspciLines) {
      const model = line.replace(/^[\da-f]{2}:[\da-f]{2}\.[\da-f]\s+/, '').replace(/\s*\[[\da-f]{4}:[\da-f]{4}\]/, '').trim()

      const slot = line.match(/^([\da-f]{2}:[\da-f]{2}\.[\da-f])/)?.[1]
      const driver = slot ? this.exec(`lspci -k 2>/dev/null | grep -A2 '${slot}' | grep 'Kernel driver' | grep -oP 'in use: \\K.+'`) : undefined

      gpus.push({
        model: model || 'unknown',
        vram: 0, unit: 'MiB',
        driver: driver || undefined,
      } as GpuInfo)
    }

    return gpus
  }

  // ---- Disks ----

  protected collectDisks(): DiskDetail[] {
    const json = this.exec('lsblk -d -e 7 -J -o NAME,SIZE,MODEL,ROTA 2>/dev/null')
    if (!json) return []
    try {
      const parsed: LsblkOutput = JSON.parse(json)
      return (parsed.blockdevices ?? [])
        .filter(d => !d.name.startsWith('loop'))
        .map(d => {
          const isNvme = d.name.includes('nvme')
          const type = isNvme ? 'nvme' as const : d.rota === '1' ? 'hdd' as const : 'ssd' as const
          const driver = isNvme ? 'nvme' : d.name.match(/^sd/) ? 'ahci' : undefined
          const diskEntry: DiskDetail = {
            device: d.name,
            model: d.model ?? '',
            size: d.size ?? '',
            type,
          }
          if (driver) diskEntry.driver = driver
          return diskEntry
        })
    } catch { return [] }
  }

  // ---- Monitors ----

  protected collectMonitors(): MonitorDetail[] {
    const verbose = this.exec("xrandr --verbose 2>/dev/null")
    if (!verbose) return []

    const monitors: MonitorDetail[] = []
    const lines = verbose.split('\n')
    let primarySet = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (!line.includes(' connected')) continue

      const parts = line.split(/\s+/)
      const port = parts[0] ?? ''

      // Parse resolution and physical size from first line
      const resMatch = line.match(/(\d+x\d+)/)
      const resolution = resMatch?.[0] || ''
      const physMatch = line.match(/(\d+)mm x (\d+)mm/)
      const physicalWidth = physMatch ? parseInt(physMatch[1] ?? '0') : undefined
      const physicalHeight = physMatch ? parseInt(physMatch[2] ?? '0') : undefined

      const isPrimary = !primarySet && (line.includes(' primary') || lines.length === 1)
      if (isPrimary) primarySet = true

      // Look for connector type in verbose block
      let connector: string | undefined
      let refreshRate: number | undefined

      // Check verbose lines below the connected line for ConnectorType
      for (let j = 1; j <= 5 && i + j < lines.length; j++) {
        const detailLine = lines[i + j]!
        const ctMatch = detailLine.match(/ConnectorType:\s+(.+)$/)
        if (ctMatch) connector = ctMatch[1]?.trim()
        // Refresh rate from the mode line below
        if (detailLine.includes('*current') && detailLine.includes('*preferred')) {
          const hz = detailLine.match(/([\d.]+)Hz/)
          if (hz) refreshRate = parseFloat(hz[1] ?? '0')
        }
      }

      // Try to get manufacturer from Xorg log
      const manufacturer = this.exec(`grep -i "${port}" /var/log/Xorg.0.log 2>/dev/null | grep -oP '(?<=DFP-\\d+): \\K[^(]+' | head -1`).trim() || undefined

      const monEntry: MonitorDetail = { port, resolution, primary: isPrimary }
      if (physicalWidth !== undefined) monEntry.physicalWidth = physicalWidth
      if (physicalHeight !== undefined) monEntry.physicalHeight = physicalHeight
      if (connector) monEntry.connector = connector
      if (manufacturer) monEntry.manufacturer = manufacturer
      if (refreshRate !== undefined) monEntry.refreshRate = refreshRate
      monitors.push(monEntry)
    }

    return monitors
  }

  // ---- Audio ----

  protected collectAudio(): AudioCard[] {
    const cards: AudioCard[] = []
    const procCards = this.readProc('/proc/asound/cards')
    for (const line of procCards.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+\[([^\]]+)\]/)
      if (!m) continue
      const index = parseInt(m[1] ?? '0')
      const name = (m[2] ?? '').trim()
      const driver = this.exec(`basename "$(readlink /sys/class/sound/card${index}/device/driver 2>/dev/null)" 2>/dev/null`)

      const devices: AudioDevice[] = []
      const pcmDir = `/proc/asound/card${index}/`
      if (existsSync(pcmDir)) {
        const entries = this.exec(`ls -d ${pcmDir}pcm*/info 2>/dev/null`)
        for (const f of entries.split('\n')) {
          if (!f.trim()) continue
          const idMatch = f.match(/pcm(\d+)\//)
          if (!idMatch) continue
          const info = this.readProc(f.trim())
          const dname = info.match(/^name:\s+(.+)$/m)?.[1]?.trim()
          if (dname) devices.push({ id: parseInt(idMatch[1] ?? ''), name: dname })
        }
      }
      cards.push({ index, name, driver, devices })
    }
    return cards
  }

  // ---- Network ----

  protected collectNetworkInterfaces(): NetworkIfaceDetail[] {
    const interfaces: NetworkIfaceDetail[] = []

    // Use ip -br addr for basic info
    for (const line of this.execLines("ip -br addr 2>/dev/null")) {
      const parts = line.split(/\s+/)
      const name = parts[0]
      if (!name || name === 'lo') continue
      const type = name.startsWith('wl') ? 'wifi' : (name.startsWith('en') || name.startsWith('eth')) ? 'wired' : 'other'
      const ipRaw = parts[2]
      const ip = (ipRaw ?? '').replace(/\/\d+$/, '')

      const linkInfo = this.exec(`ip -br link show ${name} 2>/dev/null`)
      const status = linkInfo.includes('UP') ? 'up' as const : 'down' as const

      // Get driver from ethtool or lspci
      const driver = this.exec(`ethtool -i ${name} 2>/dev/null | grep "^driver:" | awk '{print $2}'`) ||
        this.exec(`lspci -k 2>/dev/null | grep -B1 "${name}" | grep "Kernel driver" | grep -oP "in use: \\K.+"`)

      const iface: NetworkIfaceDetail = { name, type, ip, driver, status }

      const mtuRaw = this.readProc(`/sys/class/net/${name}/mtu`)
      if (mtuRaw) iface.mtu = parseInt(mtuRaw.trim())

      interfaces.push(iface)
    }
    return interfaces
  }

  // ---- PCI Devices ----

  protected collectPciDevices(): PciDevice[] {
    const devices: PciDevice[] = []
    const output = this.exec('lspci -nnk 2>/dev/null')
    if (!output) return []

    let current: Partial<PciDevice> = {}
    for (const line of output.split('\n')) {
      // New device line starts with slot like "00:00.0"
      const deviceMatch = line.match(/^([\da-f]{2}:[\da-f]{2}\.[\da-f])\s+(.+?)\s*\[[\da-f]{4}\]:\s+(.+?)\s*\[([\da-f]{4}):([\da-f]{4})\]/)
      if (deviceMatch) {
        if (current.pciId) devices.push(current as PciDevice)
        current = {
          pciId: deviceMatch[1]!,
          class: deviceMatch[2]?.trim() ?? '',
          vendor: deviceMatch[3]?.trim() ?? '',
          device: deviceMatch[4]! + ':' + deviceMatch[5]!,
        }
        continue
      }

      // Subsystem line
      const subMatch = line.match(/Subsystem:\s+(.+)/)
      if (subMatch && current.pciId && subMatch[1]) {
        current.subsystem = subMatch[1].trim()
        continue
      }

      // Kernel driver line
      const driverMatch = line.match(/Kernel driver in use:\s+(.+)/)
      if (driverMatch && current.pciId && driverMatch[1]) {
        current.driver = driverMatch[1].trim()
        continue
      }

      // Kernel modules line
      const modMatch = line.match(/Kernel modules:\s+(.+)/)
      if (modMatch && current.pciId && modMatch[1]) {
        current.driverModule = modMatch[1].trim()
        continue
      }
    }
    // Push last device
    if (current.pciId) devices.push(current as PciDevice)

    return devices
  }

  // ---- Input Devices ----

  protected collectInputDevices(): InputDevice[] {
    const devices: InputDevice[] = []
    const output = this.exec('xinput list 2>/dev/null')
    if (!output) return []

    for (const line of output.split('\n')) {
      const slaveMatch = line.match(/⎜\s+↳\s+(.+?)\s+id=(\d+)\s+\[slave\s+(.+?)\s+\((\d+)\)\]/)
      if (!slaveMatch) continue

      const name = slaveMatch[1]?.trim() ?? ''
      const slaveType = slaveMatch[3]?.trim().toLowerCase() ?? ''

      // Filter out Virtual core XTEST devices
      if (/xtest/i.test(name)) continue

      let type: InputDevice['type'] = 'other'
      const nameLower = name.toLowerCase()
      if (slaveType.includes('keyboard')) type = 'keyboard'
      else if (slaveType.includes('pointer')) {
        if (/touchpad|trackpad|synaptics|elantech|alps/i.test(nameLower)) type = 'touchpad'
        else if (/tablet|pen|stylus|wacom/i.test(nameLower)) type = 'tablet'
        else if (/joystick|gamepad|controller|wireless controller/i.test(nameLower)) type = 'joystick'
        else type = 'mouse'
      }

      devices.push({ name, type })
    }
    return devices
  }

  // ---- Init system ----

  protected collectInit(): InitInfo | undefined {
    const hasSystemd = this.exec('systemctl --version 2>/dev/null')
    if (hasSystemd) {
      const ver = hasSystemd.match(/systemd\s+(\d+)/)?.[1]
      let dmName: string | undefined
      let dmVer: string | undefined
      const dmService = this.exec("readlink /etc/systemd/system/display-manager.service 2>/dev/null | xargs basename 2>/dev/null")
      if (dmService) {
        dmName = dmService.replace('.service', '')
        if (dmName === 'sddm') dmVer = this.exec('sddm --version 2>/dev/null | grep -oP "\\d+[\\.\\d]+"')
        else if (dmName === 'gdm' || dmName === 'gdm3') dmVer = this.exec('gdm --version 2>/dev/null | grep -oP "\\d+[\\.\\d]+"')
        else if (dmName === 'lightdm') dmVer = this.exec('lightdm --version 2>/dev/null | grep -oP "\\d+[\\.\\d]+"')
      }
      let blType: string | undefined
      let blVer: string | undefined
      const grubVer = this.exec('grub-install --version 2>/dev/null')
      if (grubVer) { blType = 'grub'; blVer = grubVer.match(/[\d.]+/)?.[0] }
      else {
        const sdBoot = this.exec('bootctl status 2>/dev/null')
        if (sdBoot) { blType = 'systemd-boot'; blVer = sdBoot.match(/systemd-boot\s+(\d+)/)?.[1] }
      }
      const initResult: Record<string, any> = { type: 'systemd' as const }
      if (ver) initResult.version = ver
      if (dmName) {
        const dmObj: Record<string, any> = { name: dmName }
        if (dmVer) dmObj.version = dmVer
        initResult.displayManager = dmObj
      }
      if (blType) {
        const blObj: Record<string, any> = { type: blType }
        if (blVer) blObj.version = blVer
        initResult.bootloader = blObj
      }
      return initResult as InitInfo
    }
    if (existsSync('/run/openrc')) return { type: 'openrc' }
    if (existsSync('/run/runit')) return { type: 'runit' }
    return { type: 'other' }
  }

  // ---- Security ----

  protected collectSecurity(): SecurityInfo | undefined {
    const result: SecurityInfo = { secureBoot: false }
    const sb = this.exec('mokutil --sb-state 2>/dev/null')
    if (sb.includes('enabled')) result.secureBoot = true
    else if (sb.includes('disabled')) result.secureBoot = false
    else {
      const sbVar = this.readProc('/sys/firmware/efi/efivars/SecureBoot-*')
      if (sbVar) result.secureBoot = sbVar.includes('\x01')
    }
    const aaEnabled = this.exec('aa-status --enabled 2>/dev/null')
    if (aaEnabled) {
      const profilesRaw = this.exec('cat /sys/kernel/security/apparmor/profiles 2>/dev/null | wc -l')
      const profiles = parseInt(profilesRaw) || undefined
      let mode: string | undefined
      if (profiles) {
        const enforcing = this.exec('aa-status 2>/dev/null | grep -c "enforce mode"')
        const complain = this.exec('aa-status 2>/dev/null | grep -c "complain mode"')
        if (parseInt(enforcing) > 0) mode = 'enforce'
        else if (parseInt(complain) > 0) mode = 'complain'
      }
      const aa: Record<string, any> = { enabled: true }
      if (mode) aa.mode = mode
      if (profiles) aa.profiles = profiles
      result.apparmor = aa as NonNullable<SecurityInfo['apparmor']>
    }
    const seMode = this.exec('getenforce 2>/dev/null')
    if (seMode) {
      result.selinux = {
        enabled: seMode !== 'Disabled',
        mode: seMode.toLowerCase(),
      }
    }
    const ufw = this.exec('ufw status 2>/dev/null')
    if (ufw && ufw !== 'Status: inactive') {
      result.firewall = { name: 'ufw', active: ufw.includes('active') }
    } else {
      const fwd = this.exec('firewall-cmd --state 2>/dev/null')
      if (fwd) {
        result.firewall = { name: 'firewalld', active: fwd.includes('running') }
      } else {
        const nft = this.exec('nft list ruleset 2>/dev/null | head -5')
        if (nft) result.firewall = { name: 'nftables', active: true }
      }
    }
    const auditd = this.collectAuditd()
    if (auditd) result.auditd = auditd

    const journaldStorage = this.collectJournaldStorage()
    if (journaldStorage) result.journald = { storage: journaldStorage }

    const tpm = this.collectTpm()
    if (tpm) result.tpm = tpm

    return result
  }

  // ---- Storage ----

  protected collectStorage(): StorageInfo | undefined {
    const fsList: StorageFs[] = []
    const lsblkJson = this.exec('lsblk -o NAME,FSTYPE,MOUNTPOINT -J -e 7 2>/dev/null')
    if (lsblkJson) {
      try {
        const parsed = JSON.parse(lsblkJson)
        const flatten = (devices: any[]) => {
          for (const dev of devices) {
            if (dev.children) flatten(dev.children)
            if (dev.fstype && dev.mountpoint) {
              fsList.push({ device: `/dev/${dev.name}`, type: dev.fstype, mountpoint: dev.mountpoint })
            }
          }
        }
        flatten(parsed.blockdevices ?? [])
      } catch {}
    }
    let swapInfo: StorageInfo['swap']
    const swapRaw = this.exec('swapon --show --noheadings 2>/dev/null')
    if (swapRaw) {
      const parts = swapRaw.trim().split(/\s+/)
      if (parts.length >= 3) {
        const sizeStr = parts[2] ?? '0'
        const sizeMatch = sizeStr.match(/([\d.]+)([A-Za-z]+)/)
        if (sizeMatch) {
          const val = parseFloat(sizeMatch[1] ?? '0')
          const unit = sizeMatch[2] ?? 'B'
          let sizeGiB = val
          if (unit.startsWith('M')) sizeGiB = val / 1024
          else if (unit.startsWith('K')) sizeGiB = val / (1024 * 1024)
          else if (unit.startsWith('B')) sizeGiB = val / (1024 * 1024 * 1024)
          swapInfo = {
            size: Math.round(sizeGiB * 100) / 100,
            unit: 'GiB',
            type: parts[0]?.includes('/') ? 'partition' : 'file',
          }
        }
      }
    }
    const zramRaw = this.exec('swapon --show --noheadings 2>/dev/null | grep zram')
    if (zramRaw && !swapInfo) {
      swapInfo = { size: 0, unit: 'GiB', type: 'zram' }
    }
    let encrypted = false
    const encryptedDevices: string[] = []
    const cryptoRaw = this.exec("lsblk -o NAME,TYPE -J 2>/dev/null")
    if (cryptoRaw) {
      try {
        const parsed = JSON.parse(cryptoRaw)
        const findCrypto = (devices: any[]) => {
          for (const dev of devices) {
            if (dev.children) findCrypto(dev.children)
            if (dev.type === 'crypt') {
              encrypted = true
              encryptedDevices.push(dev.name)
            }
          }
        }
        findCrypto(parsed.blockdevices ?? [])
      } catch {}
    }
    const result: StorageInfo = { filesystems: fsList }
    if (swapInfo) result.swap = swapInfo
    if (encrypted) {
      result.encrypted = true
      if (encryptedDevices.length) result.encryptedDevices = encryptedDevices
    }
    const luks = this.collectLuksDetails()
    if (luks.length) result.luks = luks
    return result
  }

  // ---- Flatpak ----

  protected collectFlatpak(): string | undefined {
    const fv = this.exec('flatpak --version 2>/dev/null')
    if (fv) return fv.match(/[\d.]+/)?.[0]
    return undefined
  }

  // ---- Gaming (basic) ----

  protected collectGaming(): { steam?: boolean; wine?: string } | undefined {
    const result: { steam?: boolean; wine?: string } = {}
    const steamBin = this.exec('which steam 2>/dev/null')
    if (steamBin) result.steam = true
    const wineVer = this.exec('wine --version 2>/dev/null')
    if (wineVer) {
      result.wine = wineVer.match(/wine-?([\d.]+)/)?.[1] ?? wineVer.trim()
    }
    return Object.keys(result).length ? result : undefined
  }

  // ---- DNS ----

  protected collectDnsServers(): string[] {
    const resolved = this.exec('resolvectl dns 2>/dev/null')
    if (resolved) {
      const ips = resolved.match(/\d+\.\d+\.\d+\.\d+/g)
      if (ips) return ips
    }
    const resolv = this.readProc('/etc/resolv.conf')
    const nameservers: string[] = []
    for (const line of resolv.split('\n')) {
      const m = line.match(/^nameserver\s+(.+)/)
      if (m) nameservers.push(m[1]!.trim())
    }
    return nameservers
  }

  // ---- Gateway ----

  protected collectGateway(): { iface: string; ip: string } | undefined {
    const route = this.exec("ip route show default 2>/dev/null")
    if (route) {
      const parts = route.split(/\s+/)
      const viaIdx = parts.indexOf('via')
      const devIdx = parts.indexOf('dev')
      if (viaIdx >= 0 && devIdx >= 0) {
        return { iface: parts[devIdx + 1] ?? '', ip: parts[viaIdx + 1] ?? '' }
      }
    }
    return undefined
  }

  // ---- Network Manager ----

  protected collectNetworkManager(): { name: string; version?: string } | undefined {
    const nmVer = this.exec('NetworkManager --version 2>/dev/null')
    if (nmVer) return { name: 'NetworkManager', version: nmVer.trim() }
    const netplan = this.exec('netplan get 2>/dev/null | head -1')
    if (netplan) return { name: 'netplan' }
    const hasNetdev = this.exec('systemctl is-active systemd-networkd 2>/dev/null')
    if (hasNetdev === 'active') return { name: 'systemd-networkd' }
    return undefined
  }

  protected collectKernelInfo(): KernelInfo {
    const release = this.exec('uname -r')

    // Check BPF support
    let bpf = false
    const procConfig = this.readProc('/proc/config.gz')
    if (procConfig) {
      // config.gz might be compressed; try looking for decompressed config
      const configPlain = this.exec('zcat /proc/config.gz 2>/dev/null | grep -c "CONFIG_BPF=y"')
      if (configPlain && parseInt(configPlain) > 0) bpf = true
    }
    if (!bpf) {
      const configFile = `/boot/config-${release}`
      if (existsSync(configFile)) {
        const config = this.exec(`grep -c "CONFIG_BPF=y" ${configFile} 2>/dev/null`)
        if (config && parseInt(config) > 0) bpf = true
      }
    }

    return { release, bpf }
  }

  protected collectThermalZones(): ThermalZone[] {
    const zones: ThermalZone[] = []
    const entries = this.exec('ls -d /sys/class/thermal/thermal_zone* 2>/dev/null')
    if (!entries) return zones
    for (const dir of entries.split('\n')) {
      if (!dir.trim()) continue
      const zoneName = dir.trim().split('/').pop() || ''
      const zoneType = this.readProc(`${dir.trim()}/type`)
      if (zoneName && zoneType) {
        zones.push({ name: zoneName, type: zoneType.trim() })
      }
    }
    return zones
  }

  protected collectAuditd(): { enabled: boolean } | undefined {
    const active = this.exec('systemctl is-active auditd 2>/dev/null')
    if (active) return { enabled: active === 'active' }
    return undefined
  }

  protected collectJournaldStorage(): 'persistent' | 'volatile' | 'auto' | undefined {
    const header = this.exec('journalctl --header 2>/dev/null')
    if (header) {
      const m = header.match(/Journal mode:\s+(\w+)/)
      if (m) {
        const mode = m[1]!.toLowerCase()
        if (mode === 'persistent' || mode === 'volatile' || mode === 'auto') return mode
      }
    }
    // Fallback: check config file
    const conf = this.readProc('/etc/systemd/journald.conf')
    if (conf) {
      const m = conf.match(/^Storage\s*=\s*(\w+)/m)
      if (m) {
        const mode = m[1]!.toLowerCase()
        if (mode === 'persistent' || mode === 'volatile' || mode === 'auto') return mode
      }
    }
    return undefined
  }

  protected collectTpm(): { available: boolean; version?: string } | undefined {
    if (!existsSync('/dev/tpm0')) return undefined
    const verRaw = this.readProc('/sys/class/tpm/tpm0/tpm_version_major') || '1'
    return { available: true, version: `TPM ${verRaw.trim()}` }
  }

  protected collectLuksDetails(): LuksDetail[] {
    const result: LuksDetail[] = []
    const lsblk = this.exec("lsblk -o NAME,TYPE,PKNAME -J 2>/dev/null")
    if (!lsblk) return result
    try {
      const parsed = JSON.parse(lsblk)
      const findCrypt = (devices: any[]): void => {
        for (const dev of devices) {
          if (dev.children) findCrypt(dev.children)
          if (dev.type === 'crypt' && dev.pkname) {
            const parent = `/dev/${dev.pkname}`
            const dump = this.exec(`cryptsetup luksDump ${parent} 2>/dev/null`)
            if (dump) {
              const entry: LuksDetail = { device: parent }
              const cipher = dump.match(/Cipher:\s+(.+)/)?.[1]?.trim()
              if (cipher) entry.cipher = cipher
              const hash = dump.match(/Hash:\s+(.+)/)?.[1]?.trim()
              if (hash) entry.hash = hash
              const version = dump.match(/Version:\s+(.+)/)?.[1]?.trim()
              if (version) entry.version = version
              result.push(entry)
            }
          }
        }
      }
      findCrypt(parsed.blockdevices ?? [])
    } catch { /* ignore */ }
    return result
  }
}
