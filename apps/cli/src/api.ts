import { readConfig, writeConfig } from './config.ts';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const SUPABASE_URL = 'https://kahzxbqbelpcndbmpste.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BLIyEcZMGfT1t9JQevnvVA_Je5Q1Mmy';

const getServerUrl = () => readConfig()?.server_url ?? DEFAULT_SERVER_URL;

type FetchOptions = {
  method?: string;
  body?: unknown;
  token?: string;
};

type RefreshResponse = {
  access_token: string;
  refresh_token: string;
};

const refreshAccessToken = async (): Promise<string | null> => {
  const config = readConfig();
  if (!config?.refresh_token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ refresh_token: config.refresh_token }),
  });

  if (!res.ok) return null;

  const data = await res.json() as RefreshResponse;
  writeConfig({ ...config, access_token: data.access_token, refresh_token: data.refresh_token });
  return data.access_token;
};

export const apiFetch = async <T>(path: string, options: FetchOptions = {}): Promise<T> => {
  const { method = 'GET', body } = options;
  let token = options.token ?? readConfig()?.access_token;

  const doFetch = async (t: string | undefined) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (t) headers['Authorization'] = `Bearer ${t}`;

    return fetch(`${getServerUrl()}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch(token);

  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      token = newToken;
      res = await doFetch(token);
    }
  }

  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
};
