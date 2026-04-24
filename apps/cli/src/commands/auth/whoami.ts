import { log, note } from '@clack/prompts';
import { readConfig } from '../../config.ts';

export const whoamiCommand = () => {
  const config = readConfig();
  if (!config?.user) {
    log.warn('로그인되어 있지 않습니다. firma auth login 을 실행하세요.');
    process.exit(1);
  }
  note(`ID:    ${config.user.id}\nEmail: ${config.user.email}`, '현재 로그인 계정');
};
