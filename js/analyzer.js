'use strict';

function compileAndAnalyze(cmd, lev, seed) {
	compile(cmd, lev, seed);
	if(typeof Analyzer != "undefined") {
		Analyzer.analyze(cmd,lev,seed);
	}
}

var Analyzer = (function() {
	var module = {};
	
	module.MODE_NORMAL = "MODE_NORMAL";
	module.MODE_MEM_TEST = "MODE_MEM_TEST";
	
	module.mode = module.MODE_NORMAL;
	
	var USE_WORKERS = true;
	var RANDOM_RESTART = false;
	var AUTO_HINT = false;
	var INPUT_MAPPING = {};
	INPUT_MAPPING[-1]="WAIT";
	INPUT_MAPPING[0]="UP";
	INPUT_MAPPING[1]="LEFT";
	INPUT_MAPPING[2]="DOWN";
	INPUT_MAPPING[3]="RIGHT";
	INPUT_MAPPING[4]="ACTION";
	
	var CODE_ANY_MOVE = -3;
	var CODE_DOTDOTDOT = -2;

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
	
	var analyzerRuleCountGutter = module.analyzerRuleCountGutter = "analyzer-rulecount";
	var _ruleCountMode = 0;
	function getRuleCountMode() {
		return ruleCountModes[_ruleCountMode];
	}
	function switchToNextRuleCountMode() {
		_ruleCountMode = (_ruleCountMode + 1) % ruleCountModes.length;
		return getRuleCountMode();
	}
	var RC_MODE_INTERACTIVE = "rc-interactive";
	var RC_MODE_THIS_LEVEL_WIN = "rc-this-level-win";
	var RC_MODE_ALL_LEVELS_WIN = "rc-all-levels-win";
	var RC_CATEGORY_WIN = Utilities.RC_CATEGORY_WIN;
	var RC_CATEGORY_INTERACTIVE = Utilities.RC_CATEGORY_INTERACTIVE;
	var storedRuleCounts = [];
	var ruleCountModes = [
		RC_MODE_INTERACTIVE,
		RC_MODE_THIS_LEVEL_WIN,
		RC_MODE_ALL_LEVELS_WIN
	];

	var lineHighlights = {};
	var solvedClass = "line-editor-solved";
	var unsolvedClass = "line-editor-unsolved";
	var unsolvableClass = "line-editor-unsolvable";

	var specMetClass = "line-editor-spec-met";
	var specUnmetClass = "line-editor-spec-unmet";

	var lineSolutionTooShortClass = "line-editor-solution-too-short";
	var lineSolutionTooLongClass = "line-editor-solution-too-long";
	
	var workers = [];
	var workerLookup = {};
	var workerScripts = {
		"solve": "js/analyzer/worker_solve.js",
		"memorytest": "js/analyzer/worker_memorytest.js"
	};
	
	registerApplyAtWatcher(ruleApplied);
	consolePrint("The right-hand gutter is now showing counts of rules triggered by interactive play.");
	
	module.clear = function clear() {
		clearLineHighlights();
		clearRuleCountDisplay();
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
		parseSpecs();
		if(module.mode == module.MODE_MEM_TEST) {
			killAllWorkers();
			levelQueue = [];
			if(curlevel) {
				curlevel = parseInt(curlevel);
				if(isNaN(curlevel)) {
					curlevel = undefined;
				}
			}
			runMemoryTest(null);
			return;
		}
		if(gameRules != lastRules) {
			//TODO: only kill them if their levels' texts have changed or if the rules have changed.
			killAllWorkers();
			levelQueue = [];
			if(curlevel) {
				curlevel = parseInt(curlevel);
				if(isNaN(curlevel)) {
					curlevel = undefined;
				}
			}
			for(var l = 0; l < state.levels.length; l++) {
				if(!storedRuleCounts[l]) {
					storedRuleCounts[l] = {};
				}
				if(!storedRuleCounts[l][RC_CATEGORY_INTERACTIVE]) {
					storedRuleCounts[l][RC_CATEGORY_INTERACTIVE] = [];
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
		updateRuleCountDisplay();
	}
	
	module.dumpSpec = function dumpSpec() {
		var input = prefixToSolutionSteps(inputHistory).join(" , ") + " , ...";
		consolePrint("<br/>Paste this just after the level definition:<br/>(@SPEC:"+input.join(" ")+")<br/>",true);
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

	// function allMatchingSpec(lev, arrays, hint) {
	// 	var matched = [];
	// 	for(var i = 0; i < arrays.length; i++) {
	// 		var ar = arrays[i];
	// 		if(hintMatches(lev, ar, hint)) {
	// 			matched.push(ar);
	// 		}
	// 	}
	// 	return matched;
	// }
	//
	// var _ao1, zero;
	// function hintMatches(lev, steps, hint) {
	// 	//FIXME: scrumbles up the world state.
	// 	var oldLevel = curlevel;
	// 	var oldState = backupLevel();
	// 	var oldTesting = unitTesting;
	// 	var oldAuto = testsAutoAdvanceLevel;
	// 	if(lev != curlevel) {
	// 		compile(["loadLevel",lev]);
	// 	}
	// 	_ao1 = new BitVec(STRIDE_OBJ);
	// 	zero = new BitVec(STRIDE_OBJ);
	// 	zero.setZero();
	// 	var result = hint.match(steps);
	// 	if(lev != oldLevel) {
	// 		compile(["loadLevel",oldLevel]);
	// 	}
	// 	restoreLevel(oldState);
	// 	unitTesting = oldTesting;
	// 	testsAutoAdvanceLevel = oldAuto;
	// 	return result;
	// }

	function clearRuleCountDisplay() {
		editor.clearGutter(analyzerRuleCountGutter);
	}
	
	var lineCounts = {};
	function updateRuleCountDisplay() {
		clearRuleCountDisplay();
		var rules = state.rules ? state.rules.concat(state.lateRules) : [];
		lineCounts = {};
		for(var groupi = 0; groupi < rules.length; groupi++) {
			for(var ri = 0; ri < rules[groupi].length; ri++) {
				var line = rules[groupi][ri].lineNumber-1;
				if(!lineCounts[line]) {
					lineCounts[line] = 0;
				}
				lineCounts[line] += getRuleCounts(groupi,ri);
			}
		}
		for(var l in lineCounts) {
			var marker = document.createElement("div");
			marker.innerHTML = ""+lineCounts[l];
			editor.setGutterMarker(parseInt(l), analyzerRuleCountGutter, marker);
		}
	}
		
	function ruleApplied(normalOrLate,ruleGroup,ruleIndex,direction,tuple) {
		if(module.mode != module.MODE_NORMAL) { return; }
		var rule = (normalOrLate == "normal" ? state.rules[ruleGroup][ruleIndex] : state.lateRules[ruleGroup][ruleIndex]);
		Utilities.incrementRuleCount(storedRuleCounts,curlevel,RC_CATEGORY_INTERACTIVE,ruleGroup,ruleIndex);
		if(getRuleCountMode() == RC_MODE_INTERACTIVE) {
			var l = rule.lineNumber-1;
			if(!lineCounts[l]) {
				lineCounts[l] = 1;
				var marker = document.createElement("div");
				marker.innerHTML = "1";
				editor.setGutterMarker(l, analyzerRuleCountGutter, marker);
			} else {
				lineCounts[l]++;
				var existingMarkers = editor.lineInfo(l).gutterMarkers;
				if(existingMarkers && existingMarkers[analyzerRuleCountGutter]) {
					existingMarkers[analyzerRuleCountGutter].innerHTML = ""+lineCounts[l];
				}
			}
		}
	}
	
	function getRuleCounts(ruleGroup,ruleIndex) {
		var count = 0;
		switch(getRuleCountMode()) {
			case RC_MODE_ALL_LEVELS_WIN:
				for(var l = 0; l < state.levels.length; l++) {
					count += Utilities.getEntry(storedRuleCounts,l,RC_CATEGORY_WIN,ruleGroup,ruleIndex);
				}
				return count;
			case RC_MODE_THIS_LEVEL_WIN:
				count += Utilities.getEntry(storedRuleCounts,curlevel,RC_CATEGORY_WIN,ruleGroup,ruleIndex);
				return count;
			case RC_MODE_INTERACTIVE:
				for(var l = 0; l < state.levels.length; l++) {
					count += Utilities.getEntry(storedRuleCounts,l,RC_CATEGORY_INTERACTIVE,ruleGroup,ruleIndex);
				}
				return count;
		}
	}
	
	module.onEditorGutterClick = function onEditorGutterClick(cm, n) {
		clearRuleCountDisplay();
		var mode = switchToNextRuleCountMode();
		updateRuleCountDisplay();
		consolePrint("The right-hand gutter is now showing counts of rules triggered by "+
		 (mode == RC_MODE_INTERACTIVE ? "interactive play" :
		  (mode == RC_MODE_THIS_LEVEL_WIN ? "the winning moves of the current level" : 
		  (mode == RC_MODE_ALL_LEVELS_WIN ? "the winning moves of all levels" : "<<undef>>")))+".");
	};
	
	function clearLineHighlights() {
		//console.log("Clear line highlights "+JSON.stringify(lineHighlights));
		for(var l in lineHighlights) {
			editor.removeLineClass(parseInt(l), "background", lineHighlights[l]);
		}
		lineHighlights = {};
	}
	
	function updateLevelHighlights() {
		clearLineHighlights();
		for(var i=0; i < state.levels.length; i++) {
			if(state.levels[i].lineNumber && seenSolutions[i]) {
				var upTo = nextEmptyLine(state.levels[i].lineNumber);
				var solClass = seenSolutions[i].solved ? solvedClass :
					(seenSolutions[i].exhaustive ? unsolvableClass : unsolvedClass);
				//console.log("highlight "+state.levels[i].lineNumber+".."+upTo+" with "+solClass);
				for(var l = state.levels[i].lineNumber-1; l < upTo; l++) {
					editor.removeLineClass(l, "background", solvedClass);
					editor.removeLineClass(l, "background", unsolvedClass);
					editor.removeLineClass(l, "background", unsolvableClass);
					editor.addLineClass(l, "background", solClass);
					lineHighlights[l] = solClass;
				}
				//now, highlight specs:
				//if a spec matches the solution, highlight it green
				//otherwise, highlight it red
				if(seenSolutions[i].solved) {
					var specs = parsedLevelSpecs[i];
					for(var j = 0; j < seenSolutions[i].matchedSpecs.length; j++) {
						l = specs.ranges[j];
						if(!l) { continue; }
						var specClass = seenSolutions[i].matchedSpecs[j] ? specMetClass : specUnmetClass;
						for(var li = l[0].line; li <= l[1].line; li++) {
							editor.removeLineClass(li, "background", specMetClass);
							editor.removeLineClass(li, "background", specUnmetClass);
							editor.addLineClass(li, "background", specClass);
							lineHighlights[li] = specClass;
						}
					}
					var bounds = solutionBounds(i);
					var short = shortest(seenSolutions[i].steps);
					for(j = 0; j < bounds.lowBounds.length; j++) {
						var b = bounds.lowBounds[j];
						var v = b.bound;
						l = b.line;
						if(short.length < v) {
							console.log(""+l+" lower than "+v);
							editor.addLineClass(l, "background", lineSolutionTooShortClass);
							lineHighlights[l] = lineSolutionTooShortClass;
						}
					}
					for(j = 0; j < bounds.highBounds.length; j++) {
						var b = bounds.highBounds[j];
						var v = b.bound;
						l = b.line;
						if(short.length > v) {
							console.log(""+l+" longer than "+v);
							editor.addLineClass(l, "background", lineSolutionTooLongClass);
							lineHighlights[l] = lineSolutionTooLongClass;
						}
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
		//TODO: permit "clearing" default specs.
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
		
	var parsedLevelSpecs = {};
	var specStartRE = /\(\s*@SPEC:/i;
	function parseSpecs() {
		for(var lev = 0; lev < state.levels.length; lev++) {
			if(state.levels[lev].message) { continue; }
			var l0 = state.levels[lev].lineNumber+1;
			var l1 = nextLevelLine(lev);
			var specs = [];
			var ranges = [];
			var strings = [];
			//find a (@SPEC starting at or after l1 but before l2
			//find the ) after that @SPEC
			//then parse it
			var str = editor.getRange({line:l0},{line:l1});
			var str0;
			var specStartMatch;
			var idx = editor.indexFromPos({line:l0});
			while(specStartMatch = str.match(specStartRE)) {
				idx += specStartMatch.index+specStartMatch[0].length;
				var range = [editor.posFromIndex(idx), null];
				str = str.substring(specStartMatch.index+specStartMatch[0].length).trim();
				str0 = str;
				var result = SpecCompiler.parseSpec(str,range[0]);
				idx += str.length - result.stream.string.length + 1; //drop the ) too
				str = result.stream.string.substring(1);
				range[1] = editor.posFromIndex(idx);
				specs.push(result.parse);
				ranges.push(range);
				strings.push(str0.substring(0,(str0.length-str.length)-1));
				str0 = str;
			}
			parsedLevelSpecs[lev] = {specs:specs, strings:strings, ranges:ranges};
		}
		return parsedLevelSpecs;
	}
	
	function annotationsBetween(l1, l2) {
		var annos = [];
		for(var l = l1; l < l2; l++) {
			var line = editor.getLine(l).trim();
			var match = /\(\s*@(.*)\s*:\s*(.*)\s*\)/i.exec(line);
			if(match) {
				annos.push({
					type:match[1].trim().toUpperCase(), 
					content:match[2].trim(), 
					line:l
				});
			}
		}
		return annos;
	}
	
	function solutionBounds(lev) {
		var annotations = annotationsBetween(
			state.levels[lev].lineNumber+1, 
			nextLevelLine(lev)
		);
		var low = 0;
		var high = Infinity;
		var lowBounds = [];
		var highBounds = [];
		var bval;
		for(var i = 0; i < annotations.length; i++) {
			if(annotations[i].type == "MOST") {
				bval = parseInt(annotations[i].content);
				high = Math.min(high,bval);
				highBounds.push({line:annotations[i].line, bound:bval});
			} else if(annotations[i].type == "LEAST") {
				bval = parseInt(annotations[i].content);
				low = Math.max(low,bval);
				lowBounds.push({line:annotations[i].line, bound:bval});
			}
		}
		return {low:low, high:high, lowBounds:lowBounds, highBounds:highBounds};
	}
	
	function levelSpec(lev) {
		var userSpecs = parsedLevelSpecs[lev];
		var solPrefixes = AUTO_HINT && seenSolutions[lev] && seenSolutions[lev].prefixes && seenSolutions[lev].prefixes.length ? seenSolutions[lev].prefixes : [];
		return userSpecs.specs.concat(solPrefixes.map(function(pref) {
			return prefixToSolutionSteps(pref).join(" , ");
		}));
	}
	
	function tickLevelQueue(wkr) {
		if(!levelQueue.length) { return; }
		var lev = levelQueue.shift();
		var level = state.levels[lev];
		var spec = levelSpec(lev);
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
				spec:spec,
				verbose:true
			}, handleSolver, tickLevelQueue);
		} else {
			workers[lev] = {init: { rules:gameRules, level:lev, mode:"fast", spec:spec, verbose:true }};
			Solver.RANDOM_RESTART = Analyzer.RANDOM_RESTART;
			Solver.startSearch({
				rules:gameRules,
				level:lev,
				mode:"fast",//"fast_then_best",
				spec:spec,
				//seed:randomseed,
				verbose:true,
				replyFn:function(type,msg) {
					//console.log("MSG:"+type+":"+JSON.stringify(msg));
					switch(type) {
						case "busy":
							console.log("Busy:"+msg.response.continuation);
							Solver.continueSearch(msg.response.continuation);
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
	
	function runMemoryTest(wkr) {
		var lev = curlevel;
		var level = state.levels[lev];
		var spec = levelSpec(lev);
		if(USE_WORKERS) {
			startWorker("memorytest", lev, {
				rules:gameRules,
				level:lev
			}, handleMemoryTest);
		} else {
			MemoryTest.startTest({
				rules:gameRules,
				level:lev,
				replyFn:function(type,msg) {
					console.log("MSG:"+type+":"+JSON.stringify(msg));
					handleMemoryTest(lev,type,msg);
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
	
	function shortest(l) {
		var least = null;
		for(var i = 0; i < l.length; i++) {
			if(!least || l[i].length < least.length) {
				least = l[i];
			}
		}
		return least;
	}
	
	function handleSolver(id,type,data) {
		switch(type) {
			case "solution":
				consolePrint("<span class='line-level-solvable'>Level "+data.level+": Found solution #"+1+" (n"+data.solution.id+") of first-found cost "+data.solution.prefixes[0].length+" at iteration "+data.solution.iteration+" ("+data.time+" seconds):<br/>&nbsp;"+data.solution.prefixes.map(function(p) { return prefixToSolutionSteps(p).join(" "); }).join("<br/>&nbsp;")+"</span>");
				if(data.iteration == 0) {
					consolePrint("&nbsp;(Thanks to hint from last time)");
				}
				recordSolution(workers[id].init.rules, workers[id].init.levelText, data);
				consoleCacheDump();
				// TODO: I just got a solution. was it the first solution? if so, do not continue this solver until other guys get a chance to run.
				//	   do fancy stuff with specs, warnings, etc
				// otherwise: compare the new solution to the old best solution. let it continue normally right away.
				//	   do the same fancy stuff with specs, warnings, etc
				break;
			case "exhausted":
				consolePrint("Level "+data.level+": Did not find more solutions after "+data.response.iterations+" iterations ("+data.time+" seconds)");
				if(!seenSolutions[data.level] || seenSolutions[data.level].stale) {
					recordFailure(workers[id].init.rules, workers[id].init.levelText, data);
					if(!data.response.fullyExhausted && RANDOM_RESTART) {
						levelQueue.push(data.level);
						consolePrint("Level "+data.level+" is taking some time to solve.");
					} else {
						consolePrint("<span class='line-level-unsolvable'>Level "+data.level+" is not solvable!</span>");
					}
				}
				analyzeSolutions(data.level);
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
	
	function analyzeSolutions(level) {
		if(seenSolutions[level].solved) {
			var bounds = solutionBounds(level);
			var short = shortest(seenSolutions[level].steps);
			if(short.length < bounds.low) {
				consolePrint(
					"<span class='line-solution-too-short'>Level "+level+": Shortest solution<br/>"+
					"&nbsp;"+short.join(" ")+"<br/>"+
					"&nbsp;is shorter than designer-supplied minimum length "+bounds.low+
					"</span>"
				);
			}
			if(short.length > bounds.high) {
				consolePrint(
					"<span class='line-solution-too-long'>Level "+level+": Shortest solution<br/>"+
					"&nbsp;"+short.join(" ")+"<br/>"+
					"&nbsp;is longer than designer-supplied maximum length "+bounds.high+
					"</span>"
				);
			}
		}
		if(lastSeenSolutions[level]) {
			var oldSolutions = lastSeenSolutions[level].prefixes;
			var newSolutions = seenSolutions[level].prefixes;
			if(lastSeenSolutions[level].solved && seenSolutions[level].solved) {
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
							'<span class="line-solution-got-longer">Level '+level+': Solution got longer in new version:<br/>'+
							'&nbsp;'+prefixToSolutionSteps(oldSoln).join(" ")+'<br/>'+
							'&nbsp;--&gt;<br/>'+
							'&nbsp;'+prefixToSolutionSteps(newSoln).join(" ")+
							'</span>'
						);
						brandNewSolutions.splice(brandNewSolutions.indexOf(newSoln),1);
					} else if((newSoln = hasAnyPrefix(oldSoln, newSolutions))) {
						consolePrint(
							'<span class="line-solution-got-shorter">Level '+level+': Solution got shorter in new version:<br/>'+
							'&nbsp;'+prefixToSolutionSteps(oldSoln).join(" ")+'<br/>'+
							'&nbsp;--&gt;<br/>'+
							'&nbsp;'+prefixToSolutionSteps(newSoln).join(" ")+
							'</span>'
						);
						brandNewSolutions.splice(brandNewSolutions.indexOf(newSoln),1);
					} else {
						consolePrint(
							'<span class="line-solution-disappeared">Level '+level+': Solution no longer used in new version:<br/>'+
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
						'<span class="line-solution-appeared">Level '+level+': New solution appeared in new version:<br/>'+
						'&nbsp;XXXX'+
						'&nbsp;--&gt;<br/>'+
						'&nbsp;'+prefixToSolutionSteps(newSoln).join(" ")+'<br/>'+
						'</span>'
					);
				}

			} else if(lastSeenSolutions[level].solved) {
				//level used to be solvable but now is not
				consolePrint(
					'<span class="line-level-unsolvable">Level '+level+' used to be solvable by:<br/>'+
					'&nbsp;'+oldSolutions.map(prefixToSolutionSteps).join("<br/>&nbsp;")+'<br/>'+
					'</span>'
				);
			} else if(seenSolutions[level].solved) {
				consolePrint(
					'<span class="line-level-solvable">Level '+level+' is now solvable by:<br/>'+
					'&nbsp;'+newSolutions.map(prefixToSolutionSteps).join("<br/>&nbsp;")+'<br/>'+
					'</span>'
				);
			}
		}
	}

	function handleMemoryTest(id,type,data) {
		consolePrint("MemTest:"+type+":"+JSON.stringify(data));
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
				matchedSpecs:[],
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
		var levelSpecs = levelSpec(level);
		//for each prefix, there is a matchedSpecs array in soln.matchedSpecsByPrefix
		for(var p = 0; p < soln.matchedSpecsByPrefix.length; p++) {
			var matchedSpecs = soln.matchedSpecsByPrefix[p];
			for(var s = 0; s < matchedSpecs.length; s++) {
				if(!matchedSpecs[s]) {
					seenSolutions[level].matchedSpecs[s] = false;
					if(s < parsedLevelSpecs[level].specs.length) {
						logWarning(
							"Solution prefix "+prefixToSolutionSteps(soln.prefixes[p]).join("\n")+"\n does not match spec ("+parsedLevelSpecs[level].strings[s]+")",
							parsedLevelSpecs[level].ranges[s][0].line+1,
							true
						);
					} else {
						//auto-spec. They're notified separately.
					}
				} else {
					seenSolutions[level].matchedSpecs[s] = true;
				}
			}
		}
		storedRuleCounts[data.level][RC_CATEGORY_WIN] = soln.ruleCounts[0];
		updateLevelHighlights();
		updateRuleCountDisplay();
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
			prefixes:RANDOM_RESTART ? data.response.kickstart : [],
			matchedSpecs:levelSpec(level).map(function(_) { return false; }),
			steps:[],
			iteration:data.response.iterations,
			exhaustive:data.response.fullyExhausted,
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
	
	function killAllWorkers(type /* : optional */) {
		if(type) {
			var ws = getAllWorkers(type);
			for(var i = 0; i < ws.length; i++) {
				killWorker(type, ws[i].key);
			}
		} else {
			for(var t in workerLookup) {
				killAllWorkers(t);
			}
		}
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
						continuation:data.response.continuation
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