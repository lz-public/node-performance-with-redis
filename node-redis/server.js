import { createServer } from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { connectRedis, memoryRanking, redisRanking } from './ranking.js';
import { discover } from './peers.js';

export async function startServer(mode, { port, key = 'workshop:' + mode, seed = 0 } = {}) {
  const client = mode === 'memory' ? null : await connectRedis();
  const ranking = client ? redisRanking(client, key) : memoryRanking();
  let peers;
  const delay = monitorEventLoopDelay({ resolution: 5 });
  let baseline = performance.eventLoopUtilization();
  let ready = false;
  let votes = 0;
  const server = createServer(async (req, res) => {
    const id = /^\/(\d+)\/?$/.exec(req.url.split('?')[0])?.[1];
    const json = (code, value) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    if (!ready) return json(503, { error: 'Server starting' });
    if (req.method !== 'GET' || id === undefined) return json(404, { error: 'Unknown route' });
    const rejection = peers?.reserve(id);
    if (rejection) return json(200, rejection);
    try {
      const top = await ranking.vote(id);
      if (peers) await peers.hit(id);
      votes++;
      json(200, top);
    } catch (error) {
      peers?.release(id);
      console.error(error.message);
      json(503, { error: 'Service unavailable' });
    }
  });
  async function close() {
    delay.disable();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    const activePeers = peers;
    peers = undefined;
    try { await activePeers?.close(); } finally { if (client?.isOpen) await client.close(); }
  }
  try {
    if (seed) await ranking.seed(seed);
    // Bind before announcing so discovery can advertise an ephemeral port.
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    port = server.address().port;
    if (mode === 'distributed') {
      peers = await discover(client, key, port);
      await peers.ready();
    }
    ready = true;
    delay.enable();
    return {
      port, close,
      get votes() { return votes; },
      stats() {
        const utilization = performance.eventLoopUtilization(baseline).utilization;
        baseline = performance.eventLoopUtilization();
        const lagP99 = delay.count ? delay.percentile(99) / 1e6 : null;
        delay.reset();
        return { utilization, lagP99 };
      }
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function serve(mode, defaultPort) {
  const port = Number(process.argv[2] ?? defaultPort);
  const key = process.env.RANKING_KEY;
  const server = await startServer(mode, { port, key, seed: Number(process.env.BENCH_USERS ?? 0) });
  console.log('Ranking available at http://127.0.0.1:' + server.port);
  let previousVotes = 0;
  const meter = process.stdout.isTTY && setInterval(() => {
    console.log('Votes in the last second:', server.votes - previousVotes);
    previousVotes = server.votes;
  }, 1000);
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(meter);
    await server.close();
    if (process.connected) process.disconnect();
  }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  if (process.send) {
    process.on('disconnect', close);
    process.on('message', message => {
      if (message === 'stats') process.send(server.stats());
    });
    process.send({ port: server.port });
  }
}
