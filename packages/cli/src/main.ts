#!/usr/bin/env node
import { runCLI } from './index.js';
const result = runCLI(process.argv.slice(2));
process.stdout.write(result.stdout);
process.exitCode = result.exitCode;
