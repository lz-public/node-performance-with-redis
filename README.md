# How many votes per second can a live leaderboard handle?

At NodeConf Argentina in 2017, Luciano Zappa presented a problem from a game: any vote could change the leader, and players wanted to see the top ten immediately. As the player count grew, calculating the standings on demand could take seconds. The workshop compares two ways to serve the same leaderboard: sort an array in Node.js after every vote, or let Redis maintain the order as scores change.

Reviewed in **November 2026** with Node.js 26.13.1 and Redis 7 in Docker. The benchmarks also cover Node.js 24.20.0.

## Run the workshop

From the repository root on Linux, with nvm, Docker and Docker Compose installed, run:

```sh
nvm install
nvm use
npm ci
docker compose up -d --wait redis
npm test
npm audit
```

Compose starts `redis:7-alpine` on `127.0.0.1:6379` and waits for Redis to answer `PING`. RDB snapshots and append-only persistence are disabled, and the eviction policy is `noeviction`. Node runs on the host. If Docker requires elevated permissions in your session, use `sudo` for the Compose commands. When you finish the workshop, `docker compose down -v` removes the container and its volumes.

### I. Update the leaderboard without HTTP

```sh
node node-redis/part-1-ranking-node.js
node node-redis/part-1-ranking-redis.js
```

Both programs cast the same sequence of 50,000 votes across 10,000 possible players, one vote at a time. Each vote adds a point and returns the current top ten. Compare the elapsed times and final standings in the terminal. The Redis example uses its own temporary key. To change the number of players or votes, edit [config.json](node-redis/config.json).

### II. Serve the leaderboard over HTTP

```sh
node node-redis/part-2-ranking-node-api.js
# In a second terminal
node bots/index.js 8080
```

To try Redis, start `node node-redis/part-2-ranking-redis-api.js` and run the bot against port `9090`. To cast a single vote for player 42, run `curl http://127.0.0.1:9090/42`. On an empty leaderboard, the first vote returns:

```json
[{"position":0,"userId":"42","points":1}]
```

Each `GET /:id` with a decimal player ID adds one point. Positions start at zero. Ties are broken by player ID in descending string order, so `"9"` comes before `"10"`. The Redis API keeps scores across Node restarts under the key `workshop:redis`. Set `RANKING_KEY` to use a different key.

### III. Share a leaderboard across two servers

Open three terminals in the repository root and run one command in each.

```sh
node node-redis/part-3-ranking-redis-api-pubsub.js 9990
node node-redis/part-3-ranking-redis-api-pubsub.js 9991
node bots/index.js 9990 1 SLOW
```

Using one player makes it easy to watch votes alternate. If the player votes twice in a row on the same server while a peer is available, the server replies with a message such as `{"status":"rejected","availableHosts":[9991]}`. The bot retries that vote on the suggested port. Once the bot has discovered both servers, stop one with Ctrl+C to see the other continue accepting votes.

Both servers store accepted votes in the sorted set `workshop:distributed`. They use Redis Pub/Sub to announce arrivals, departures and votes, with a dedicated connection for each subscriber. Heartbeats let peers detect an abrupt shutdown. A missed message can temporarily leave a server with stale information about which players should vote elsewhere. The benchmark below measures the HTTP service in part II.

## Why the player count matters

The array implementation calls `find` to locate the player, updates the score, then calls `sort` before copying the first ten entries. V8 can take advantage of the existing order, but scanning the array still takes time on the same thread that handles incoming requests. This experiment measures that particular algorithm. Comparing other JavaScript indexes or isolating the cost of memory allocation and garbage collection would require separate experiments. [The Node.js event loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)

Redis keeps a sorted set ordered between votes. For a large set, it uses a hash table to find a player and a skip list to update the player's position. With this representation, `ZINCRBY` takes O(log N), and reading the top ten with `ZRANGE ... REV WITHSCORES` takes O(log N + 10). Small sets can use a compact *listpack*, depending on the configured thresholds. The server sends the increment and read in a single `MULTI/EXEC` transaction so the response reflects that vote before another can intervene. Node can handle other requests while it waits for Redis. The round trip matters most when the leaderboard is small enough to scan quickly. [Redis sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/) · [ZINCRBY](https://redis.io/docs/latest/commands/zincrby/) · [ZRANGE](https://redis.io/docs/latest/commands/zrange/)

