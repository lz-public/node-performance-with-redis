# Improving Node's performance with Redis
## Workshop - NodeConf Argentina 2017

This code was presented in a Nodeconf's workshop to provide a simple example about how some large arrays in some contexts are better handled by an external storage engine such as Redis than by Node.js working in-memory. Yes, Node.js is not as fast as one could think when working with large arrays.

The parts I and II are focused on performance, and the part III, on scalability.  

### The problem
Some time ago a customer asked us to build a ranking for a game they are running. Players would earn points and the player who got more points was at the top list of the ranking. The mission was nothing more simpler than building a service that received a player id and responded with an updated ranking.

Our first solution based in Node.js and MongoDB had limitations. As the user list grew and more concurrent connections we had, we experienced a big delay in processing the ranking. To build the list for a single user would take up a couple of seconds. There were two problems: 1) by the time the ranking was ready to be sent to the players, new points already got in and the top position belonged to another player and, 2) If many users checked the ranking, the server and MongoDB would get stuck processing rankings.

### The experiment
The first idea that came to our minds was to process everything in memory. However, that solution was not performant either. What could be wrong? Some kind of in-memory operations in Node.js are really slow compared to similar operations executed in other languages (or database engines!), especially with large in-memory data sets. Here is an example. 

### Part I - Simple Ranking Engine
First, in the Node.js solution we are going to work with an array of objects. Every time a player (or user) gets one point, we look for it in the array and increment the counter. If we can't find the user, then we'll add it to the end of the array. Second, we sort the array by points earned. This might not be the most performant solution because the sort function is not aware (at least we don't know it) that there's only one element to sort and might do some unnecessary extra processing to place the item in its correct position. However, for this purpose let's make the assumption that V8 uses the best execution path.

Then, we've build another solution based on Redis delegates all the management of the user list and their points earned to the Redis engine.

Open a terminal, go to the "node-redis" folder and run "npm install". Then, run:
* `node part-1-ranking-node.js`
Take note about how it performs. Then press Ctrl + C and run:
* `node part-1-ranking-redis.js`
Compare the differences.

### Part II - The Realtime Ranking Service
Now we've build a server that can be accessed from a browser window. Each time we load the page, it will add a point to the user id we enter as paramenter. For a better understanding about how it works, we included a Bot that emulates a competition with many players.

Open a terminal and run:
* `node part-2-ranking-node-api.js`
Open a new terminal, go to the "bots" folder and run `npm install`. Then, run:
* `node index.js 8080`
Go to the first terminal and take note about how it performs. Then press Ctr+C on both terminals and run:
* `node part-2-ranking-redis-api.js` (in terminal #1)
* `node index.js 9090` (in terminal #2)
Compare the differences.

### Part III - The Distributed Realtime Ranking Service
The last part of our worksop is not focused on performance. It's intended to show you how you can use the publisher/subscriber functions to create a server cluster and enhance your solutions with distributed processing.

Try starting new server instances and, reading the source code, look how messaging is used by each instance to communicate with each other.  

Open a terminal, go to the "node-redis" folder and run:
* `node part-3-ranking-redis-api-pubsub.js`
Open a new terminal, go to the "bots" folder and run:
* `node index.js 9990`
Open a new terminal, return to the "node-redis" folder and run:
* `node index.js 9991` (do the same with 9992, 9993 and so on)

If you shut down the server at port 9990, the clients will start requesting to the other servers and the active pool of instances won't suggest the clients to connect to the terminated instance. Play turning instances on and off. The bots stop if they encounter more errors than specified in `maxErrors`. 

