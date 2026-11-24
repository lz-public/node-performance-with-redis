import { randomUUID } from 'node:crypto';
import config from './config.json' with { type: 'json' };
import { connectRedis, memoryRanking, redisRanking } from './ranking.js';

export async function run(redis) {
  const key = 'workshop:demo:' + randomUUID();
  const client = redis ? await connectRedis() : null;
  const ranking = client ? redisRanking(client, key) : memoryRanking();
  let top;
  let state = 2017;
  try {
    const start = performance.now();
    for (let i = 0; i < config.maxRequests; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      top = await ranking.vote(String(Math.floor(state / 2 ** 32 * config.maxUsers)));
    }
    console.log(config.maxRequests, 'votes in', Math.round(performance.now() - start), 'ms');
    console.table(top);
  } finally {
    if (client?.isOpen) {
      try { await client.del(key); } finally { await client.close(); }
    }
  }
}
