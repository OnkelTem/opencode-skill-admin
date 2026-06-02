#!/usr/bin/env bun

import { LinuxSystemCollector } from './linux-collector.js'
import { MacSystemCollector } from './mac-collector.js'
import type { SystemCollector } from './base-collector.js'

const debug = process.argv.includes('--debug')
if (debug) console.error('[DEBUG] mode enabled\n')

const collector: SystemCollector = process.platform === 'darwin'
  ? new MacSystemCollector(debug)
  : new LinuxSystemCollector(debug)
collector.run()
