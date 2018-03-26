/*
 * Node.js performance experiment
 * Part 1: Realtime Ranking solution written 100% in Node.js without API 
 * Written for NodeConf Argentina 2017  by Luciano Zappa
 */

var config = require("./config.json"),
    userId,
    ranking = [];

console.log("Realtime Ranking 100% Node.js solution - No API");
console.log(config.maxUsers.toLocaleString('en-US') + " users doing " + config.maxRequests.toLocaleString('en-US') + " calls to add point and read the ranking");
var start = new Date();

// There are n users winning points in k plays (n = maxUsers, k = maxRequests) 
for (var i = 0; i < config.maxRequests; i++) {

    // A player wins a point - we select one from our players list
    userId = Math.floor(Math.random() * config.maxUsers);

    // Add the point if the user exists
    for (var s = 0; s < ranking.length; s++) {
        if (ranking[s].userId == userId) {
            ranking[s].points++;
            break;
        }
    }

    // Create a new user recod with 1 point
    if (s == ranking.length) {
        ranking.push({ userId: userId, points: 1 });
    }

    // Process the ranking - it justs moves one element up or down, because the array is already sorted.
    ranking.sort((a,b) => { return b.points - a.points; });

    // If this was a server, in this line we'd write something like res.send(ranking);
}

// Once all requests are finished, we look how much time it took. 
var end = new Date();
console.log((end.getTime()-start.getTime()).toLocaleString('en-US') + " milliseconds!");

// ... and write the results
console.log("Ranking Results");
for (var i = 0; i < 10; i++) {
    console.log("User", ranking[i].userId, "points", ranking[i].points);
}
