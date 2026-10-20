import { recreateTestDatabase } from './support/database';

export default async function setup(): Promise<void> {
  await recreateTestDatabase();
}
