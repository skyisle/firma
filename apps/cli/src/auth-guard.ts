import { log } from '@clack/prompts';
import { readConfig } from './config.ts';

export const requireAuth = () => {
  const config = readConfig();
  if (!config?.access_token || !config?.user) {
    log.error('로그인이 필요합니다. `firma auth login`을 실행하세요.');
    process.exit(1);
  }
  return { token: config.access_token, user: config.user };
};