## Benchmark results

With Node 26 and 16 concurrent requests, the array had a small lead at 100 players. At 10,000 players, Redis handled about **4 times as many votes per second**. At 50,000 players, it handled **11.4 times as many**. Node 24 showed the same pattern. The 2017 workshop has no comparable measurements to establish how far the crossover has shifted since then.

**Concurrent requests** is the maximum number of HTTP requests the client can have outstanding at once. Each completed request adds one vote and returns the top ten. Throughput is the median of three runs on an AMD Ryzen 7 255 running Linux x86-64, with Redis 7.4.12 in Docker over loopback and the `redis` npm client at 6.4.0.

| Node.js | Players | Concurrent requests | Array (votes/s) | Redis (votes/s) |
|---|---:|---:|---:|---:|
| 26.13.1 | 100 | 1 | 3,842 | 2,294 |
| 26.13.1 | 100 | 16 | 7,070 | 6,786 |
| 26.13.1 | 100 | 64 | 7,298 | 6,776 |
| 26.13.1 | 10,000 | 1 | 1,527 | 2,180 |
| 26.13.1 | 10,000 | 16 | 2,564 | 10,343 |
| 26.13.1 | 10,000 | 64 | 2,820 | 7,100 |
| 26.13.1 | 50,000 | 1 | 597 | 2,378 |
| 26.13.1 | 50,000 | 16 | 654 | 7,470 |
| 26.13.1 | 50,000 | 64 | 785 | 8,222 |
| 24.20.0 | 100 | 1 | 629 | 543 |
| 24.20.0 | 100 | 16 | 7,653 | 5,943 |
| 24.20.0 | 10,000 | 1 | 505 | 568 |
| 24.20.0 | 10,000 | 16 | 2,689 | 6,705 |
| 24.20.0 | 50,000 | 1 | 326 | 564 |
| 24.20.0 | 50,000 | 16 | 734 | 6,989 |

All 90 runs completed, with 90,000 measured votes and zero HTTP errors. The raw results include one record per run. [Node 26 results](benchmarks/node26.jsonl) · [Node 24 results](benchmarks/node24.jsonl)

## Reproduce the benchmark

```sh
nvm use
CONCURRENCY=1,16,64 npm run --silent bench > node26.jsonl
nvm exec --silent 24 node node-redis/benchmark.js > node24.jsonl
```

The HTTP client and server run in separate processes on the same machine. Each run starts a fresh server with every player's score set to zero. After 250 warm-up votes, the client sends 1,000 measured votes using the seed 2017. Each worker waits for the complete response before sending its next vote. The benchmark reverses the order of the two implementations on the second of three runs. Concurrent requests may arrive in a different order, and the Redis client may automatically batch commands. At the end of each Redis run, the benchmark deletes its temporary key.

Set `SIZES` and `CONCURRENCY` to comma-separated lists of player counts and concurrency levels. Set `REQUESTS` for the number of measured votes per run and `REPEATS` for the number of repetitions. Each run writes one JSON record and fails if a request or server shutdown fails.

## Contributors to the November 2026 review

- **Claude** designed the Redis Compose configuration in the earlier session. For this revision, **Opus 5.5** with high reasoning effort proposed the ranking transaction, server instrumentation and benchmark design.
- **Gemini** proposed tests for ties at tenth place, concurrent votes, matching results across implementations and coordination between servers. The integration tests require a running Redis instance.
- **Codex GPT-6.2 Astra**, using low reasoning effort, designed the comparison and reviewed the interpretation of the results. **Codex**, acting as coordinator, adapted the code to the original API, implemented the bots with native `fetch`, preserved the three workshop entry points and ran the tests, npm audit and benchmarks. Claude and Gemini participated through the local agent bridge. Astra participated as a text-only subagent because the bridge requires distinct sender and receiver identities.
