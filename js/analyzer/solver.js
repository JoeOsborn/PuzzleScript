"use strict";

var reply;
var postMessage, compile, justCompile;

var Solver = (function() {
	var module = {};

	var WAIT = -1;
	var UP = 0;
	var LEFT = 1;
	var DOWN = 2;
	var RIGHT = 3;
	var ACTION = 4;

	var ITERS_PER_CONTINUATION = 100;
	var ITER_MAX = 200;

	var VERBOSE = false;
	var REPLY_FN = reply;
	var LEVEL = 0, RULES = "", SEED = null;
	var OLD_TESTING, OLD_AUTO_ADVANCE;

	var INIT_LEVEL;

	var open, closed, q;

	module.startSearch = function(config) {
		INIT_LEVEL = backupLevel();

		OLD_TESTING = unitTesting;
		OLD_AUTO_ADVANCE = testsAutoAdvanceLevel;
		LEVEL = config.level;
		RULES = config.rules;
		SEED = config.seed;
		VERBOSE = config.verbose;
		if(config.replyFn) {
			REPLY_FN = config.replyFn;
		}

		if(justCompile) {
			justCompile(["loadLevel", LEVEL], RULES, SEED);
		} else {
			compile(["loadLevel", LEVEL], RULES, SEED);
		}

		if (!state.levels[LEVEL] || state.levels[LEVEL].message) {
			REPLY_FN("exhausted", {level:LEVEL});
			return;
		}

		open = [];//{};
		closed = [];//{};
		q = new priority_queue.PriorityQueue(function(a,b) { return a.f-b.f; });
		enqueueNode(createOrFindNode([]));

		Solver.continueSearch(0);
	};

	module.continueSearch = function(continuation) {
		testsAutoAdvanceLevel = false;
		unitTesting = true;
		if(searchSome(continuation)) {
			REPLY_FN("busy", {continuation:continuation+1});
		} else {
			restartTarget=INIT_LEVEL;
			winning=false;
			restoreLevel(INIT_LEVEL);
			REPLY_FN("exhausted", {level:LEVEL});
		}
		testsAutoAdvanceLevel = OLD_AUTO_ADVANCE;
		unitTesting = OLD_TESTING;
	};

	function searchSome(continuation) {
		//search a number of iterations, then return true if there is more to come
		var actions = [UP, DOWN, LEFT, RIGHT];
		if(autotickinterval > 0) {
			actions.push(WAIT);
		}
		if(!('noaction' in state.metadata)) {
			actions.push(ACTION);
		}
		//up to X iterations:
		for(var iter=0; iter<ITERS_PER_CONTINUATION; iter++) {
			//dequeue and move from open to closed
			//log("Iter "+iter);
			var node = q.shift();
			//log("Dat:"+JSON.stringify(node.backup));
			exactRemove(node,open);
			exactInsert(node,closed);
			//for each action valid in the game:
			for(var ai in actions) {
				var action = actions[ai];
				//switch to this state, perform action, createOrFindNode()
				switchToSearchState(node);
				processInput(action);
				var currentNode = createOrFindNode(node.prefixes[0].concat([action]));
				//if this is winning, report a win
				if(winning) {
					//log("WIN");
					postSolution(currentNode, iter);
				} else if(currentNode.prefixes.length == 1) {
					//log("enQ"+(closed.length+open.length));
					enqueueNode(currentNode);
				} else if(currentNode.eventualSolution) {
					postSolution(currentNode.eventualSolution, iter);
				}
				//TODO: if this is another path to a node that gets to a solution, report that too!
			}
		}
		return (continuation*ITERS_PER_CONTINUATION >= ITER_MAX);
	};

	function postSolution(currentNode, iter) {
		REPLY_FN("solution", {level:LEVEL, solution:{
			backup:currentNode.backup,
			g:currentNode.g,
			h:currentNode.h,
			f:currentNode.f,
			prefixes:currentNode.prefixes
		}, iteration:iter});
	};

	function createOrFindNode(pre) {
		var h = calculateH();
		var g = pre.length;
		var n = {
			backup:backupLevel(),
			//optimization(?):
			//objectCounts:new Array(state.objectCount),
			g:g,
			h:h,
			f:g+h,
			prefixes:[pre],
			winning:winning
		};
		var existingN = member(n,closed) || member(n,open);
		if(existingN) {
			//log("Extend prefixes "+JSON.stringify(existingN.prefixes)+"+"+JSON.stringify(pre));
			existingN.prefixes.push(pre);
			return existingN;
		}
		return n;
	}

	function enqueueNode(n) {
		exactInsert(n,open);
		q.push(n);
	}

	function calculateH() {
		return 0;
	}

	function getInnerSet(node,set) {
		var innerSet = set;
		//optimization(?):
		/*for(var i = 0; i < node.objectCounts.length; i++) {
			if(!innerSet[node.objectCounts[i]]) {
				innerSet[node.objectCounts[i]] = (i == node.objectCounts.length - 1) ? [] : {};
			}
		}*/
		return innerSet;
	}

	function equiv(n1,n2) {
		if(n1.winning != n2.winning) { return false; }
		var n1BakObjs = n1.backup.dat;
		var n2BakObjs = n2.backup.dat;
		if(n1BakObjs.length != n2BakObjs.length) { return false; }
		for(var i=0; i < n1BakObjs.length; i++) {
			if(n1BakObjs[i] != n2BakObjs[i]) { return false; }
		}
		return true;
	}

	function memberIndexInner(node,innerSet) {
		for(var i = 0; i < innerSet.length; i++) {
			if(equiv(node,innerSet[i])) {
				return i;
			}
		}
		return -1;
	}

	function member(node, set) {
		var innerSet = getInnerSet(node,set);
		var idx = memberIndexInner(node,innerSet);
		if(idx != -1) {
			return innerSet[idx];
		}
		return null;
	}

	function insert(node, set) {
		var innerSet = getInnerSet(node,set);
		var idx = memberIndexInner(node,innerSet);
		if(idx == -1) {
			innerSet.push(node);
		}
	}

	function remove(node, set) {
		var innerSet = getInnerSet(node,set);
		var idx = memberIndexInner(node,innerSet);
		if(idx != -1) {
			innerSet.splice(idx,1);
		}
	}

	function exactInsert(node, set) {
		var innerSet = getInnerSet(node,set);
		if(innerSet.indexOf(node) == -1) {
			innerSet.push(node);
		}
	}

	function exactRemove(node, set) {
		var innerSet = getInnerSet(node,set);
		var idx = innerSet.indexOf(node);
		if(idx != -1) {
			innerSet.splice(idx,1);
		}
	}

	function switchToSearchState(searchState) {
		winning = false;
		RandomGen = new RNG(searchState.RNG);
		titleScreen=false;
		titleSelected=false;
		againing=false;
		titleMode=0;
		textMode=false;
		restoreLevel(searchState.backup);
		backups=[];
		restartTarget=searchState.backup;
	};

	return module;
})();
