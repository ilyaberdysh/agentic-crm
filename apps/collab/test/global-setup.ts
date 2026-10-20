import { recreateTestDatabase } from './support/stack.ts';

export default async function setup(): Promise<void> {
  await recreateTestDatabase();
}
