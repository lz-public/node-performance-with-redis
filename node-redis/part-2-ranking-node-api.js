/*
 * Node.js performance experiment
 * Part 2: Realtime Ranking server written 100% in Node.js 
 * Written for NodeConf Argentina 2017  by Luciano Zappa
 */

var http = require('http');
var express = require('express');
var app = express();

var config = require("./config.json"),
    userId,
    ranking = [],
    rpm = Array(60).fill(0);

console.log("Realtime Ranking server 100% Node.js solution");
console.log("Try opening http://127.0.0.1:8080/1 (or any number) in your browser");
console.log("Go to the /bots folder and run 'node index 8080' to start some bots.");
console.log("See how RPS drains with many requests and users. Try different combinations and compare results.");

// routes
app.get('/:id(\\d+)', function (req, res) {
    var s = new Date().getSeconds();
    rpm[s]++;

    // search the user's record
    for (var s = 0; s < ranking.length; s++) {
        if (ranking[s].userId == req.params.id) {
            ranking[s].points++;
            break;
        }
    }

    // add a user if not already in list
    if (s == ranking.length) {
        ranking.push({ userId: req.params.id, points: 1 });
    }

    // process the ranking
    ranking.sort((a,b) => { return b.points - a.points; });

    // build a top-10 ranking just to restrict the amount of data in the response
    var currentRanking = [];
    for (var i = 0; i < 10; i++) {
        if (ranking[i]) {
            currentRanking.push({ position: i, userId: ranking[i].userId, points: ranking[i].points });
        }
    }

    res.send(currentRanking);
    return;
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
server.listen(8080);
console.log('Realtime Ranking service (100% Node.js) started on HTTP:8080');
