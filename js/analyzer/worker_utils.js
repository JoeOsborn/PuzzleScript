"use strict";

var id = -1;
var workerType = null;
var key = null;

function reply(type, msg) {
	var m = msg || {};
	m.type = type;
	m.id = id;
	self.postMessage(m);
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
			self.close();
			return true;
	}
	return false;
}

function error(msg) {
	notify("error", msg);
	throw new Error(msg);
}

function warn(msg) {
	notify("warning", msg);
}

function log(msg) {
	notify("info", msg);
}

function notify(severity, msg) {
	if(id != -1) {
		reply(severity, msg);
	} else {
		self.postMessage({type:severity, message:msg});
	}
}
