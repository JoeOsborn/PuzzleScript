//monkey-patch compile

//Put a branch here for idempotence sake
if(!this.hasOwnProperty("compileAndAnalyze") ||
	 !this.compileAndAnalyze) {
	console.log("patch compile");
	var justCompile = compile;
	var compileAndAnalyze = function(command,text,randomSeed) {
		justCompile(command,text,randomSeed);
		Analyzer.analyze(command,text,randomSeed);
	}
	compile = compileAndAnalyze;
}

var Analyzer = (function() {
	var module = {};

	//Launch a web worker to do analysis without blocking the UI.
	module.analyze = function(command,text,randomseed) {
		//by this time, compile has already been called.
		if (!text){
			var code = window.form1.code;
			var editor = code.editorreference;
			text = editor.getValue()+"\n";
		}
		console.log("analyze "+command+" with "+randomseed+" for "+text);
		killWorker("solve", 1);
		startWorker("solve", 1, {
			rules:text,
			level:1,
			seed:randomseed,
			verbose:true
		});
	}

	var workers = [];
	var workerLookup = {};
	var workerScripts = {
		"solve": "js/analyzer/worker_solve.js"
	};

	function killWorker(type,key) {
		/*control.postMessage({
		type:"kill",
		workerType:"solve",
		lookup:1
	});*/
		var w = getWorker(type,key,false);
		if(!w) { return null; }
		w.close();
		workers[w.id] = null;
		delete workerLookup[type][key];
		return w;
	}

	function getWorker(type,key,require) {
		if(require === undefined) { require = true; }
		if(!workerLookup[type]) {
			if(require) {
				error("Unknown worker type "+type);
			}
			return null;
		}
		if(workerLookup[type] && !workerLookup[type][key]) {
			notify(require ? "error" : "warning",
						 "Unknown worker "+type+" : "+key);
			return null;
		}
		return workerLookup[type][key];
	}

	function startWorker(type, key, init) {
		if(getWorker(type,key,false)) {
			error("Can't start duplicate worker "+type+" : "+key)
		}
		var w = new Worker(workerScripts[type]);
		log("Created worker "+w);
		if(!workerLookup[type]) {
			workerLookup[type] = {};
		}
		workerLookup[type][key] = w;
		w.workerType = type;
		w.key = key;

		w.onmessage = function(msg) {
			console.log("got "+JSON.stringify(msg.data));
			if(msg.data.type == "busy") {
				workers[msg.data.id].postMessage({
					type:"resume",
					continuation:msg.data.continuation
				});
			}
		};
		w.onerror = function(event) {
			throw new Error(event.message + " (" + event.filename + ":" + event.lineno + ")");
		}

		w.postMessage({type:"start",
									 id:workers.length,
									 workerType:type,
									 key:key,
									 init:init});
		log("sent init message");
		workers.push(w);

		return w;
	};

	return module;
})();

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
	console.log(severity+":"+msg);
}
