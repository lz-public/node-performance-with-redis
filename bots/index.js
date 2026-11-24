import { setTimeout as sleep } from 'node:timers/promises';

const gateway = Number(process.argv[2] ?? 8080);
const users = Number(process.argv[3] ?? 1_000_000);
const slow = process.argv[4] === 'SLOW';
if (!Number.isInteger(gateway) || gateway < 1 || gateway > 65535 ||
    !Number.isSafeInteger(users) || users < 1) throw new Error('Usage: node bots/index.js [port] [players] [SLOW]');
const hosts = new Set([gateway]);
const choose = list => list[Math.floor(Math.random() * list.length)];
let ok = 0;
let errors = 0;
let last = 0;
const meter = setInterval(() => {
  console.log('Votes/s:', ok - last, 'Total:', ok, 'Errors:', errors);
  last = ok;
}, 1000);

async function worker() {
  let port = gateway;
  let retry;
  while (errors < 400) {
    const id = retry ?? Math.floor(Math.random() * users);
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/' + id, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const result = await res.json();
      if (slow) console.log({ port, id, result });
      if (result.status === 'rejected') {
        const alternatives = result.availableHosts.filter(p => Number.isInteger(p) && p > 0 && p <= 65535);
        if (!alternatives.length) throw new Error('No ports available');
        alternatives.forEach(p => hosts.add(p));
        port = choose(alternatives);
        retry = id;
      } else {
        ok++;
        retry = undefined;
        port = choose([...hosts]);
      }
    } catch (error) {
      if (slow) console.error(error.message);
      errors++;
      retry = undefined;
      hosts.delete(port);
      if (!hosts.size) hosts.add(gateway);
      port = choose([...hosts]);
      await sleep(50);
    }
    if (slow) await sleep(1000);
  }
}
await Promise.all(Array.from({ length: slow ? 1 : 16 }, worker));
clearInterval(meter);
process.exitCode = 1;
