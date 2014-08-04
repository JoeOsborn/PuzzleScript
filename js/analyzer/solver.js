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

	var ITERS_PER_CONTINUATION = 400;
	var ITER_MAX = 40000;

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

		open = initSet();
		closed = initSet();
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
			REPLY_FN("busy", {
				continuation:iters,
				queueLength:q.length,
				minG:(q.peek() ? q.peek().g : -1),
				minH:(q.peek() ? q.peek().h : -1)
			});
		} else {
			restartTarget=INIT_LEVEL;
			winning=false;
			restoreLevel(INIT_LEVEL);
			REPLY_FN("exhausted", {
				level:LEVEL,
				iterations:iters,
				queueLength:q.length,
				minG:(q.peek() ? q.peek().g : -1),
				minH:(q.peek() ? q.peek().h : -1)
			});
		}
		testsAutoAdvanceLevel = OLD_AUTO_ADVANCE;
		unitTesting = OLD_TESTING;
	};

	function searchSome(continuation) {
		//search a number of iterations, then return true if there is more to come
		//up to X iterations:
		for(var iter=continuation; iter<continuation+ITERS_PER_CONTINUATION && iter<ITER_MAX && q.length > 0; iter++) {
			//dequeue and move from open to closed
			//log("Iter "+iter);
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
					//log("WIN");
					postSolution(currentNode, iter);
					//for each predecessor up the chain, if it has no eventualSolutions it definitely does now!
					addEventualSolution(currentNode.predecessors,currentNode);
				} else if(currentNode != root &&
					      currentNode.predecessors.length == 1) {
					//log("enQ "+currentNode.id);
					enqueueNode(currentNode);
				} else if(currentNode.eventualSolutions.length) {
					//log("Eventual win");
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

	var arCounts;
	function findCentroids() {
		var arSums = new Int32Array(state.objectCount);
		if(!arCounts || arSums.length != arCounts.length) {
			arCounts = new Int32Array(state.objectCount);
		}
		for(i = 0; i < arSums.length; i++) {
			arSums[i] = 0;
			arCounts[i] = 0;
		}
		for(var i = 0; i < level.n_tiles; i++) {
			var bitmask = level.getCellInto(i,_oA);
			for(var bit = 0; bit < 32 * STRIDE_OBJ; ++bit) {
				if(bitmask.get(bit)) {
					arCounts[bit]++;
					arSums[bit] += i;
				}
			}
		}
		for(i = 0; i < arSums.length; i++) {
			arSums[i] /= arCounts[i];
		}
		return arSums;
	}

	function createOrFindNode(pred, action) {
		var backup = backupLevel();
		var n = {
			id:nodeId,
			backup:backup,
			predecessors:[],
			//successors:[],
			winning:winning,
			eventualSolutions:[],
			//indexing optimization:
			objectCentroids:findCentroids()
		};
		var existingN = member(n,closed) || member(n,open);
		if(existingN) {
			if(pred) {
				//pred.successors[action] = existingN;
				//log("B add "+pred.id+":"+action+" to "+existingN.id);
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
		var h = calculateH();
		if(h == null) { throw Error("Null heuristic value because I am a dummy"); }
		var g = pred ? pred.g+1 : 0;
		n.g = g;
		n.h = h;
		n.f = g+h;
		nodeId++;
		if(pred) {
			//log("A add "+pred.id+":"+action+" to "+n.id);
			n.predecessors.push({action:action, predecessor:pred});
		}
		return n;
	}

	function enqueueNode(n) {
		exactInsert(n,open);
		q.push(n);
	}

	var _oA = new BitVec(STRIDE_OBJ);
	var _oB = new BitVec(STRIDE_OBJ);
	/*function calculateAdmissibleH() {
		var h = 0;
		if (state.winconditions.length>0)  {
			for (var wcIndex=0;wcIndex<state.winconditions.length;wcIndex++) {
				var wincondition = state.winconditions[wcIndex];
				var filter1 = wincondition[1]; //"X"; if univ, will always pass
				var filter2 = wincondition[2]; //"Y"; if empty, will always pass
				switch(wincondition[0]) {
					case -1://NO
						{
							for (var i=0;i<level.n_tiles;i++) {
								var cell = level.getCellInto(i,_oA);
								if ( (!filter1.bitsClearInArray(cell.data)) &&
										(!filter2.bitsClearInArray(cell.data)) ) {
									h++;
								}
							}
							break;
						}
					case 0://SOME
						{
							var passedTest=false;
							for (var i=0;i<level.n_tiles;i++) {
								var cell = level.getCellInto(i,_oA);
								if ( (!filter1.bitsClearInArray(cell.data)) &&
										(!filter2.bitsClearInArray(cell.data)) ) {
									passedTest=true;
									break;
								}
							}
							if (passedTest===false) {
								h=1;
							}
							break;
						}
					case 1://ALL
						{
							for (var i=0;i<level.n_tiles;i++) {
								var cell = level.getCellInto(i,_oA);
								if ( (!filter1.bitsClearInArray(cell.data)) &&
										(filter2.bitsClearInArray(cell.data)) ) {
									h++;
								}
							}
							break;
						}
				}
			}
		}
		//if(any [...] -> WIN rule) {
		//  h = min(h, rh);
		//}
		return h;
	}*/
	var max = Math.max;
	var min = Math.min;
	var floor = Math.floor;
	var abs = Math.abs;

	function calculateH() {
		var h = 0;
		if (state.winconditions.length>0)  {
			for (var wcIndex=0;wcIndex<state.winconditions.length;wcIndex++) {
				var wincondition = state.winconditions[wcIndex];
				var filter1 = wincondition[1]; //"X"; if univ, will always pass
				var filter2 = wincondition[2]; //"Y"; if empty, will always pass
				switch(wincondition[0]) {
					case -1://NO
						{
							//1 for each x on a y
							for (var i=0;i<level.n_tiles;i++) {
								var cell = level.getCellInto(i,_oA);
								if ((!filter1.bitsClearInArray(cell.data)) &&
										(!filter2.bitsClearInArray(cell.data)) ) {
									h++;
								}
							}
							break;
						}
					case 0://SOME
						{
							//min distance between any X and its nearest Y
							var minDist = Infinity;
							var anyYs = false;
							for (var i=0;i<level.n_tiles;i++) {
								var cell = level.getCellInto(i,_oA);
								if ( (!filter1.bitsClearInArray(cell.data)) ) {
									var nearest = findNearest(filter2,i);
									//no Y!
									//it's not clear what a reasonable value would be.
									//we'll be optimistic in order to try and stay admissible,
									//and hope that the next turn will produce a Y.
									//Put another way, we have "an unsatisfied X".
									if(nearest == -1) {
										log("NO Y");
										minDist = min(minDist,1);
									}
									minDist = min(minDist, distance(nearest,i));
									//already an X on a Y! Just use 0.
									if(minDist == 0) { break; }
								}
							}
							h += minDist;
							break;
						}
					case 1://ALL
						{
							//sum of distances between all xs and their nearest ys
							for (var i=0;i<level.n_tiles;i++) {
								var cell = level.getCellInto(i,_oA);
								//an X on a non-Y. where is the nearest Y?
								if ((!filter1.bitsClearInArray(cell.data)) &&
										(filter2.bitsClearInArray(cell.data))) {
									var nearest = findNearest(filter2,i);
									if(nearest != -1) {
										//there's a y somewhere.
										//note that this will map multiple xs onto a single y.
										//this difference could be normalized, but then it would
										//be in different units from g, which are "turns".
										h += distance(nearest, i);
									} else {
										//there's no y!
										//it's not clear what a reasonable value would be.
										//we'll be optimistic in order to try and stay admissible,
										//and hope that the next turn will produce a Y.
										//Put another way, we have "an unsatisfied X".
										h += 1;
									}
								}
							}
							break;
						}
				}
			}
		}
		return h;
	}
	function distance(i,j) {
		var ix = floor(i / level.height);
		var iy = i - ix*level.height;
		var jx = floor(j / level.height);
		var jy = j - jx*level.height;
		return abs(ix-jx) + abs(iy-jy);
	}
	function check(filt, i) {
		var cell = level.getCellInto(i,_oB);
		return !filt.bitsClearInArray(cell.data);
	}
	function findNearest(filt, i) {
		var maxD = level.width+level.height;
		var cx = floor(i / level.height);
		var cy = i - cx*level.height;
		var j;
		for(var d=0; d < maxD; d++) {
			for(var row=0; row < d+1; row++) {
				var lx = cx - d + row;
				var hx = cx + d - row;
				var ly = cy - row;
				var hy = cy + row;
				if(lx >= 0 && ly >= 0) {
					j = ly+lx*level.height;
					if(check(filt,j)) {
						return j;
					}
				}
				if(lx >= 0 && hy < level.height) {
					j = hy+lx*level.height;
					if(check(filt,j)) {
						return j;
					}
				}
				if(hx < level.width && ly >= 0) {
					j = ly+hx*level.height;
					if(check(filt,j)) {
						return j;
					}
				}
				if(hx < level.width && hy < level.height) {
					j = hy+hx*level.height;
					if(check(filt,j)) {
						return j;
					}
				}
			}
/*			if(!anyOK) {
				log("D "+d+" too far from "+i+" at row "+row+": XY "+(i-floor(i/level.width))+","+(floor(i/level.width)));
				log("W:"+level.width+" H:"+level.height);
				return -1;
			}*/
		}
		log("Just didn't find anything within "+maxD);
		return -1;
	}

	function initSet() {
		return {};
	}
	
	function getInnerSet(node,set) {
		var innerSet = set;
		var ocs = node.objectCentroids;
		for(var i = 0; i < ocs.length; i++) {
			if(!innerSet[ocs[i]]) {
				innerSet[ocs[i]] = (i == ocs.length - 1) ? [] : {};
			}
			innerSet = innerSet[ocs[i]];
		}
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
