import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { basename } from 'path'
import { XMLBuilder } from 'fast-xml-parser'
import type {
  ArchData, AudioCard, DockerNetwork, LanguageInfo,
  DisplayServer, DesktopEnvironment, PlatformInfo, FirmwareInfo,
  AudioServerInfo, PciDevice, InputDevice,
  GpuInfo, NetworkIfaceDetail, DiskDetail, MonitorDetail,
  InitInfo, SecurityInfo, StorageInfo,
  KernelInfo, ThermalZone, LuksDetail,
} from './types.js'

export abstract class SystemCollector {
  private readonly systemXmlPath: string

  constructor(protected debug: boolean = false) {
    this.systemXmlPath = `${process.cwd()}/system.xml`
  }

  protected exec(cmd: string): string {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
      if (this.debug) console.error(`  [OK] ${cmd}`)
      return result
    } catch (e: any) {
      if (this.debug) {
        const stderr = (e.stderr as string | undefined)?.trim() ?? ''
        console.error(`  [FAIL] ${cmd}`)
        if (stderr) console.error(`    stderr: ${stderr}`)
        if (e.status !== undefined) console.error(`    exit code: ${e.status}`)
      }
      return ''
    }
  }

  protected execLines(cmd: string): string[] {
    return this.exec(cmd).split('\n').filter(Boolean)
  }

  protected readProc(path: string): string {
    try { return readFileSync(path, 'utf-8').trim() } catch { return '' }
  }

  protected homeDir(): string {
    return process.env.HOME ?? '/root'
  }

  // ---- existing abstract methods ----
  protected abstract getOSName(): string
  protected abstract getSystemPkgManagers(): string[]
  protected abstract collectCPU(): ArchData['hardware']['cpu']
  protected abstract collectRAM(): ArchData['hardware']['ram']
  protected abstract collectGPU(): GpuInfo[]
  protected abstract collectDisks(): DiskDetail[]
  protected abstract collectMonitors(): MonitorDetail[]
  protected abstract collectAudio(): AudioCard[]
  protected abstract collectNetworkInterfaces(): NetworkIfaceDetail[]

  // ---- NEW abstract methods ----
  protected abstract collectDisplayServer(): DisplayServer | undefined
  protected abstract collectDesktopEnvironment(): DesktopEnvironment | undefined
  protected abstract collectPlatformInfo(): PlatformInfo | undefined
  protected abstract collectFirmware(): FirmwareInfo | undefined
  protected abstract collectAudioServer(): AudioServerInfo | undefined
  protected abstract collectPciDevices(): PciDevice[]
  protected abstract collectInputDevices(): InputDevice[]
  protected abstract collectInit(): InitInfo | undefined
  protected abstract collectSecurity(): SecurityInfo | undefined
  protected abstract collectStorage(): StorageInfo | undefined
  protected abstract collectFlatpak(): string | undefined
  protected abstract collectGaming(): { steam?: boolean; wine?: string } | undefined
  protected abstract collectDnsServers(): string[]
  protected abstract collectGateway(): { iface: string; ip: string } | undefined
  protected abstract collectNetworkManager(): { name: string; version?: string } | undefined
  protected abstract collectKernelInfo(): KernelInfo
  protected abstract collectThermalZones(): ThermalZone[]
  protected abstract collectAuditd(): { enabled: boolean } | undefined
  protected abstract collectJournaldStorage(): 'persistent' | 'volatile' | 'auto' | undefined
  protected abstract collectTpm(): { available: boolean; version?: string } | undefined
  protected abstract collectLuksDetails(): LuksDetail[]

  // ---- shared helpers ----

  protected collectSystem() {
    const os = this.getOSName()
    const hostname = 'localhost'
    const shell = basename(this.exec('echo $SHELL')) || 'bash'
    const result: Record<string, any> = { os, hostname, shell }
    const ds = this.collectDisplayServer()
    if (ds) result.displayServer = ds
    const de = this.collectDesktopEnvironment()
    if (de) result.desktop = de
    const pi = this.collectPlatformInfo()
    if (pi) result.platform = pi
    const fw = this.collectFirmware()
    if (fw) result.firmware = fw
    return result
  }

  protected collectPackageManagers(): ArchData['packageManagers'] {
    const system = this.getSystemPkgManagers()
    const user: string[] = []

    for (const pm of ['nix-env', 'brew', 'port']) {
      if (this.exec(`which ${pm} 2>/dev/null`)) user.push(pm.replace('-env', ''))
    }

    return { system, user }
  }

  protected collectLanguages(): LanguageInfo[] {
    const langs: LanguageInfo[] = []
    const nv = this.exec('node --version 2>/dev/null')
    if (nv) langs.push({ name: 'Node.js', version: nv, via: 'nvm' })
    const npmv = this.exec('npm --version 2>/dev/null')
    if (npmv) langs.push({ name: 'npm', version: npmv })
    const gvRaw = this.exec('go version 2>/dev/null')
    const gv = gvRaw.match(/go\S+/)?.[0] || ''
    if (gv) langs.push({ name: 'Go', version: gv, path: this.exec('which go 2>/dev/null') })
    const rv = this.exec('rustc --version 2>/dev/null')
    if (rv) langs.push({ name: 'Rust', version: rv, via: 'cargo' })
    const pv = this.exec('python3 --version 2>/dev/null')
    if (pv) langs.push({ name: 'Python', version: pv })
    const jv = this.exec('java -version 2>&1 | head -1')
    const javaV = jv.match(/(\d+\.\d+\.\d+)/)?.[1] || ''
    if (javaV) langs.push({ name: 'Java', version: javaV, path: this.exec('which java 2>/dev/null') })
    return langs
  }

  protected collectContainers(): ArchData['software']['containers'] {
    const result: ArchData['software']['containers'] = []
    const dvRaw = this.exec('docker --version 2>/dev/null')
    const dv = dvRaw.match(/\d+\.\d+\.\d+/)?.[0] || ''
    if (dv) result.push({ name: 'Docker', version: dv })
    const pvRaw = this.exec('podman --version 2>/dev/null')
    const pv = pvRaw.match(/\d+\.\d+\.\d+/)?.[0] || ''
    if (pv) result.push({ name: 'Podman', version: pv })
    return result
  }

  protected collectDatabases(): string[] {
    const dbs: string[] = []
    for (const [name, cmd] of [['SQLite3', 'sqlite3'], ['PostgreSQL', 'psql'], ['Redis', 'redis-cli']] as const) {
      if (this.exec(`which ${cmd} 2>/dev/null`)) dbs.push(name)
    }
    return dbs
  }

  protected collectConfig(): ArchData['config'] {
    const hasProxy = !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
    const globalConfigs: ArchData['config']['globalConfigs'] = []
    if (existsSync(`${this.homeDir()}/.config/opencode`)) {
      globalConfigs.push({ path: '~/.config/opencode', purpose: 'Opencode settings' })
    }
    return {
      ssh: { path: '~/.ssh' },
      proxy: hasProxy,
      globalConfigs,
    }
  }

  protected collectSoftware(): ArchData['software'] {
    return {
      languages: this.collectLanguages(),
      containers: this.collectContainers(),
      databases: this.collectDatabases(),
    }
  }

  protected collectNetwork() {
    const result: Record<string, any> = {
      interfaces: this.collectNetworkInterfaces(),
      dockerNetworks: this.collectDockerNetworks(),
    }
    const dns = this.collectDnsServers()
    if (dns.length) result.dnsServers = dns
    const gw = this.collectGateway()
    if (gw) {
      result.gateway = gw.ip
      result.gatewayIface = gw.iface
    }
    const nm = this.collectNetworkManager()
    if (nm) result.networkManager = nm.name
    return result
  }

  private collectDockerNetworks(): DockerNetwork[] {
    const networks: DockerNetwork[] = []
    for (const line of this.execLines("docker network ls 2>/dev/null | tail -n+2")) {
      const parts = line.split(/\s+/)
      if (parts.length >= 3) networks.push({ name: parts[1] ?? '', driver: parts[2] ?? '' })
    }
    return networks
  }

  private toXML(data: ArchData): string {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: true,
      suppressEmptyNode: true,
      suppressBooleanAttributes: false,
    })

    const systemAttrs: Record<string, any> = {
      '@_os': data.system.os,
      '@_hostname': data.system.hostname,
      '@_shell': data.system.shell,
    }

    // System children (display-server, desktop, platform, firmware)
    const systemChildren: Record<string, any> = {}
    if (data.system.displayServer) {
      systemChildren['display-server'] = {
        '@_type': data.system.displayServer.type,
        ...(data.system.displayServer.version ? { '@_version': data.system.displayServer.version } : {}),
        ...(data.system.displayServer.vendor ? { '@_vendor': data.system.displayServer.vendor } : {}),
      }
    }
    if (data.system.desktop) {
      systemChildren.desktop = {
        '@_name': data.system.desktop.name,
        ...(data.system.desktop.version ? { '@_version': data.system.desktop.version } : {}),
        ...(data.system.desktop.plasmaVersion ? { '@_plasma-version': data.system.desktop.plasmaVersion } : {}),
        ...(data.system.desktop.frameworksVersion ? { '@_frameworks-version': data.system.desktop.frameworksVersion } : {}),
        ...(data.system.desktop.qtVersion ? { '@_qt-version': data.system.desktop.qtVersion } : {}),
        'window-manager': {
          '@_name': data.system.desktop.windowManager,
          ...(data.system.desktop.wmVersion ? { '@_version': data.system.desktop.wmVersion } : {}),
        },
      }
    }
    if (data.system.platform) {
      systemChildren.platform = {
        '@_vendor': data.system.platform.vendor,
        '@_product': data.system.platform.product,
        ...(data.system.platform.chipset ? { '@_chipset': data.system.platform.chipset } : {}),
      }
    }
    if (data.system.firmware) {
      systemChildren.firmware = {
        '@_type': data.system.firmware.type,
        ...(data.system.firmware.biosVersion ? { '@_bios-version': data.system.firmware.biosVersion } : {}),
      }
    }

    // Kernel
    systemChildren.kernel = {
      '@_release': data.system.kernel.release,
      '@_bpf': data.system.kernel.bpf ? 'true' : 'false',
    }

    // Init
    if (data.system.init) {
      systemChildren.init = {
        '@_type': data.system.init.type,
        ...(data.system.init.version ? { '@_version': data.system.init.version } : {}),
        ...(data.system.init.displayManager ? {
          'display-manager': {
            '@_name': data.system.init.displayManager.name,
            ...(data.system.init.displayManager.version ? { '@_version': data.system.init.displayManager.version } : {}),
          },
        } : {}),
        ...(data.system.init.bootloader ? {
          bootloader: {
            '@_type': data.system.init.bootloader.type,
            ...(data.system.init.bootloader.version ? { '@_version': data.system.init.bootloader.version } : {}),
          },
        } : {}),
      }
    }

    // Security
    if (data.system.security) {
      systemChildren.security = {
        'secure-boot': { '@_enabled': data.system.security.secureBoot ? 'true' : 'false' },
        ...(data.system.security.apparmor ? {
          apparmor: {
            '@_enabled': data.system.security.apparmor.enabled ? 'true' : 'false',
            ...(data.system.security.apparmor.mode ? { '@_mode': data.system.security.apparmor.mode } : {}),
            ...(data.system.security.apparmor.profiles ? { '@_profiles': data.system.security.apparmor.profiles } : {}),
          },
        } : {}),
        ...(data.system.security.selinux ? {
          selinux: {
            '@_enabled': data.system.security.selinux.enabled ? 'true' : 'false',
            ...(data.system.security.selinux.mode ? { '@_mode': data.system.security.selinux.mode } : {}),
          },
        } : {}),
        ...(data.system.security.firewall ? {
          firewall: {
            '@_name': data.system.security.firewall.name,
            '@_active': data.system.security.firewall.active ? 'true' : 'false',
          },
        } : {}),
        ...(data.system.security.auditd ? {
          auditd: { '@_enabled': data.system.security.auditd.enabled ? 'true' : 'false' },
        } : {}),
        ...(data.system.security.journald ? {
          journald: { '@_storage': data.system.security.journald.storage },
        } : {}),
        ...(data.system.security.tpm ? {
          tpm: {
            '@_available': data.system.security.tpm.available ? 'true' : 'false',
            ...(data.system.security.tpm.version ? { '@_version': data.system.security.tpm.version } : {}),
          },
        } : {}),
      }
    }

    const cpuBlock: Record<string, any> = {
      '@_model': data.hardware.cpu.model,
      '@_cores': data.hardware.cpu.cores,
    }
    if (data.hardware.cpu.arch) cpuBlock['@_arch'] = data.hardware.cpu.arch
    if (data.hardware.cpu.threadsPerCore) cpuBlock['@_threads-per-core'] = data.hardware.cpu.threadsPerCore
    if (data.hardware.cpu.sockets) cpuBlock['@_sockets'] = data.hardware.cpu.sockets
    if (data.hardware.cpu.scalingGovernor) cpuBlock['@_scaling-governor'] = data.hardware.cpu.scalingGovernor
    if (data.hardware.cpu.minFreq) cpuBlock['@_min-freq'] = data.hardware.cpu.minFreq
    if (data.hardware.cpu.maxFreq) cpuBlock['@_max-freq'] = data.hardware.cpu.maxFreq
    if (data.hardware.cpu.virtualization) cpuBlock['@_virtualization'] = data.hardware.cpu.virtualization
    if (data.hardware.cpu.availableGovernors?.length) {
      cpuBlock.governor = data.hardware.cpu.availableGovernors.map(g => ({ '@_name': g }))
    }

    const audioBlock: Record<string, any> = {}
    if (data.hardware.audio.server) {
      audioBlock.server = {
        '@_name': data.hardware.audio.server.name,
        '@_version': data.hardware.audio.server.version,
        ...(data.hardware.audio.server.defaultSink ? { '@_default-sink': data.hardware.audio.server.defaultSink } : {}),
        ...(data.hardware.audio.server.defaultSource ? { '@_default-source': data.hardware.audio.server.defaultSource } : {}),
      }
    }
    audioBlock.card = data.hardware.audio.cards.map(c => ({
      '@_index': c.index, '@_name': c.name, '@_driver': c.driver,
      device: c.devices.map(d => ({ '@_id': d.id, '#text': d.name })),
    }))

    return builder.build({
      'system-arch': {
        '@_collected': data.collected,
        system: {
          ...systemAttrs,
          ...systemChildren,
        },
        'package-managers': {
          system: data.packageManagers.system.map(p => ({ '@_type': p })),
          ...(data.packageManagers.user.length ? { user: data.packageManagers.user.map(p => ({ '@_type': p })) } : {}),
        },
        hardware: {
          cpu: cpuBlock,
          ram: { '@_size': data.hardware.ram.size, '@_unit': data.hardware.ram.unit },
          ...(data.hardware.storage ? {
            storage: (() => {
              const storageBlock: Record<string, any> = {}
              if (data.hardware.storage.swap) {
                storageBlock.swap = {
                  '@_size': data.hardware.storage.swap.size,
                  '@_unit': data.hardware.storage.swap.unit,
                  '@_type': data.hardware.storage.swap.type,
                }
              }
              if (data.hardware.storage.filesystems.length) {
                storageBlock.filesystems = {
                  fs: data.hardware.storage.filesystems.map(fs => ({
                    '@_device': fs.device,
                    '@_type': fs.type,
                    '@_mountpoint': fs.mountpoint,
                  })),
                }
              }
              if (data.hardware.storage.encrypted) {
                storageBlock.encrypted = {
                  '@_active': 'true',
                  device: (data.hardware.storage.encryptedDevices ?? []).map(d => ({ '@_name': d })),
                }
              }
              if (data.hardware.storage.luks?.length) {
                storageBlock.luks = {
                  device: data.hardware.storage.luks.map(l => {
                    const luksAttr: Record<string, any> = { '@_name': l.device }
                    if (l.cipher) luksAttr['@_cipher'] = l.cipher
                    if (l.hash) luksAttr['@_hash'] = l.hash
                    if (l.version) luksAttr['@_version'] = l.version
                    return luksAttr
                  }),
                }
              }
              return storageBlock
            })(),
          } : {}),
          gpus: {
            'graphics-card': data.hardware.gpus.map(g => {
              const a: Record<string, any> = {
                '@_model': g.model, '@_vram': g.vram, '@_unit': g.unit,
              }
              if (g.driver) a['@_driver'] = g.driver
              if (g.driverVersion) a['@_driver-version'] = g.driverVersion
              if (g.openGLVersion) a['@_opengl-version'] = g.openGLVersion
              if (g.vulkanVersion) a['@_vulkan-version'] = g.vulkanVersion
              return a
            }),
          },
          disks: {
            disk: data.hardware.disks.map(d => {
              const a: Record<string, any> = {
                '@_device': d.device, '@_model': d.model, '@_size': d.size,
                '@_type': d.type,
              }
              if (d.driver) a['@_driver'] = d.driver
              return a
            }),
          },
          monitors: {
            monitor: data.hardware.monitors.map(m => {
              const a: Record<string, any> = {
                '@_port': m.port, '@_resolution': m.resolution,
                ...(m.label ? { '@_label': m.label } : {}),
                ...(m.primary ? { '@_primary': 'true' } : {}),
              }
              if (m.physicalWidth) a['@_physical-width'] = m.physicalWidth
              if (m.physicalHeight) a['@_physical-height'] = m.physicalHeight
              if (m.connector) a['@_connector'] = m.connector
              if (m.manufacturer) a['@_manufacturer'] = m.manufacturer
              if (m.modelName) a['@_model-name'] = m.modelName
              if (m.refreshRate) a['@_refresh-rate'] = m.refreshRate
              return a
            }),
          },
          audio: audioBlock,
          network: {
            ...(data.hardware.network.dnsServers && data.hardware.network.dnsServers.length ? {
              dns: {
                server: data.hardware.network.dnsServers.map(s => ({ '@_address': s })),
              },
            } : {}),
            ...(data.hardware.network.gateway ? {
              gateway: {
                '@_interface': data.hardware.network.gatewayIface ?? '',
                '@_address': data.hardware.network.gateway,
              },
            } : {}),
            ...(data.hardware.network.networkManager ? {
              'network-manager': {
                '@_name': data.hardware.network.networkManager,
              },
            } : {}),
            iface: data.hardware.network.interfaces.map(n => {
              const a: Record<string, any> = {
                '@_name': n.name, '@_type': n.type, '@_ip': n.ip,
              }
              if (n.driver) a['@_driver'] = n.driver
              if (n.status) a['@_status'] = n.status
              if (n.mtu) a['@_mtu'] = n.mtu
              return a
            }),
            'docker-network': data.hardware.network.dockerNetworks.map(d => ({
              '@_name': d.name, '@_driver': d.driver,
            })),
          },
          ...(data.hardware.pciDevices && data.hardware.pciDevices.length ? {
            'pci-devices': {
              device: data.hardware.pciDevices.map(p => {
                const a: Record<string, any> = {
                  '@_pci-id': p.pciId,
                  '@_class': p.class,
                  '@_vendor': p.vendor,
                  '@_device': p.device,
                }
                if (p.subsystem) a['@_subsystem'] = p.subsystem
                if (p.driver) a['@_driver'] = p.driver
                if (p.driverModule) a['@_driver-module'] = p.driverModule
                return a
              }),
            },
          } : {}),
          ...(data.hardware.inputDevices && data.hardware.inputDevices.length ? {
            'input-devices': {
              device: data.hardware.inputDevices.map(i => ({
                '@_name': i.name,
                '@_type': i.type,
                ...(i.driver ? { '@_driver': i.driver } : {}),
              })),
            },
          } : {}),
          ...(data.hardware.thermal && data.hardware.thermal.zones.length ? {
            thermal: {
              zone: data.hardware.thermal.zones.map(z => ({
                '@_name': z.name,
                '@_type': z.type,
              })),
            },
          } : {}),
        },
        software: {
          ...(data.software.flatpak ? { flatpak: { '@_version': data.software.flatpak } } : {}),
          ...(data.software.gaming ? {
            gaming: {
              ...(data.software.gaming.steam !== undefined ? { steam: { '@_installed': data.software.gaming.steam ? 'true' : 'false' } } : {}),
              ...(data.software.gaming.wine ? { wine: { '@_version': data.software.gaming.wine } } : {}),
            },
          } : {}),
          languages: {
            lang: data.software.languages.map(l => ({
              '@_name': l.name, '@_version': l.version,
              ...(l.via ? { '@_via': l.via } : {}),
              ...(l.path ? { '@_path': l.path } : {}),
            })),
          },
          containers: {
            runtime: data.software.containers.map(c => ({
              '@_name': c.name, '@_version': c.version,
            })),
          },
          databases: { db: data.software.databases.map(d => ({ '@_name': d })) },
        },
        config: {
          ssh: { '@_path': data.config.ssh.path },
          proxy: { '@_active': data.config.proxy ? 'true' : 'false' },
          'global-config': data.config.globalConfigs.map(g => ({
            '@_path': g.path, '@_purpose': g.purpose,
          })),
        },
      },
    })
  }

  run(): void {
    if (this.debug) console.error('[DEBUG] Starting system collection...\n')

    const fresh: ArchData = {
      collected: new Date().toISOString(),
      system: (() => {
        const sysResult: Record<string, any> = {
          ...this.collectSystem(),
          kernel: this.collectKernelInfo(),
        }
        const initVal = this.collectInit()
        if (initVal) sysResult.init = initVal
        const secVal = this.collectSecurity()
        if (secVal) sysResult.security = secVal
        return sysResult as ArchData['system']
      })(),
      packageManagers: this.collectPackageManagers(),
      hardware: (() => {
        const hwResult: Record<string, any> = {
          cpu: this.collectCPU(),
          ram: this.collectRAM(),
          gpus: this.collectGPU(),
          disks: this.collectDisks(),
          monitors: this.collectMonitors(),
        }
        const storageVal = this.collectStorage()
        if (storageVal) hwResult.storage = storageVal
        hwResult.audio = (() => {
          const audioResult: ArchData['hardware']['audio'] = { cards: this.collectAudio() }
          const as = this.collectAudioServer()
          if (as) audioResult.server = as
          return audioResult
        })()
        hwResult.network = (() => {
          const netResult: ArchData['hardware']['network'] = {
            interfaces: this.collectNetworkInterfaces(),
            dockerNetworks: this.collectDockerNetworks(),
          }
          const dns = this.collectDnsServers()
          if (dns.length) netResult.dnsServers = dns
          const gw = this.collectGateway()
          if (gw) {
            netResult.gateway = gw.ip
            netResult.gatewayIface = gw.iface
          }
          const nm = this.collectNetworkManager()
          if (nm) netResult.networkManager = nm.name
          return netResult
        })()
        const pciDev = this.collectPciDevices()
        if (pciDev.length) hwResult.pciDevices = pciDev
        const inputDev = this.collectInputDevices()
        if (inputDev.length) hwResult.inputDevices = inputDev
        const thermalZones = this.collectThermalZones()
        if (thermalZones.length) hwResult.thermal = { zones: thermalZones }
        return hwResult as ArchData['hardware']
      })(),
      software: (() => {
        const swResult: ArchData['software'] = { ...this.collectSoftware() }
        const fp = this.collectFlatpak()
        if (fp) swResult.flatpak = fp
        const gm = this.collectGaming()
        if (gm) swResult.gaming = gm
        return swResult
      })(),
      config: this.collectConfig(),
    }

    writeFileSync(this.systemXmlPath, this.toXML(fresh), 'utf-8')
    console.log(`✓ system.xml written to ${this.systemXmlPath}`)
    console.log(`  collected: ${fresh.collected}`)
    console.log(`  os: ${fresh.system.os}`)
    console.log(`  cpu: ${fresh.hardware.cpu.model}`)
    console.log(`  ram: ${fresh.hardware.ram.size}${fresh.hardware.ram.unit}`)
    console.log(`  gpus: ${fresh.hardware.gpus.length}`)
    console.log(`  disks: ${fresh.hardware.disks.length}`)
    console.log(`  languages: ${fresh.software.languages.length}`)
    if (this.debug) console.error('\n[DEBUG] Collection complete.')
  }
}
