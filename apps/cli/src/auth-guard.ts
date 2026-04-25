import { log } from '@clack/prompts';
import { readConfig } from './config.ts';

export const requireAuth = () => {
  const config = readConfig();
  if (!config?.access_token || !config?.user) {
    log.error('Not logged in. Run `firma auth login` to authenticate.');
    process.exit(1);
  }
  return { token: config.access_token, user: config.user };
};
