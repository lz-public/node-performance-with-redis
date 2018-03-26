/*
 * Node.js performance experiment
 * Part 3: A compact Distributed Realtime Ranking scalable server written in Node.js + Redis using Pub/Sub 
 * Written for NodeConf Argentina 2017  by Luciano Zappa
 *
 * In this part, we don't care so much about performance but in scalability. This example shows
 * how to implement a basic scalable service. You can add many servers and these will sinchronize
 * and tell the clients (our bots) which instances are available or allowed to access.
 *
 * To make this funnier, if the current server instance is aware of other available instances, it doesn't
 * allow the client to make more than one request: The client must do a request to another 
 * instance before it can make a request to this server again. Bots already know to handle this and
 * manage to hit another available instance.
 */

var http = require('http');
var express = require('express');
var app = express();
var redis = require('redis');
var client = redis.createClient(),
    subscriber = redis.createClient(),
    publisher  = redis.createClient();

var config = require("./config.json"),
    userId,
    rpm = Array(60).fill(0),
    blockedLocalUserIds = [],
    knownServerInstances = [];
    
config.serverPort = 9990;                                   // default port
if (process.argv[2]) config.serverPort = process.argv[2];   // allow the port to be overridden from the command line

console.log("Distributed Realtime Ranking server in Node.js + Redis + Pub/Sub solution");
console.log("Try opening http://127.0.0.1:9990/1 (or any number) in your browser");
console.log("Go to the /bots folder and run 'node index 9990' to start some bots.");
console.log("Create other instances in new terminal windows using ports 9991, 9992, 9993, etc.");
console.log("Press Ctrl+C to kill this instance.");

// this is our redis-ranking engine
client.on('connect', function() {
    console.log('connected');
    // remove all keys from previous tests, if no other instances are active
    setTimeout(function() {
        if (knownServerInstances.length === 0) {
            client.del('redistest', function(){
                process.stdout.write('\nno other instances detected. ranking has been cleared.\n');
            });
        }
    }, 1000);
});

// we set up a "protocol" to "speak" with other server instances
// this is what we do with incomming messages
subscriber.on("message", function(channel, data) {
    switch (channel) {

        // userHit: when a client does a request, this instance tells the other active instances
        // that it was hit by the "userId". This "userId" is now blocked in the current instance,
        // but free to make requests to the rest of the pool
        case "userHit":
            var blockedUser = JSON.parse(data);
            if (blockedUser.port && blockedUser.port === config.serverPort) {
                // ignore this message, since it must have been sent from this instance
                return;
            }

            var blockedUserId = blockedLocalUserIds.indexOf(blockedUser.userId);
            if (blockedUserId !== -1) {
                // remove the user from the list
                blockedLocalUserIds.splice(blockedUserId, 1);
            }
            break;

        // addServerInstance: A new server instance is up. All members of the pool must
        // update their list of available instances 
        case "addServerInstance":
            if (data === config.serverPort) {
                // ignore this message, since it must have been sent from this instance
                return;
            }
            var serverInstancePort = knownServerInstances.indexOf(data);
            // add the instance only if we don't have it in our own list
            if (serverInstancePort === -1) {
                knownServerInstances.push(data);
                // notify the new instance and others that the current instance is also available
                process.stdout.write("Adding port " + data + " to the list of active server instances\r\n");
                publisher.publish("addServerInstance", config.serverPort);
            }
            break;

        // delServerInstance: A server instance is down. All members of the pool must
        // update their list of available instances 
        case "delServerInstance":
            var serverInstancePort = knownServerInstances.indexOf(data);
            if (knownServerInstances !== -1) {
                // remove the instance from the list of nown servers
                knownServerInstances.splice(serverInstancePort, 1);
                process.stdout.write("\r\nInstance on port " + data + " is no longer available\r\n");
            }
            break;
    }

});

// we start listening for messages from other instances
subscriber.subscribe("userHit");
subscriber.subscribe("addServerInstance");
subscriber.subscribe("delServerInstance");

// routes
app.get('/:id(\\d+)', function (req, res) {

    // if a userId makes a request, it is blocked only if there are no other server instances available
    if (knownServerInstances.length > 0 && blockedLocalUserIds.indexOf(req.params.id) > -1) {
        // the client is told that the request has been blocked, rejected and where can it send the request
        res.send({ "status": "rejected", "availableHosts": knownServerInstances });
        return;
    }

    // the client is allowed to do the request and it's awarded with 1 point
    // notify all other server instances that this user has been blocked on this server instance
    publisher.publish("userHit", JSON.stringify({ port: config.serverPort, userId: req.params.id }));
    blockedLocalUserIds.push(req.params.id);

    // this is our performance counter
    var s = new Date().getSeconds();
    rpm[s]++;

    // this is our ranking engine
    client.zincrby('redistest', 1, req.params.id, function() {
        client.zrevrange('redistest', 0, 10, 'withscores', function(err, ranking) {

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

// create a server...
var server = http.createServer(app);
server.listen(config.serverPort);

// tell everyone we're ready to accept requests
console.log('Ranking service (Redis) started on HTTP:' + config.serverPort);
publisher.publish("addServerInstance", config.serverPort);

// the admin pressed ctrl + c
process.on('SIGINT', function() {
    console.log("\nCaught interrupt signal. Shutdown and notify all other active instances.");

    // notify everyone in the pool that the server is going to shutdown
    // a better way of terminating this instance should be done here. We are not checking that 
    // the clients requests and/or redis transactions are finished
    publisher.publish("delServerInstance", config.serverPort, function() {
        console.log("Done. Bye, bye...");
        process.exit(0);
    });

});