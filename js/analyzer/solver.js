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

	var ITERS_PER_CONTINUATION = 200;
	var ITER_MAX = 1000;

	var VERBOSE = false;
	var REPLY_FN = reply;
	var LEVEL = 0, RULES = "", SEED = null;
	var OLD_TESTING, OLD_AUTO_ADVANCE;

	var INIT_LEVEL;

	var ACTIONS;

	var nodeId=0;
	var open, closed, q;
	var root;

	module.startSearch = function(config) {
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
		INIT_LEVEL = backupLevel();

		if (!state.levels[LEVEL] || state.levels[LEVEL].message) {
			REPLY_FN("exhausted", {level:LEVEL, iterations:0});
			return;
		}

		ACTIONS = [UP, DOWN, LEFT, RIGHT];
		if(autotickinterval > 0) {
			ACTIONS.push(WAIT);
		}
		if(!('noaction' in state.metadata)) {
			ACTIONS.push(ACTION);
		}

		open = [];//{};
		closed = [];//{};
		q = new priority_queue.PriorityQueue(function(a,b) { return a.f-b.f; });
		root = createOrFindNode(null,WAIT);
		enqueueNode(root);

		Solver.continueSearch(0);
	};

	module.continueSearch = function(continuation) {
		testsAutoAdvanceLevel = false;
		unitTesting = true;
		var iters = searchSome(continuation);
		if(iters < ITER_MAX && q.length > 0) {
			REPLY_FN("busy", {continuation:iters, queue_length:q.length});
		} else {
			restartTarget=INIT_LEVEL;
			winning=false;
			restoreLevel(INIT_LEVEL);
			REPLY_FN("exhausted", {level:LEVEL, iterations:iters});
		}
		testsAutoAdvanceLevel = OLD_AUTO_ADVANCE;
		unitTesting = OLD_TESTING;
	};

	function searchSome(continuation) {
		//search a number of iterations, then return true if there is more to come
		//up to X iterations:
		for(var iter=continuation; iter<continuation+ITERS_PER_CONTINUATION && iter<ITER_MAX && q.length > 0; iter++) {
			//dequeue and move from open to closed
			log("Iter "+iter);
			var node = q.shift();
			//log("Dat:"+JSON.stringify(node.backup));
			exactRemove(node,open);
			exactInsert(node,closed);
			//for each action valid in the game:
			for(var ai = 0; ai < ACTIONS.length; ai++) {
				var action = ACTIONS[ai];
				//switch to this state, perform action, createOrFindNode()
				switchToSearchState(node);
				processInput(action);
				var currentNode = createOrFindNode(node,action);
				//log("Found "+currentNode.id+" by "+node.id +":"+action);
				//if this is winning, report a win
				if(winning) {
					log("WIN");
					postSolution(currentNode, iter);
					//for each predecessor up the chain, if it has no eventualSolutions it definitely does now!
					addEventualSolution(currentNode.predecessors,currentNode);
				} else if(currentNode != root &&
					      currentNode.predecessors.length == 1) {
					log("enQ "+currentNode.id);
					enqueueNode(currentNode);
				} else if(currentNode.eventualSolutions.length) {
					log("Eventual win");
					for(var esi in currentNode.eventualSolutions) {
						var es = currentNode.eventualSolutions[esi];
						postSolution(es,iter);
					}
				}
			}
		}
		return iter;
	};

	function addEventualSolution(nodePreds,s) {
		if(nodePreds.length == 0) { return; }
		for(var ni in nodePreds) {
			var n = nodePreds[ni].predecessor;
			if(n == s) { continue; }
			if(n.eventualSolutions.indexOf(s) == -1) {
				n.eventualSolutions.push(s);
				addEventualSolution(n.predecessors,s);
			}
		}
	}

	function prefixes(n) {
		//log("entering "+n.id);
		var visited = {};
		visited[root.id] = [[]];
		var ret = prefixesLoopcheck(n,visited);
		//log("exiting "+n.id+" with "+JSON.stringify(ret));
		return ret;
	}
	function prefixesLoopcheck(n,visited) {
		if(n.id in visited) {
			//log("return "+JSON.stringify(visited[n.id])+" for "+n.id);
			return visited[n.id];
		}
		visited[n.id] = [];
		var ret = [];
		for(var pi in n.predecessors) {
			var p = n.predecessors[pi];
			//log(""+n.id+" Pred:"+p.predecessor.id+" via "+p.action);
			var pprefixes = prefixesLoopcheck(p.predecessor,visited);
			//log(" "+n.id+" Got prefixes:"+JSON.stringify(pprefixes));
			for(var ppi in pprefixes) {
				var pprefix = pprefixes[ppi];
				ret.push(pprefix.concat([p.action]));
			}
		}
		visited[n.id] = ret;
		//log("Returning "+JSON.stringify(ret)+" for "+n.id);
		return ret;
	}

	function postSolution(currentNode, iter) {
		REPLY_FN("solution", {level:LEVEL, solution:{
			id:currentNode.id,
			backup:currentNode.backup,
			g:currentNode.g,
			h:currentNode.h,
			f:currentNode.f,
			prefixes:prefixes(currentNode)
		}, iteration:iter});
	};

	function createOrFindNode(pred, action) {
		var backup = backupLevel();
		var h = calculateH(backup);
		var g = pred ? pred.g+1 : 0;
		var n = {
			id:nodeId,
			backup:backup,
			//optimization(?):
			//objectCounts:new Array(state.objectCount),
			g:g,
			h:h,
			f:g+h,
			predecessors:[],
			//successors:[],
			winning:winning,
			eventualSolutions:[]
		};
		var existingN = member(n,closed) || member(n,open);
		if(existingN) {
			if(pred) {
				//pred.successors[action] = existingN;
				log("B add "+pred.id+":"+action+" to "+existingN.id);
				existingN.predecessors.push({action:action, predecessor:pred});
			}
			/* // Doing this is pointless, since we don't want to re-sort the q.
			if(g < existingN.g) {
				existingN.g = g;
			}
			if(h < existingN.h) {
				existingN.h = h;
			}
			existingN.f = existingN.g + existingN.h;*/
			return existingN;
		}
		nodeId++;
		if(pred) {
			log("A add "+pred.id+":"+action+" to "+n.id);
			n.predecessors.push({action:action, predecessor:pred});
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
