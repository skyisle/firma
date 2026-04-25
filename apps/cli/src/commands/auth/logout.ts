import { log } from '@clack/prompts';
import { clearConfig, readConfig } from '../../config.ts';

export const logoutCommand = () => {
  const config = readConfig();
  if (!config?.access_token) {
    log.warn('Not logged in.');
    return;
  }
  clearConfig();
  log.success('Logged out successfully.');
};
