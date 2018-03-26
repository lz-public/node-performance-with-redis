# Improving Node's performance with Redis
## Workshop - NodeConf Argentina 2017

This code was presented in a Nodeconf's workshop to provide a simple example about how some large arrays in some contexts are better handled by an external storage engine such as Redis than by Node.js working in-memory. Yes, Node.js is not as fast as one could think when working with large arrays.

The parts I and II are focused on performance, and the part III on scalability.  

### The experiment
We want to see how Node.js behaves when handling large arrays that are permanently changing.

### The problem
Some customer ask us to build a ranking for a game they are running. Players earn points and the player who gets more points is at the top list of the ranking. We should build a service that gets information about how the players are making points and keep a ranking up to date.

### Part I - Simple Ranking Engine
Open a terminal, go to the "node-redis" folder and run "npm install". Then, run:
* node part-1-ranking-node.js
Take note about how it performs. Then press Ctrl + C and run:
* node part-1-ranking-redis.js
Compare the differences.

### Part II - The Realtime Ranking Service
Open a terminal and run:
* node part-2-ranking-node-api.js
Open a new terminal, go to the "bots" folder and run "npm install". Then, run:
* node index.js 8080
Go to the first terminal and take note about how it performs. Then press Ctr+C on both terminals and run:
* node part-2-ranking-redis-api.js (in terminal #1)
* node index.js 9090 (in terminal #2)
Compare the differences.

### Part III - The Distributed Realtime Ranking Service
TBD
