// server.js - NodeJS server for the PiThermServer project.

/* 

Parses data from DS18B20 temperature sensor and serves as a JSON object.
Uses node-static module to serve a plot of current temperature (uses highcharts).

Tom Holderness 03/01/2013
Ref: www.cl.cam.ac.uk/freshers/raspberrypi/tutorials/temperature/
*/

// Load node modules
var fs = require('fs');
var sys = require('sys');
var http = require('http');
var sqlite3 = require('sqlite3');
var async = require('async');
var config = require('./config');


// Use node-static module to server chart for client-side dynamic graph
var nodestatic = require('node-static');

// Setup static server for current directory
var staticServer = new nodestatic.Server(".");

// Setup database connection for logging
var db = new sqlite3.Database('./piTemps.db');

// Write a any number of temperature record's in JSON format to database table.
function insertTemps(err, data) {
    if (!err) {
        for (var i=0; i<config.sensors.length; i++){
            var d = data.temperature_record[i];
            d.unix_time = data.now;
            // data is a javascript object
            var statement = db.prepare("INSERT INTO temperature_records(sensor_id, unix_time, celsius) VALUES (?, ?, ?)");
            // Insert values into prepared statement
            statement.run(d.sensor_id, d.unix_time, d.celsius);
            // Execute the statement
            statement.finalize();
        }
    }
}

function readTemps(callback) {
    // Add date/time to temperature
    var data = {
            temperature_record: [],
            now : Date.now()
        };
    async.map(config.sensors, readTempFile, function(err, results){
        data.temperature_record = results;
        // Execute call back with data
        callback(0, data);
    })
};

function readTempFile(sensor, callback){
    fs.readFile(sensor.path, function(err, buffer) {
            if (err) {
                console.error(err);
                callback(1, err);
            } else {
                // Read data from file (using fast node ASCII encoding).
                 var raw = buffer.toString('ascii').split(" "); // Split by space

                // Extract temperature from string and divide by 1000 to give celsius
                var temp = parseFloat(raw[raw.length - 1].split("=")[1]) / 1000.0;

                // Round to one decimal place
                temp = Math.round(temp * 10) / 10;
                // Add date/time to temperature
                var item = {}
                item.celsius = temp;
                item.sensor_id = sensor.id;
                callback(null, item);
            }
        });
}

// Create a wrapper function which we'll use specifically for logging
function logTemps(interval) {
    // Call the readTemp function with the insertTemp function as output to get initial reading
    readTemps(insertTemps);
    // Set the repeat interval (milliseconds). Third argument is passed as callback function to first (i.e. readTemp(insertTemp)).
    setInterval(readTemps, interval, insertTemps);
};

// Get temperature records from database
function selectTemp(sensor_id, num_records, start_date, callback) {
    // - Num records is an SQL filter from latest record back trough time series, 
    // - start_date is the first date in the time-series required, 
    // - callback is the output function
    var current_temp = db.all("SELECT * FROM (SELECT * FROM temperature_records WHERE unix_time > (strftime('%s',?)*1000) and sensor_id = ? ORDER BY unix_time DESC LIMIT ?) ORDER BY unix_time;", start_date, sensor_id, num_records,
        function(err, rows) {
            if (err) {
                response.writeHead(500, {
                    "Content-type": "text/html"
                });
                response.end(err + "\n");
                console.log('Error serving querying database. ' + err);
                return;
            }
            data = {
                temperature_record: [rows]
            }
            callback(data);
        });
};

function selectSensors(callback) {
    var sql = "SELECT * FROM sensor_records ORDER BY sensor_id;";
    db.all(sql, function(err, rows) {
        if (err) {
            console.log('Error reading sensor_records from database: ' + err);
            response.writeHead(500, { "Content-type": "text/html" });
            response.end(err + "\n");
            return;
        }
        data = {
            sensor_record: [rows]
        };
        callback(data);
    });
}


// Setup node http server
var server = http.createServer(
    // Our main server function
    function(request, response) {
        // Grab the URL requested by the client and parse any query options
        var url = require('url').parse(request.url, true);
        var pathfile = url.pathname;
        var query = url.query;
        var sensor_id = 0;

        // Test to see if it's a database query
        if (pathfile == '/temperature_query.json') {
            // Test to see if number of observations was specified as url query
            if (query.num_obs) {
                var num_obs = parseInt(query.num_obs);
            } else {
                // If not specified default to 20. Note use -1 in query string to get all.
                var num_obs = -1;
            }
            if (query.start_date) {
                var start_date = query.start_date;
            } else {
                var start_date = '1970-01-01T00:00';
            }
            if (query.sensorid) {
                sensor_id = query.sensorid;
            }

            // Send a message to console log
            console.log('Database query request from ' + request.connection.remoteAddress + ' for ' + num_obs + ' records from ' + start_date + '.');
            // call selectTemp function to get data from database
            selectTemp(sensor_id, num_obs, start_date, function(data) {
                response.writeHead(200, {
                    "Content-type": "application/json"
                });
                response.end(JSON.stringify(data), "ascii");
            });
            return;
        }

        if (pathfile == '/sensors.json') {
            selectSensors(function(data) {
                response.writeHead(200, {
                    "Content-type": "application/json"
                });
                response.end(JSON.stringify(data), "ascii");
            });
            return;
        }

        // Test to see if it's a request for current temperature   
        if (pathfile == '/temperature_now.json') {
            readTemps(function(err, data) {
                response.writeHead(200, {
                    "Content-type": "application/json"
                });
                response.end(JSON.stringify(data), "ascii");
            });
            return;
        }

        // Handler for favicon.ico requests
        if (pathfile == '/favicon.ico') {
            response.writeHead(200, {
                'Content-Type': 'image/x-icon'
            });
            response.end();

            // Optionally log favicon requests.
            //console.log('favicon requested');
            return;
        }

        if (pathfile == '/addtemp') {
            if (query.sensorid && query.temp) {
                var unix_time;

                if (query.unixtime) {
                    unix_time = query.unixtime;
                } else {
                    unix_time = Date.now();
                }
                var data = {
                    temperature_record: [{
                        sensor_id: query.sensorid,
                        unix_time: unix_time,
                        celsius: parseFloat(query.temp)
                    }]
                };
                insertTemp(0, data);
                response.end(JSON.stringify(data), "ascii");
            } else {
                //error
                response.writeHead(404, {
                    "Content-Type": "text/plain"
                });
                response.write("404 Not found");
                response.end();
            }
            return;
        } else {
            // Print requested file to terminal
            console.log('Request from ' + request.connection.remoteAddress + ' for: ' + pathfile);

            // Serve file using node-static			
            staticServer.serve(request, response, function(err, result) {
                if (err) {
                    // Log the error
                    sys.error("Error serving " + request.url + " - " + err.message);

                    // Respond to the client
                    response.writeHead(err.status, err.headers);
                    response.end("<a href='/temperature_log.htm'>Temp Log</a><p><a href='/temperature_plot.htm'> Temp Plot</a>");
                    return;
                }
                return;
            })
        }
    });

// Start temperature logging (every 5 min).
var msecs = (60 * 5) * 1000; // log interval duration in milliseconds
logTemps(msecs);
// Send a message to console
console.log('Server is logging to database at ' + msecs + 'ms intervals');
// Enable server
server.listen(config.port);
// Log message
console.log('Server running at http://localhost:' + config.port);
console.log('Real time data plot: http://localhost:'+ config.port +'/temperature_plot.htm');
console.log('Data log: http://localhost:'+ config.port +'/temperature_log.htm');
