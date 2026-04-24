import 'dotenv/config';
import { assert } from '@firma/utils';

export type Env = {
  FINNHUB_API_KEY: string;
};

const loadEnv = (): Env => {
  const { FINNHUB_API_KEY } = process.env;
  assert(FINNHUB_API_KEY, 'FINNHUB_API_KEY is not set in .env');
  return { FINNHUB_API_KEY };
};

export const env = loadEnv();
