// Heartbeats repair missed announcements. A graceful departure is visible immediately.
export async function discover(client, namespace, port) {
  const subscriber = client.duplicate();
  subscriber.on('error', error => console.error('Subscriber:', error.message));
  const peers = new Map();
  const blocked = new Set();
  const channel = namespace + ':events';
  const send = (type, userId) => client.publish(channel, JSON.stringify({ type, port, userId }));
  await subscriber.connect();
  await subscriber.subscribe(channel, raw => {
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (!event || event.port === port || !Number.isInteger(event.port) ||
        event.port < 1 || event.port > 65535) return;
    if (event.type === 'leave') peers.delete(event.port);
    if (event.type === 'hit') blocked.delete(event.userId);
    if (event.type === 'hello' || event.type === 'alive') peers.set(event.port, Date.now());
    if (event.type === 'hello') send('alive').catch(console.error);
  });
  const timer = setInterval(() => {
    for (const [peer, seen] of peers) if (Date.now() - seen > 3500) peers.delete(peer);
    if (!peers.size) blocked.clear();
    send('alive').catch(console.error);
  }, 1000);
  return {
    ready: () => send('hello'),
    reserve(id) {
      if (peers.size && blocked.has(id)) return { status: 'rejected', availableHosts: [...peers.keys()] };
      blocked.add(id);
    },
    release: id => blocked.delete(id),
    hit: id => send('hit', id),
    async close() {
      clearInterval(timer);
      try { await send('leave'); } finally { if (subscriber.isOpen) await subscriber.close(); }
    }
  };
}
