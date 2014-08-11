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
	var lastRules = "";
	var gameRules = "";
	var levelQueue = [];
	var seenSolutions = {};
	
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
		gameRules = text;
		console.log("analyze "+command+" with "+randomseed+" in "+curlevel);
		if(gameRules != lastRules) {
			var solvers = getAllWorkers("solve");
			//TODO: if this is a different game, nuke seenSolutions
			//kill stale workers.
			//TODO: only kill them if their levels' texts have changed or if the rules have changed.
			for(var i = 0; i < solvers.length; i++) {
				killWorker("solve", solvers[i].id);
			}
			levelQueue = createLevelQueue(true, [curlevel]);
			tickLevelQueue(null);
			lastRules = gameRules;
		} else {
			consolePrint("Rules are unchanged. Skipping analysis.");
		}
	}
	
	function createLevelQueue(force, prioritize) {
		//TODO: only add levels that have changed since last solution (unless the rules themselves have changed)
		//TODO: log a visible console message if the hint does not solve things by itself. in any event, use the last found solution as a default hint.
		//TODO: permit "clearing" default hints.
		var q = [];
		for(var i = 0; i < prioritize.length; i++) {
			if(state.levels[prioritize[i]] && !state.levels[prioritize[i]].message) {
				q.push(prioritize[i]);
			}
		}
		for(i = 0; i < state.levels.length; i++) {
			if(q.indexOf(i) == -1 && state.levels[i] && !state.levels[i].message) {
				q.push(i);
			}
		}
		//assert(every_element_unique(q))
		return q;
	}
	
	//TODO: try running two or three workers at once.
	function tickLevelQueue(wkr) {
		if(!levelQueue.length) { return; }
		var lev = levelQueue.shift();
		if(USE_WORKERS) {
			startWorker("solve", lev, {
				rules:gameRules,
				level:lev,
				//seed:randomseed,
				hint:seenSolutions[lev],
				verbose:true
			}, handleSolver, tickLevelQueue);
		} else {
			Solver.startSearch({
				rules:gameRules,
				level:lev,
				hint:seenSolutions[lev],
				//seed:randomseed,
				verbose:true,
				replyFn:function(type,msg) {
					console.log("MSG:"+type+":"+JSON.stringify(msg));
					switch(type) {
						case "busy":
							setTimeout(function() {
								Solver.continueSearch(msg.continuation);
							}, 10);
							break;
						case "stopped":
							tickLevelQueue(null);
							break;
						default:
							handleSolver(lev,type,msg);
							break;
					}
				}
			});
		}
	}
	
	function prefixToSolutionSteps(p) {
		return p.map(
			function(d){return INPUT_MAPPING[d];}
		);
	}
	
	//TODO: save solutions per-level (of course, nullify them if the game changes!)
	function handleSolver(id,type,data) {
		switch(type) {
			case "solution":
				consolePrint("Level "+data.level+": Found solution #"+1+" (n"+data.solution.id+") of first-found cost "+data.solution.prefixes[0].length+" at iteration "+data.iteration+":<br/>&nbsp;"+data.solution.prefixes.map(function(p) { return prefixToSolutionSteps(p).join(","); }).join("<br/>&nbsp;"));
				if(data.iteration == 0) {
					consolePrint("&nbsp;(Thanks to hint from last time)");
				}
				recordSolution(workers[id].init.rules, workers[id].init.levelText, data);
				consoleCacheDump();
				break;
			case "exhausted":
				consolePrint("Level "+data.level+": Did not find more solutions after "+data.iterations+" iterations");
				break;
			case "hintInsufficient":
				consolePrint("Level "+data.level+": Hint did not solve level on its own.");
				break;
			default:
				break;
		}
	}
	
	function recordSolution(ruleText, levelText, data) {
		var level = data.level;
		var soln = data.solution;
		seenSolutions[level] = {
			ruleText:ruleText,
			levelText:levelText,
			prefixes:soln.prefixes,
			steps:soln.prefixes.map(prefixToSolutionSteps),
			iteration:data.iteration,
			f:soln.f, g:soln.g, h:soln.h
		};
		return seenSolutions[level];
	}

	var workers = [];
	var workerLookup = {};
	var workerScripts = {
		"solve": "js/analyzer/worker_solve.js"
	};

	function killWorker(type,key) {
		var w = getWorker(type,key,false);
		if(!w) { return null; }
		w.terminate();
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

	function getAllWorkers(type) {
		if(!workerLookup[type]) {
			return [];
		}
		return workerLookup[type];
	}
	
	function startWorker(wtype, key, init, handle, whenFinished) {
		var solutions = 0;
		if(getWorker(wtype,key,false)) {
			error("Can't start duplicate worker "+wtype+" : "+key)
		}
		var w = new Worker(workerScripts[wtype]);
		log("Created worker "+w);
		if(!workerLookup[wtype]) {
			workerLookup[wtype] = {};
		}
		workerLookup[wtype][key] = w;
		w.workerType = wtype;
		w.key = key;
		w.init = init;

		w.onmessage = function(msg) {
			var type = msg.data.type;
			var data = msg.data.message;
			var id = msg.data.id;
			console.log("got "+type+":"+JSON.stringify(data));
			switch(type) {
				case "message":
					console.log(""+data.severity + ":" + JSON.stringify(data.message));
					break;
				case "busy":
					workers[id].postMessage({
						type:"resume",
						continuation:data.continuation
					});
					break;
				case "stopped":
					whenFinished(w);
					killWorker(wtype,key);
					break;
				default:
					handle(id,type,data);
					break;
			}
		};
		w.onerror = function(event) {
			killWorker(wtype,key);
			throw new Error(event.message + " (" + event.filename + ":" + event.lineno + ")");
		}

		w.postMessage({type:"start",
			           id:workers.length,
			           workerType:wtype,
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
