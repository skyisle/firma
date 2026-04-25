export { getDb } from './client.ts';
export { createDataRepository } from './repositories.ts';
export * from '@firma/db';

import { getDb } from './client.ts';
import { createDataRepository } from './repositories.ts';

export const getRepository = () => createDataRepository(getDb());
