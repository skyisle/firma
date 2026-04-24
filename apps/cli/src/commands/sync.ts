import { log, spinner } from '@clack/prompts';
import { apiFetch } from '../api.ts';
import { requireAuth } from '../auth-guard.ts';

export const syncCommand = async () => {
  const { token } = requireAuth();
  const s = spinner();
  s.start('가격 동기화 중...');
  try {
    const { synced } = await apiFetch<{ synced: number }>('/api/sync', { method: 'POST', token });
    s.stop(synced > 0 ? `${synced}개 종목 업데이트 완료` : '보유 종목 없음');
  } catch (err) {
    s.stop('동기화 실패');
    log.error(err instanceof Error ? err.message : '알 수 없는 오류');
  }
};
