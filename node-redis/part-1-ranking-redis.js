/*
 * Node.js performance experiment
 * Part 1: Realtime Ranking solution written in Node.js and uses Redis database as helper without API 
 * Written for NodeConf Argentina 2017  by Luciano Zappa
 */

var redis = require('redis');
var client = redis.createClient(); 

var config = require("./config.json"),
    userId,
    pendingRequests = 0;
    
client.on('connect', function() {
    console.log('connected');

    // remove all keys from previous tests, if any
    client.del('redistest', function(){

        console.log("Realtime Ranking in Node.js + Redis solution - No API");
        console.log(config.maxUsers.toLocaleString('en-US') + " users doing " + config.maxRequests.toLocaleString('en-US') + " calls to add point and read the ranking");
        var start = new Date();

        // There are n users winning points in k plays (n = maxUsers, k = maxRequests) 
        for (var i = 0; i < config.maxRequests; i++) {

            // A player wins a point - we select one from our players list
            userId = Math.floor(Math.random() * config.maxUsers);

            // We count how many concurrent requests we have
            pendingRequests++;
            client.zincrby('redistest', 1, userId, function() {
                client.zrevrange('redistest', 0, 10, 'withscores', function(err, members) {
                    // If this was a server, in this line we'd write something like res.send(ranking);
                    pendingRequests--;
                });
            });
        }

        // Once all requests are finished, we check regularly until all requests are finished
        var checkResults = setInterval(function () {
            if (pendingRequests > 0) {
                console.log("waiting for all calls to finish...");
                return;
            }

            // ... we look how much time it took
            var end = new Date();
            console.log((end.getTime()-start.getTime()).toLocaleString('en-US') + " milliseconds!");

            // ... and write the results
            client.zrevrange('redistest', 0, 10, 'withscores', function(err, members) {
                for (var i = 0; i < 20; i += 2) {
                    console.log("User", members[i], "points", members[i + 1]);
                }

                clearInterval(checkResults);
                process.exit(0);
            });

        }, 100);
    });
});


