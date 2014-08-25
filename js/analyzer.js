'use strict';
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

if(!this.hasOwnProperty("setEditorAnalyzerClean") ||
	 !this.setEditorAnalyzerClean) {
	console.log("patch setEditorClean");
	var justSetClean = setEditorClean;
	var setEditorAnalyzerClean = function() {
		justSetClean();
		Analyzer.clear();
	}
	setEditorClean = setEditorAnalyzerClean;	
}

var code = window.form1.code;
var editor = code ? code.editorreference : null;

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

	var REVERSE_INPUT_MAPPING = {
		WAIT:-1,
		UP:0,
		LEFT:1,
		DOWN:2,
		RIGHT:3,
		ACT:4
	};
	
	var lastRules = "";
	var gameRules = "";
	var levelQueue = [];
	var seenSolutions = {};
	var lastSeenSolutions = {};
	
	var lineHighlights = {};
	var solvedClass = "line-solved";
	var unsolvedClass = "line-unsolved";
	var unsolvableClass = "line-unsolvable";

	var hintUsedClass = "line-hint-used";
	var hintUnusedClass = "line-hint-unused";
	
	var workers = [];
	var workerLookup = {};
	var workerScripts = {
		"solve": "js/analyzer/worker_solve.js"
	};
	
	module.clear = function clear() {
		clearLineHighlights();
		lastRules = "";
		gameRules = "";
		levelQueue = [];
		seenSolutions = {};
		lastSeenSolutions = {};
		for(var t in workerLookup) {
			for(var k in workerLookup) {
				killWorker(t, k);
			}
		}
		workers = [];
	}

	//Launch a web worker to do analysis without blocking the UI.
	module.analyze = function analyze(command,text,randomseed) {
		//by this time, compile has already been called.
		if(errorCount > 0) {
			consolePrint("Analysis cancelled due to errors.");
			return;
		}
		if(!text && editor) {
			text = editor.getValue()+"\n";
		}
		gameRules = text;
		console.log("analyze "+command+" with "+randomseed+" in "+curlevel);
		if(gameRules != lastRules) {
			var solvers = getAllWorkers("solve");
			//TODO: if this is a different game, nuke seenSolutions
			//kill stale workers.
			//TODO: only kill them if their levels' texts have changed or if the rules have changed.
			levelQueue = [];
			for(var i = 0; i < solvers.length; i++) {
				killWorker("solve", solvers[i].key);
			}
			if(curlevel) {
				curlevel = parseInt(curlevel);
				if(isNaN(curlevel)) {
					curlevel = undefined;
				}
			}
			levelQueue = createLevelQueue(true, curlevel !== undefined && curlevel > 0 ? [curlevel] : []);
			consolePrint("Analyze levels:"+JSON.stringify(levelQueue));
			tickLevelQueue(null);
			tickLevelQueue(null);
			lastRules = gameRules;
		} else {
			consolePrint("Rules are unchanged. Skipping analysis.");
		}
	}
	
	module.dumpHint = function dumpHint() {
		var input = prefixToSolutionSteps(inputHistory);
		consolePrint("<br/>Paste this just after the level definition:<br/>(@HINT:"+input.join(" ")+")<br/>",true);
	};
	
	function nextEmptyLine(l) {
		var str = "";
		do {
			l++;
			str = editor.getLine(l);
		} while(str && str.trim() != "");
		return l;
	}
	
	function nextLevelLine(lev) {
		for(var l=lev+1; l < state.levels.length; l++) {
			if(state.levels[l].lineNumber) {
				return state.levels[l].lineNumber;
			}
		}
		return editor.lineCount();
	}
	
	function arrayEquiv(a1, a2) {
		if(a1.length != a2.length) { return false; }
		for(var i = 0; i < a1.length; i++) {
			if(a1[i] != a2[i]) {
				return false;
			}
		}
		return true;
	}

	function memberArray(arrays, array) {
		for(var i = 0; i < arrays.length; i++) {
			var ar = arrays[i];
			if(arrayEquiv(ar, array)) {
				return ar;
			}
		}
		return null;
	}
	
	function hasPrefix(array, prefix) {
		if(prefix.length > array.length) { return false; }
		for(var i = 0; i < prefix.length; i++) {
			if(array[i] != prefix[i]) {
				return false;
			}
		}
		return true;
	}
	
	function anyHasPrefix(arrays, prefix) {
		for(var i = 0; i < arrays.length; i++) {
			var ar = arrays[i];
			if(hasPrefix(ar, prefix)) {
				return ar;
			}
		}
		return null;
	}

	function hasAnyPrefix(array, prefixes) {
		for(var i = 0; i < prefixes.length; i++) {
			var prefix = prefixes[i];
			if(hasPrefix(array, prefix)) {
				return prefix;
			}
		}
		return null;
	}
	
	function clearLineHighlights() {
		for(var l in lineHighlights) {
			editor.removeLineClass(l, "background", lineHighlights[l]);
		}
	}
	
	function updateLevelHighlights() {
		clearLineHighlights();
		lineHighlights = {};
		for(var i=0; i < state.levels.length; i++) {
			if(state.levels[i].lineNumber && seenSolutions[i]) {
				var upTo = nextEmptyLine(state.levels[i].lineNumber);
				var solClass = seenSolutions[i].solved ? solvedClass :
					(seenSolutions[i].exhaustive ? unsolvableClass : unsolvedClass);
				console.log("highlight "+state.levels[i].lineNumber+".."+upTo+" with "+solClass);
				for(var l = state.levels[i].lineNumber-1; l < upTo; l++) {
					editor.removeLineClass(l, "background", solvedClass);
					editor.removeLineClass(l, "background", unsolvedClass);
					editor.removeLineClass(l, "background", unsolvableClass);
					editor.addLineClass(l, "background", solClass);
					lineHighlights[l] = solClass;
				}
				//now, highlight hints:
				//if a hint is prefix to the solution, highlight it green
				//otherwise, highlight it red
				if(seenSolutions[i].solved) {
					var hints = hintLinesBetween(state.levels[i].lineNumber, nextLevelLine(i));
					for(var j = 0; j < hints.lines.length; j++) {
						l = hints.lines[j];
						var hintClass = anyHasPrefix(seenSolutions[i].prefixes, hints.prefixes[j]) ? hintUsedClass : hintUnusedClass;
						editor.removeLineClass(l, "background", hintUsedClass);
						editor.removeLineClass(l, "background", hintUnusedClass);
						editor.addLineClass(l, "background", hintClass);
						lineHighlights[l] = hintClass;
					}
				}
			}
		}
	}
	
	function rulePart(rules) {
		return rules.substring(0,rules.search(/\bLEVELS\b/));
	}
	
	function equivLevels(l1, l2) {
		if(l1 == l2) { return true; }
		if(!l1 && l2) { return false; }
		if(l1 && !l2) { return false; }
		if(l1.objects && !l2.objects) { return false; }
		if(!l1.objects && l2.objects) { return false; }
		if(!l1.objects && !l2.objects) { return l1.message == l2.message; }
		if(l1.width != l2.width || l1.height != l2.height || l1.objects.length != l2.objects.length) { return false; }
		for(var i=0; i < l1.objects.length; i++) {
			if(l1.objects[i] != l2.objects[i]) { 
				return false; 
			}
		}
		return true;
	}
	
	function equivRules(oldRules, newRules) {
		return oldRules == newRules;
	}
	
	function enqueueLevel(q,lev,force) {
		var prevLevel = seenSolutions[lev] ? seenSolutions[lev].level : null;
		var prevRules = seenSolutions[lev] ? seenSolutions[lev].ruleText : null;
		var stale = seenSolutions[lev] && seenSolutions[lev].stale;
		if(stale || !equivLevels(prevLevel, state.levels[lev]) || !equivRules(rulePart(prevRules), rulePart(gameRules))) {
			q.push(lev);
			return;
		}
		consolePrint("Level "+lev+" seems unchanged");
	}
	
	function createLevelQueue(force, prioritize) {
		//TODO: permit "clearing" default hints.
		var q = [];
		for(var i = 0; i < prioritize.length; i++) {
			if(state.levels[prioritize[i]] && !state.levels[prioritize[i]].message) {
				enqueueLevel(q,prioritize[i],force);
			}
		}
		for(i = 0; i < state.levels.length; i++) {
			if(q.indexOf(i) == -1 && state.levels[i] && !state.levels[i].message) {
				enqueueLevel(q,i,force);
			}
		}
		//assert(every_element_unique(q))
		return q;
	}
	
	function hintLinesBetween(l1, l2) {
		var hints = [];
		var lines = [];
		for(var l = l1; l < l2; l++) {
			var line = editor.getLine(l).trim();
			var match = /\(\s*@HINT:\s*((?:UP|DOWN|LEFT|RIGHT|ACTION|WAIT)(?:\s+(UP|DOWN|LEFT|RIGHT|ACTION|WAIT))*)\s*\)/i.exec(line);
			if(match) {
				var hint = [];
				var moves = match[1].split(" ");
				for(var i=0; i < moves.length; i++) {
					if(moves[i].trim() != "") {
						hint.push(REVERSE_INPUT_MAPPING[moves[i].toUpperCase()]);
					}
				}
				hints.push(hint);
				lines.push(l);
			}
		}
		//console.log("Using hints "+hints.map(prefixToSolutionSteps).join("<br/>&nbsp;&nbsp;"));
		return {prefixes:hints, lines:lines};
	}
	
	function levelHint(lev) {
		var userHints = hintLinesBetween(state.levels[lev].lineNumber+1, nextLevelLine(lev));
		var solHints = seenSolutions[lev] && seenSolutions[lev].prefixes && seenSolutions[lev].prefixes.length ? seenSolutions[lev] : {prefixes:[]};
		userHints.prefixes = userHints.prefixes.concat(solHints.prefixes);
		return userHints;
	}
	
	function tickLevelQueue(wkr) {
		if(!levelQueue.length) { return; }
		var lev = levelQueue.shift();
		var level = state.levels[lev];
		var hint = levelHint(lev);
		//If we previously had some good solutions for lev:
		if(seenSolutions[lev] && !seenSolutions[lev].stale) {
			//Copy them and mark seenSolutions[lev] as stale
			seenSolutions[lev].stale = true; 
			lastSeenSolutions[lev] = deepClone(seenSolutions[lev]);
		}
		if(USE_WORKERS) {
			startWorker("solve", lev, {
				rules:gameRules,
				level:lev,
				mode:"fast",//"fast_then_best",
				//seed:randomseed,
				hint:hint,
				verbose:true
			}, handleSolver, tickLevelQueue);
		} else {
			Solver.startSearch({
				rules:gameRules,
				level:lev,
				mode:"fast",//"fast_then_best",
				hint:hint,
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

	function solutionStepsToPrefix(p) {
		return p.map(
			function(d){return REVERSE_INPUT_MAPPING[d];}
		);
	}
	
	function handleSolver(id,type,data) {
		switch(type) {
			case "solution":
				consolePrint("<span class='line-level-solvable'>Level "+data.level+": Found solution #"+1+" (n"+data.solution.id+") of first-found cost "+data.solution.prefixes[0].length+" at iteration "+data.iteration+" ("+data.time+" seconds):<br/>&nbsp;"+data.solution.prefixes.map(function(p) { return prefixToSolutionSteps(p).join(" "); }).join("<br/>&nbsp;")+"</span>");
				if(data.iteration == 0) {
					consolePrint("&nbsp;(Thanks to hint from last time)");
				}
				recordSolution(workers[id].init.rules, workers[id].init.levelText, data);
				consoleCacheDump();
				// TODO: I just got a solution. was it the first solution? if so, do not continue this solver until other guys get a chance to run.
				//	   do fancy stuff with hints, warnings, etc
				// otherwise: compare the new solution to the old best solution. let it continue normally right away.
				//	   do the same fancy stuff with hints, warnings, etc
				break;
			case "exhausted":
				consolePrint("Level "+data.level+": Did not find more solutions after "+data.iterations+" iterations ("+data.time+" seconds)");
				if(!seenSolutions[data.level] || seenSolutions[data.level].stale) {
					recordFailure(workers[id].init.rules, workers[id].init.levelText, data);
					if(data.queueLength > 0) {
						levelQueue.push(data.level);
						consolePrint("Level "+data.level+" is taking some time to solve.");
					} else {
						consolePrint("<span class='line-level-unsolvable'>Level "+data.level+" is not solvable!</span>");
					}
				}
				if(lastSeenSolutions[data.level]) {
					var oldSolutions = lastSeenSolutions[data.level].prefixes;
					var newSolutions = seenSolutions[data.level].prefixes;
					if(lastSeenSolutions[data.level].solved && seenSolutions[data.level].solved) {
						var absentOldSolutions = oldSolutions.filter(function(sol) {
							return !memberArray(newSolutions, sol);
						});
						var brandNewSolutions = newSolutions.filter(function(sol) {
							return !memberArray(oldSolutions, sol);
						});
						//Print console info for solutions which have changed or disappeared.
						for(var i = 0; i < absentOldSolutions.length; i++) {
							var oldSoln = absentOldSolutions[i];
							var newSoln;
							if((newSoln = anyHasPrefix(newSolutions, oldSoln))) {
								consolePrint(
									'<span class="line-solution-got-longer">Level '+data.level+': Solution got longer in new version:<br/>'+
									'&nbsp;'+prefixToSolutionSteps(oldSoln).join(" ")+'<br/>'+
									'&nbsp;--&gt;<br/>'+
									'&nbsp;'+prefixToSolutionSteps(newSoln).join(" ")+
									'</span>'
								);
								brandNewSolutions.splice(brandNewSolutions.indexOf(newSoln),1);
							} else if((newSoln = hasAnyPrefix(oldSoln, newSolutions))) {
								consolePrint(
									'<span class="line-solution-got-shorter">Level '+data.level+': Solution got shorter in new version:<br/>'+
									'&nbsp;'+prefixToSolutionSteps(oldSoln).join(" ")+'<br/>'+
									'&nbsp;--&gt;<br/>'+
									'&nbsp;'+prefixToSolutionSteps(newSoln).join(" ")+
									'</span>'
								);
								brandNewSolutions.splice(brandNewSolutions.indexOf(newSoln),1);
							} else {
								consolePrint(
									'<span class="line-solution-disappeared">Level '+data.level+': Solution no longer used in new version:<br/>'+
									'&nbsp;'+prefixToSolutionSteps(oldSoln).join(" ")+'<br/>'+
									'&nbsp;--&gt;<br/>'+
									'&nbsp;XXXX'+
									'</span>'
								);
							}
						}
						//for each soln of newSolutions which do not share prefix
						//with anything in oldSolutions... (those have been removed)
						for(i = 0; i < brandNewSolutions.length; i++) {
							var newSoln = brandNewSolutions[i];
							consolePrint(
								'<span class="line-solution-appeared">Level '+data.level+': New solution appeared in new version:<br/>'+
								'&nbsp;XXXX'+
								'&nbsp;--&gt;<br/>'+
								'&nbsp;'+prefixToSolutionSteps(newSoln).join(" ")+'<br/>'+
								'</span>'
							);
						}
					} else if(lastSeenSolutions[data.level].solved) {
						//level used to be solvable but now is not
						consolePrint(
							'<span class="line-level-unsolvable">Level '+data.level+' used to be solvable by:<br/>'+
							'&nbsp;'+oldSolutions.map(prefixToSolutionSteps).join("<br/>&nbsp;")+'<br/>'+
							'</span>'
						);
					} else if(seenSolutions[data.level].solved) {
						consolePrint(
							'<span class="line-level-solvable">Level '+data.level+' is now solvable by:<br/>'+
							'&nbsp;'+newSolutions.map(prefixToSolutionSteps).join("<br/>&nbsp;")+'<br/>'+
							'</span>'
						);
					}
				}
				consoleCacheDump();
				break;
			case "hintInsufficient":
				//TODO: avoid showing this message for system-provided (i.e. non-user) hints.
				if(seenSolutions[data.level] && !seenSolutions[data.level].solved) { break; }
				consolePrint("<span class='line-insufficient-hints'>Level "+data.level+": Hints did not solve level on their own.</span>");
				break;
			default:
				break;
		}
	}
	
	//Add a solution to seenSolutions[lev], unless it's stale in which case clobber it and wait for more.
	function recordSolution(ruleText, levelText, data) {
		var level = data.level;
		var soln = data.solution;
		if(!seenSolutions[level] || seenSolutions[level].stale) {
			seenSolutions[level] = {
				ruleText:ruleText,
				levelText:levelText,
				level:state.levels[level],
				solved:true,
				stale:false,
				prefixes:soln.prefixes,
				steps:soln.prefixes.map(prefixToSolutionSteps),
				iteration:data.iteration,
				exhaustive:data.queueLength == 0,
				f:soln.f, g:soln.g, h:soln.h
			};
		} else {
			seenSolutions[level].prefixes = seenSolutions[level].prefixes.concat(soln.prefixes);
			seenSolutions[level].steps = seenSolutions[level].steps.concat(soln.prefixes.map(prefixToSolutionSteps));
			seenSolutions[level].exhaustive = data.queueLength == 0;
		}
		
		updateLevelHighlights();
		return seenSolutions[level];
	}

	//It's definitely unsolvable if data.queueLength == 0.
	function recordFailure(ruleText, levelText, data) {
		var level = data.level;
		seenSolutions[level] = {
			ruleText:ruleText,
			levelText:levelText,
			level:state.levels[level],
			solved:false,
			stale:false,
			prefixes:data.kickstart,
			steps:[],
			iteration:data.iteration,
			exhaustive:data.queueLength == 0,
			f:-1, g:-1, h:-1
		};
		updateLevelHighlights();
		return seenSolutions[level];
	}

	function killWorker(type,key) {
		console.log("KILL: "+type+" . "+key);
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
		var result = [];
		for(var k in workerLookup[type]) {
			result.push(workerLookup[type][k]);
		}
		return result;
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
			// console.log("got "+type+":"+JSON.stringify(data));
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
					killWorker(wtype,key);
					whenFinished(w);
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