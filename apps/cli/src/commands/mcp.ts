import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '@clack/prompts';
import pc from 'picocolors';

const getClaudeConfigPath = (): string | null => {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'Claude', 'claude_desktop_config.json');
  }
  // Linux: not officially supported by Claude Desktop yet
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
};

const getMcpBinPath = (): string | null => {
  // 1. Check PATH
  try {
    const p = execSync('which firma-mcp', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    if (p) return p;
  } catch { /* not in PATH */ }

  // 2. Same bin dir as the running `firma` binary (works for global npm installs)
  const firmaBin = process.argv[1];
  if (firmaBin) {
    const candidate = join(firmaBin, '..', 'firma-mcp');
    if (existsSync(candidate)) return candidate;
  }

  return null;
};

export const mcpInstallCommand = () => {
  const configPath = getClaudeConfigPath();
  if (!configPath) {
    log.error('Unsupported platform');
    process.exit(1);
  }

  const mcpBin = getMcpBinPath();
  if (!mcpBin) {
    log.error('firma-mcp binary not found. Make sure firma-app is installed globally (npm install -g firma-app)');
    process.exit(1);
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      log.error(`Failed to parse ${configPath}`);
      process.exit(1);
    }
  } else {
    mkdirSync(join(configPath, '..'), { recursive: true });
  }

  const mcpServers = (config.mcpServers as Record<string, unknown>) ?? {};

  mcpServers['firma'] = {
    command: 'node',
    args: [mcpBin],
  };

  config.mcpServers = mcpServers;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  log.success(`MCP registered at ${pc.dim(configPath)}`);
  log.info(`Binary: ${pc.dim(mcpBin)}`);
  log.message(pc.yellow('Restart Claude Desktop to activate the firma MCP server.'));
};
