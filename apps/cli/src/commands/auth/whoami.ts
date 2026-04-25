import { log, note } from '@clack/prompts';
import { readConfig } from '../../config.ts';

export const whoamiCommand = () => {
  const config = readConfig();
  if (!config?.user) {
    log.warn('Not logged in. Run `firma auth login`.');
    process.exit(1);
  }
  note(`ID:    ${config.user.id}\nEmail: ${config.user.email}`, 'Logged in as');
};
