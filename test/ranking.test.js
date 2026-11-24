import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectRedis, memoryRanking, redisRanking } from '../node-redis/ranking.js';
import { startServer } from '../node-redis/server.js';
import { setTimeout as sleep } from 'node:timers/promises';

async function fixture(t) {
  const client = await connectRedis();
  const key = 'workshop:test:' + randomUUID();
  t.after(async () => {
    try { await client.del(key); } finally { await client.close(); }
  });
  return { client, key };
}

async function contract(ranking) {
  let top;
  for (const id of '0123456789A') top = await ranking.vote(id);
  assert.equal(top.length, 10);
  assert.deepEqual(top[9], { position: 9, userId: '1', points: 1 });
  const snapshots = await Promise.all(Array.from({ length: 50 }, () => ranking.vote('0')));
  assert.deepEqual(snapshots.map(rows => rows[0].points).sort((a, b) => a - b),
    Array.from({ length: 50 }, (_, i) => i + 2));
}

test('array breaks ties at the top-ten cutoff and returns independent snapshots', () => contract(memoryRanking()));

test('Redis counts concurrent votes and matches the array after each vote', async t => {
  const { client, key } = await fixture(t);
  const redis = redisRanking(client, key);
  await contract(redis);
  await client.del(key);
  const memory = memoryRanking();
  for (const id of '015183375058') assert.deepEqual(await redis.vote(id), memory.vote(id));
});

test('HTTP accepts decimal IDs and adds one point per GET', async t => {
  const server = await startServer('memory', { port: 0 });
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.port;
  assert.equal((await fetch(url + '/abc')).status, 404);
  assert.equal((await fetch(url + '/0', { method: 'POST' })).status, 404);
  for (const points of [1, 2]) {
    assert.deepEqual(await (await fetch(url + '/0')).json(), [{ position: 0, userId: '0', points }]);
  }
});

test('two servers share scores, alternate votes and keep serving after one shuts down', async t => {
  const { key } = await fixture(t);
  const a = await startServer('distributed', { port: 0, key });
  t.after(() => a.close());
  const b = await startServer('distributed', { port: 0, key });
  t.after(() => b.close());
  const hit = async server => (await fetch('http://127.0.0.1:' + server.port + '/42')).json();
  const first = await hit(a);
  assert.equal(first[0].points, 1);
  assert.deepEqual(await hit(a), { status: 'rejected', availableHosts: [b.port] });
  assert.equal((await hit(b))[0].points, 2);
  async function untilAccepted() {
    for (let i = 0; i < 100; i++) {
      const result = await hit(a);
      if (Array.isArray(result)) return result[0].points;
      await sleep(15);
    }
    assert.fail('Timed out waiting for the server to accept the vote');
  }
  assert.equal(await untilAccepted(), 3);
  await b.close();
  assert.equal(await untilAccepted(), 4);
});
