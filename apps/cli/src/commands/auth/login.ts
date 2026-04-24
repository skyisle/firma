import { createServer } from 'http';
import { exec } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { log, spinner } from '@clack/prompts';
import { writeConfig, readConfig } from '../../config.ts';

const SUPABASE_URL = 'https://kahzxbqbelpcndbmpste.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BLIyEcZMGfT1t9JQevnvVA_Je5Q1Mmy';
const CALLBACK_PORT = 54321;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;

const openBrowser = (url: string) => {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd);
};

const waitForCode = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get('code');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>인증 완료. 터미널로 돌아가세요.</p><script>window.close()</script></body></html>');

      server.close();
      if (code) resolve(code);
      else reject(new Error('callback에 code가 없습니다'));
    });

    server.listen(CALLBACK_PORT);
    setTimeout(() => { server.close(); reject(new Error('로그인 시간 초과 (2분)')); }, 120_000);
  });

export const loginCommand = async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce' },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    log.error('OAuth URL 생성 실패');
    process.exit(1);
  }

  log.info('브라우저에서 Google 로그인을 완료하세요.');
  openBrowser(data.url);

  const s = spinner();
  s.start('로그인 대기 중...');

  try {
    const code = await waitForCode();
    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
    if (sessionError || !sessionData.session) throw sessionError ?? new Error('세션 없음');

    const { session, user } = sessionData;
    writeConfig({
      server_url: readConfig()?.server_url ?? 'http://localhost:3000',
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: { id: user.id, email: user.email! },
    });

    s.stop(`환영합니다, ${user.email}!`);
    process.exit(0);
  } catch (err) {
    s.stop('로그인 실패');
    log.error(err instanceof Error ? err.message : '알 수 없는 오류');
    process.exit(1);
  }
};
