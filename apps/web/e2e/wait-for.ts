// Waits until a URL answers 2xx (e2e web servers that depend on the API having prepared the database).
//   node e2e/wait-for.ts http://127.0.0.1:4110/api/health
const url = process.argv[2];
if (!url) throw new Error('usage: wait-for.ts <url>');
const deadline = Date.now() + 180_000;
for (;;) {
  try {
    const response = await fetch(url);
    if (response.ok) break;
  } catch {
    // not up yet
  }
  if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
  await new Promise((r) => setTimeout(r, 500));
}

export {};
