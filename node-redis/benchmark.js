import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createHistogram } from 'node:perf_hooks';
import { connectRedis } from './ranking.js';

function positive(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Expected a positive integer: ' + value);
  return n;
}
const sizes = (process.env.SIZES ?? '100,10000,50000').split(',').map(positive);
const levels = (process.env.CONCURRENCY ?? '1,16').split(',').map(positive);
const requests = positive(process.env.REQUESTS ?? 1000);
const repeats = positive(process.env.REPEATS ?? 3);

async function load(port, users, concurrency, count, seed) {
  const latency = createHistogram();
  let sent = 0;
  let errors = 0;
  async function worker() {
    while (sent < count) {
      sent++;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const id = Math.floor(seed / 2 ** 32 * users);
      const start = performance.now();
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/' + id, { signal: AbortSignal.timeout(15000) });
        const body = await res.json();
        if (!res.ok || !Array.isArray(body) || body.length !== Math.min(users, 10)) throw new Error('Invalid ranking response');
        latency.record(Math.max(1, Math.round((performance.now() - start) * 1000)));
      } catch (error) {
        if (!errors++) console.error(error.message);
      }
    }
  }
  const start = performance.now();
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, worker));
  const elapsed = performance.now() - start;
  const ms = percentile => latency.percentile(percentile) / 1000;
  if (errors) throw new Error(errors + ' failed requests');
  return { rps: Math.round(count * 1000 / elapsed), p50: ms(50), p95: ms(95), p99: ms(99), errors };
}

async function run(mode, users, concurrency, repeat) {
  const key = 'workshop:bench:' + randomUUID();
  const client = mode === 'redis' ? await connectRedis() : null;
  const script = mode === 'redis' ? 'part-2-ranking-redis-api.js' : 'part-2-ranking-node-api.js';
  const child = fork(new URL(script, import.meta.url), ['0'], {
    env: { ...process.env, RANKING_KEY: key, BENCH_USERS: String(users) },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  const exit = once(child, 'exit');
  const stopped = exit.then(([code]) => { throw new Error('Server exited unexpectedly: ' + code); });
  const message = () => Promise.race([once(child, 'message').then(([msg]) => msg), stopped]);
  async function stats() {
    const reply = message();
    child.send('stats');
    return reply;
  }
  try {
    const { port } = await message();
    await load(port, users, concurrency, Math.min(250, requests), 42);
    await stats();
    const result = await load(port, users, concurrency, requests, 2017);
    const server = await stats();
    console.log(JSON.stringify({ node: process.version, mode, users, concurrency, repeat, requests, ...result, ...server }));
  } finally {
    if (child.connected) child.disconnect();
    const [code, signal] = await exit;
    if (client?.isOpen) {
      try { await client.del(key); } finally { await client.close(); }
    }
    if (code !== 0) throw new Error('Server shutdown failed: ' + (signal ?? code));
  }
}

for (const users of sizes) {
  for (const concurrency of levels) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const order = repeat % 2 ? ['memory', 'redis'] : ['redis', 'memory'];
      for (const mode of order) await run(mode, users, concurrency, repeat);
    }
  }
}
