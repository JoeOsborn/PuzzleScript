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
	var USE_WORKERS = true;
	var INPUT_MAPPING = {};
	INPUT_MAPPING[-1]="WAIT";
	INPUT_MAPPING[0]="UP";
	INPUT_MAPPING[1]="LEFT";
	INPUT_MAPPING[2]="DOWN";
	INPUT_MAPPING[3]="RIGHT";
	INPUT_MAPPING[4]="ACT";

	//Launch a web worker to do analysis without blocking the UI.
	module.analyze = function(command,text,randomseed) {
		//by this time, compile has already been called.
		if (!text){
			var code = window.form1.code;
			var editor = code.editorreference;
			text = editor.getValue()+"\n";
		}
		console.log("analyze "+command+" with "+randomseed+" in "+curlevel);
		if(!state.levels[curlevel] || state.levels[curlevel].message) {
			console.log("Skip analysis of regular level");
			return;
		}
		if(USE_WORKERS) {
			killWorker("solve", curlevel);
			startWorker("solve", curlevel, {
				rules:text,
				level:curlevel,
				seed:randomseed,
				verbose:true
			});
		} else {
			var solutions = 0;
			Solver.startSearch({
				rules:text,
				level:curlevel,
				seed:randomseed,
				verbose:true,
				replyFn:function(type,msg) {
					console.log("MSG:"+type+":"+JSON.stringify(msg));
					switch(type) {
						case "busy":
							setTimeout(function() {
								Solver.continueSearch(msg.continuation);
							}, 10);
							break;
						case "solution":
							solutions++;
							consolePrint("Found solution #"+solutions+" (n"+msg.solution.id+") of first-found cost "+msg.solution.prefixes[0].length+" at iteration "+msg.iteration+":<br/>&nbsp;"+msg.solution.prefixes.map(
								function(p){
									return p.map(
										function(d){return INPUT_MAPPING[d];}
									).join(",");
								}).join("<br/>&nbsp;"));
							consoleCacheDump();
							break;
					}
				}
			});
		}
	}

	var workers = [];
	var workerLookup = {};
	var workerScripts = {
		"solve": "js/analyzer/worker_solve.js"
	};

	function killWorker(type,key) {
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
			var type = msg.data.type;
			console.log("MSG:"+type+":"+JSON.stringify(msg.data));
			switch(type) {
				case "busy":
					workers[msg.data.id].postMessage({
						type:"resume",
						continuation:msg.data.continuation
					});
					break;
				case "solution":
					solutions++;
					consolePrint("Found solution #"+solutions+" (n"+msg.data.solution.id+") of first-found cost "+msg.data.solution.prefixes[0].length+" at iteration "+msg.data.iteration+":<br/>&nbsp;"+msg.data.solution.prefixes.map(
						function(p){
							return p.map(
								function(d){return INPUT_MAPPING[d];}
							).join(",");
						}).join("<br/>&nbsp;"));
					consoleCacheDump();
					break;
				default:
					break;
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
