import { readConfig } from './config.ts';

const DEFAULT_SERVER_URL = 'http://localhost:3000';

const getServerUrl = () => readConfig()?.server_url ?? DEFAULT_SERVER_URL;

type FetchOptions = {
  method?: string;
  body?: unknown;
  token?: string;
};

export const apiFetch = async <T>(path: string, options: FetchOptions = {}): Promise<T> => {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${getServerUrl()}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
};
