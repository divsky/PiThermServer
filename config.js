var config = {}
config.port = 80;
config.sensors = []
config.sensors.push({
					name: "Sensor 0",
					path: "/sys/bus/w1/devices/28-0000055d8bf9/w1_slave",
					id: 0
					})
config.sensors.push({
					name: "Sensor 1",
					path: "/sys/bus/w1/devices/28-00000474c896/w1_slave",
					id: 1
					})
module.exports = config;