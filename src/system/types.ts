type MonitorInfo = {
  port: string
  resolution: string
  label?: string
  primary?: boolean
}

type AudioDevice = { id: number; name: string }

type AudioCard = {
  index: number
  name: string
  driver: string
  devices: AudioDevice[]
}

type NetworkIface = { name: string; type: string; ip: string }

type DockerNetwork = { name: string; driver: string }

type LanguageInfo = {
  name: string
  version: string
  via?: string
  path?: string
}

type CpuInfo = {
  model: string
  cores: number
  arch?: string
  threadsPerCore?: number
  sockets?: number
  scalingGovernor?: string
  availableGovernors?: string[]
  minFreq?: number
  maxFreq?: number
  virtualization?: 'vmx' | 'svm' | 'none'
}

type KernelInfo = {
  release: string
  bpf: boolean
}

type ThermalZone = {
  name: string
  type: string
}

type LuksDetail = {
  device: string
  cipher?: string
  hash?: string
  version?: string
}

// ---- NEW TYPES ----

type DisplayServer = {
  type: 'x11' | 'wayland' | 'quartz'
  version?: string
  vendor?: string
}

type DesktopEnvironment = {
  name: string
  version?: string
  plasmaVersion?: string
  frameworksVersion?: string
  qtVersion?: string
  windowManager: string
  wmVersion?: string
}

type PlatformInfo = {
  vendor: string
  product: string
  chipset?: string
}

type FirmwareInfo = {
  type: 'uefi' | 'legacy'
  biosVersion?: string
}

type AudioServerInfo = {
  name: 'pipewire' | 'pulseaudio' | 'alsa' | 'jack' | 'coreaudio'
  version: string
  defaultSink?: string
  defaultSource?: string
}

type PciDevice = {
  pciId: string
  class: string
  vendor: string
  device: string
  subsystem?: string
  driver?: string
  driverModule?: string
}

type InputDevice = {
  name: string
  type: 'keyboard' | 'mouse' | 'touchpad' | 'tablet' | 'joystick' | 'other'
  driver?: string
}

type InitInfo = {
  type: 'systemd' | 'openrc' | 'runit' | 'other'
  version?: string
  displayManager?: { name: string; version?: string }
  bootloader?: { type: string; version?: string }
}

type SecurityInfo = {
  secureBoot: boolean
  apparmor?: { enabled: boolean; mode?: string; profiles?: number }
  selinux?: { enabled: boolean; mode?: string }
  firewall?: { name: string; active: boolean }
  auditd?: { enabled: boolean }
  journald?: { storage: 'persistent' | 'volatile' | 'auto' }
  tpm?: { available: boolean; version?: string }
}

type StorageFs = {
  device: string
  type: string
  mountpoint: string
}

type StorageInfo = {
  swap?: { size: number; unit: string; type: 'partition' | 'file' | 'zram' | 'zswap' | 'none' }
  filesystems: StorageFs[]
  encrypted?: boolean
  encryptedDevices?: string[]
  luks?: LuksDetail[]
}

// ---- EXPANDED EXISTING TYPES ----

type GpuInfo = {
  model: string
  vram: number
  unit: string
  driver?: string
  driverVersion?: string
  openGLVersion?: string
  vulkanVersion?: string
}

type NetworkIfaceDetail = {
  name: string
  type: string
  ip: string
  driver?: string
  status?: 'up' | 'down'
  mtu?: number
}

type DiskDetail = {
  device: string
  model: string
  size: string
  type: 'nvme' | 'ssd' | 'hdd'
  driver?: string
}

type MonitorDetail = MonitorInfo & {
  physicalWidth?: number
  physicalHeight?: number
  connector?: string
  manufacturer?: string
  modelName?: string
  refreshRate?: number
}

// ---- MAIN DATA TYPE ----

type ArchData = {
  collected: string
  system: {
    os: string
    kernel: KernelInfo
    hostname: string
    shell: string
    displayServer?: DisplayServer
    desktop?: DesktopEnvironment
    platform?: PlatformInfo
    firmware?: FirmwareInfo
    init?: InitInfo
    security?: SecurityInfo
  }
  packageManagers: {
    system: string[]
    user: string[]
  }
  hardware: {
    cpu: CpuInfo
    ram: { size: number; unit: string }
    storage?: StorageInfo
    gpus: GpuInfo[]
    disks: DiskDetail[]
    monitors: MonitorDetail[]
    audio: {
      server?: AudioServerInfo
      cards: AudioCard[]
    }
    network: {
      interfaces: NetworkIfaceDetail[]
      dockerNetworks: DockerNetwork[]
      dnsServers?: string[]
      gateway?: string
      gatewayIface?: string
      networkManager?: string
    }
    pciDevices?: PciDevice[]
    inputDevices?: InputDevice[]
    thermal?: { zones: ThermalZone[] }
  }
  software: {
    flatpak?: string
    gaming?: { steam?: boolean; wine?: string }
    languages: LanguageInfo[]
    containers: { name: string; version: string }[]
    databases: string[]
  }
  config: {
    ssh: { path: string; keys?: string }
    proxy: boolean
    globalConfigs: { path: string; purpose: string }[]
  }
}

// ---- HELPER TYPES (unchanged) ----

type LsblkDevice = {
  name: string
  size?: string
  model?: string
  rota?: string
  fstype?: string
  mountpoint?: string
}

type LsblkOutput = { blockdevices?: LsblkDevice[] }

export type {
  MonitorInfo, AudioDevice, AudioCard,
  NetworkIface, DockerNetwork, LanguageInfo, ArchData,
  LsblkDevice, LsblkOutput,
  DisplayServer, DesktopEnvironment, PlatformInfo, FirmwareInfo,
  AudioServerInfo, PciDevice, InputDevice,
  GpuInfo, NetworkIfaceDetail, DiskDetail, MonitorDetail,
  InitInfo, SecurityInfo, StorageFs, StorageInfo,
  CpuInfo, KernelInfo, ThermalZone, LuksDetail,
}
