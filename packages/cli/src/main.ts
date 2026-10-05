#!/usr/bin/env node
import { runCommand } from './client.js';
process.exitCode = await runCommand(process.argv.slice(2));
