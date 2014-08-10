"use strict";

var id = -1;
var workerType = null;
var key = null;

function reply(type, msg) {
	var m = msg || {};
	m.id = id;
	postMessage({type:type, id:id, message:m});
}

function workerDefault(msg) {
	switch(msg.data.type) {
		case "start":
			id = msg.data.id;
			workerType = msg.data.workerType;
			key = msg.data.key;
			reply("started");
			return false;
		case "stop":
			reply("stopped");
			terminate();
			return true;
	}
	return false;
}

function error(msg) {
	var err = new Error(msg);
	msg += "\n" + err.stack;
	notify("error", msg);
	throw err;
}

function warn(msg) {
	notify("warning", msg);
}

function log(msg) {
	notify("info", msg);
}

function notify(severity, msg) {
	if(id != -1) {
		reply("message", {message:msg, severity:severity});
	} else {
		postMessage({type:"message", message:{message: msg, severity:severity}});
	}
}
