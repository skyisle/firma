import { text, password, confirm, log } from '@clack/prompts';
import { apiFetch } from '../../api.ts';

const guard = <T>(val: T | symbol): T => {
  if (typeof val === 'symbol') process.exit(0);
  return val;
};

export const signupCommand = async () => {
  const email = guard(await text({ message: 'Email', placeholder: 'you@example.com' }));
  const pw = guard(await password({ message: 'Password (8자 이상)' }));
  const confirmed = guard(await confirm({ message: `${email} 으로 가입할까요?` }));
  if (!confirmed) process.exit(0);

  try {
    await apiFetch('/api/auth/register', { method: 'POST', body: { email, password: pw } });
    log.success('가입 완료! 이메일 인증 후 firma auth login 으로 로그인하세요.');
  } catch (err) {
    log.error(err instanceof Error ? err.message : '회원가입 실패');
    process.exit(1);
  }
};
