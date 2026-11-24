import { createClient } from 'redis';

export async function connectRedis() {
  const client = createClient({
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    socket: { reconnectStrategy: false, connectTimeout: 3000 },
    disableOfflineQueue: true
  });
  client.on('error', error => console.error('Redis:', error.message));
  await client.connect();
  return client;
}

function comparePlayers(a, b) {
  if (a.points !== b.points) return b.points - a.points;
  return a.userId < b.userId ? 1 : a.userId > b.userId ? -1 : 0;
}

export function memoryRanking() {
  const players = [];
  return {
    async seed(count) {
      for (let i = 0; i < count; i++) players.push({ userId: String(i), points: 0 });
      players.sort(comparePlayers);
    },
    vote(userId) {
      const player = players.find(player => player.userId === userId);
      if (player) player.points++;
      else players.push({ userId, points: 1 });
      players.sort(comparePlayers);
      return players.slice(0, 10).map((row, position) => ({ position, ...row }));
    }
  };
}

export function redisRanking(client, key) {
  return {
    async seed(count) {
      for (let start = 0; start < count; start += 1000) {
        const members = Array.from({ length: Math.min(1000, count - start) },
          (_, i) => ({ score: 0, value: String(start + i) }));
        await client.zAdd(key, members);
      }
    },
    async vote(userId) {
      const [, rows] = await client.multi().zIncrBy(key, 1, userId)
        .zRangeWithScores(key, 0, 9, { REV: true }).exec();
      return rows.map(({ value, score }, position) => ({ position, userId: value, points: score }));
    }
  };
}
