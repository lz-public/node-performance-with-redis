/*
 * Node.js performance experiment
 * Part 2: Realtime Ranking server written in Node.js + Redis database 
 * Written for NodeConf Argentina 2017  by Luciano Zappa
 */

var http = require('http');
var express = require('express');
var app = express();
var redis = require('redis');
var client = redis.createClient(); 

var config = require("./config.json"),
    userId,
    rpm = Array(60).fill(0);

console.log("Realtime Ranking server in Node.js + Redis solution");
console.log("Try opening http://127.0.0.1:9090/1 (or any number) in your browser");
console.log("Go to the /bots folder and run 'node index 9090' to start some bots.");
console.log("See how RPS keeps constant even if you make many requests and add more users. Try different combinations and compare results.");

// open the connection to redis - this is our ranking engine
// warning: just to simplify this example, there is no callback to make sure redis connected successfully
// if you call the route before the redis client is up, you may get errors!
client.on('connect', function() {
    console.log('connected');
    // remove all keys from previous tests, if any
    client.del('redistest', function(){
        console.log('ranking is emtpy');
    });
});

// routes
app.get('/:id(\\d+)', function (req, res) {
    var s = new Date().getSeconds();
    rpm[s]++;

    // search the user's record and increment the number of points
    client.zincrby('redistest', 1, req.params.id, function() {
        client.zrevrange('redistest', 0, 10, 'withscores', function(err, ranking) {

            // build a top-10 ranking just to restrict the amount of data in the response
            var currentRanking = [];
            for (var i = 0; i < 20; i += 2) {
                if (ranking[i]) {
                    currentRanking.push({ position: i/2, userId: ranking[i], points: ranking[i + 1] });
                }
            }

            res.send(currentRanking);
            return;
        });
    });
});

// this is our compact performance meter
rpmCounter = setInterval(function() {
    var s = new Date().getSeconds();
    rpm[(s + 1 > 59) ? 0 : s + 1] = 0;
    var lastRps = rpm[(s === 0) ? 59 : s - 1];
    var projectedRPM = lastRps * 60;
    process.stdout.write("Instant RPM: " + projectedRPM.toLocaleString('en-US') + " / Current RPS: " + lastRps.toLocaleString('en-US') + "         \r");
}, 1000);

// create and start a http server
var server = http.createServer(app);
server.listen(9090);
console.log('Ranking service (Redis) started on HTTP:9090');
