import { text, password, log } from '@clack/prompts';
import { apiFetch } from '../../api.ts';
import { writeConfig, readConfig } from '../../config.ts';

const guard = <T>(val: T | symbol): T => {
  if (typeof val === 'symbol') process.exit(0);
  return val;
};

type LoginResponse = {
  user: { id: string; email: string };
  access_token: string;
  refresh_token: string;
};

export const loginCommand = async () => {
  const email = guard(await text({ message: 'Email' }));
  const pw = guard(await password({ message: 'Password' }));

  try {
    const data = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password: pw },
    });

    const existing = readConfig();
    writeConfig({
      server_url: existing?.server_url ?? 'http://localhost:3000',
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user,
    });

    log.success(`환영합니다, ${data.user.email}!`);
  } catch (err) {
    log.error(err instanceof Error ? err.message : '로그인 실패');
    process.exit(1);
  }
};
