var SolverFreeMove = (function() {
	var scope = self || this || {};

	var module = {};

	var WAIT = -1;
	var UP = 0;
	var LEFT = 1;
	var DOWN = 2;
	var RIGHT = 3;
	var ACTION = 4;

	var ITERS_PER_CONTINUATION = 100000;
	var ITER_MAX = 100000;
	
	var ACTIONS;	

	var FIRST_SOLUTION_ONLY = true;
	//TODO: Let designer give annotations for "shortish", "mediumish", and "longish" games/levels
	//Longer -> lower value for gDiscount
	//For shortish games, maybe even set hDiscount=0
	var hDiscount = 1.0;
	var gDiscount = 1.0;
	var gLimit = Infinity;

	var pauseAfterNextSolution = false;
	var sentSolution = false;
	var bestSolution;

	var nodeId=0;
	var open, closed, q;
	var root;
	var MODE = "fast";

	module.startSearch = function(config) {
		if(!_oA) { _oA = new BitVec(STRIDE_OBJ); }
		if(!_oB) { _oB = new BitVec(STRIDE_OBJ); }
		nodeId=0;
		if(Solver.MODE == "fast") {
			FIRST_SOLUTION_ONLY = true;
			gDiscount = 1.0;
			hDiscount = 1.0;
		} else if(Solver.MODE == "fast_then_best") {
			FIRST_SOLUTION_ONLY = false;
			pauseAfterNextSolution = true;
			gDiscount = 1.0;
			hDiscount = 1.0;
		}
		
		if (!state.levels[Solver.LEVEL] || state.levels[Solver.LEVEL].message) {
			return {iterations:0, queueLength:0, nodeCount:0, minG:-1, minH:-1, fullyExhausted:true};
		}

		ACTIONS = [UP, DOWN, LEFT, RIGHT];
		if(!('noaction' in state.metadata)) {
			ACTIONS.push(ACTION);
		}
		if(autotickinterval > 0) {
			ACTIONS.push(WAIT);
		}

		open = initSet();
		closed = initSet();
		q = new priority_queue.PriorityQueue(function(a,b) { return a.f-b.f; });
				
		var initHDiscount = hDiscount;
		var initGDiscount = gDiscount;
		hDiscount = 0;
		gDiscount = 0;
		root = createOrFindNode(null,WAIT);
		enqueueNode(root);
		hDiscount = initHDiscount;
		gDiscount = initGDiscount;
				
		//log("lvl"+LEVEL+": config.hint="+JSON.stringify(config.hint));
		
		if(config.hint && config.hint.prefixes && config.hint.prefixes.length) {
			hDiscount = 0;
			gDiscount = 0;
			var hint = config.hint;
			for(var hi=0; hi < hint.prefixes.length; hi++) {
				var node = root;
				var newNodes = new Array(ACTIONS.length);
				for(var ai=0; ai < hint.prefixes[hi].length; ai++) {
					if(q.length==0) {
						log("Got a win earlier than expected");
						break;
					}
					//log("expanding "+node.id+" due to hint");
					q.removeItem(node);
					remove(node,open);
					insert(node,closed);
					expand(0,node,newNodes);
					//of the last set of new nodes, find the one whose predecessor-action pair is the previous node and the current action
					for(var ni=0; ni < newNodes.length; ni++) {
						if(!newNodes[ni]) { continue; }
						if(hasPredecessor(newNodes[ni],node,hint.prefixes[hi][ai])) {
							node = newNodes[ni];
							//log("picked up thread with new node "+ni+"="+(newNodes[ni] ? newNodes[ni].id : "null"));
							break;
						}
					}
				}
			}
			if(q.length != 0) {
				Solver.REPLY_FN("hintInsufficient", {
					level:Solver.LEVEL,
					hint:config.hint,
					queueLength:q.length,
					nodeCount:nodeId,
					minG:(q.peek() ? q.peek().g : -1),
					minH:(q.peek() ? q.peek().h : -1),
					time:Solver.timeSinceStart()
				});
			}
			hDiscount = initHDiscount;
			gDiscount = initGDiscount;
		}
		return {continuation:0};
	};
	
	function hasPredecessor(node,pred,predAction) {
		for(var pi = 0; pi < node.predecessors.length; pi++) {
			if(equiv(node.predecessors[pi].predecessor,pred) && node.predecessors[pi].action == predAction) {
				return true;
			}
		}
		return false;
	}

	function samplePathsFromQueue(count) {
		//pick up to min(20,q.length) nodes and put their firstPrefixes into a list
		var q2 = q._queue;
		var ret = [q2[0].firstPrefix];
		var firstQuartile = (q2.length / 4) | 0;
		var secondQuartile = (q2.length / 4) | 0;
		var thirdQuartile = (q2.length / 4) | 0;
		for(var i=1; i < q2.length && ret.length < count; i++) {
			var rdm = Math.random();
			if(i <= firstQuartile && rdm < 0.8) {
				ret.push(q2[i].firstPrefix);
			} else if(i <= secondQuartile && rdm < 0.6) {
				ret.push(q2[i].firstPrefix);
			} else if(i <= thirdQuartile && rdm < 0.4) {
				ret.push(q2[i].firstPrefix);
			} else if(rdm < 0.2) {
				ret.push(q2[i].firstPrefix);
			}
		}
		if(ret.length < count && q2.length >= count) {
			for(i=1; i < q2.length && ret.length < count; i++) {
				if(ret.indexOf(q2[i].firstPrefix) == -1) {
					ret.push(q2[i].firstPrefix);
				}
			}
		}
		return ret;
	}

	module.searchSome = function(continuation) {
		//search a number of iterations, then return true if there is more to come
		//up to X iterations:
		sentSolution = false;
		for(var iter=continuation; iter<continuation+ITERS_PER_CONTINUATION && iter<ITER_MAX && q.length > 0; iter++) {
			//dequeue and move from open to closed
			//log("Iter "+iter);
			var node = q.shift();
			//because of weirdness with hints and our inability to delete items from the queue, our q might have noise in it.
			if(node.visited) { continue; }
			if(member(node,closed)) { warn("found a closed node "+node.id); continue; }
			//log("Dat:"+JSON.stringify(node.backup));
			exactRemove(node,open);
			exactInsert(node,closed);
			//just close nodes with best paths longer than or equal to gLimit.
			if(node.g >= gLimit) { continue; }
			expand(iter,node,null);
			if(pauseAfterNextSolution && sentSolution) {
				sentSolution = false;
				pauseAfterNextSolution = false;
				if(MODE == "fast_then_best") {
					gLimit = bestSolution.g;
				} 
				break;
			}
		}
		if(iter < ITER_MAX && q.length > 0) {
			return {
				busy:true,
				response:{
					continuation:iter,
					queueLength:q.length,
					nodeCount:nodeId,
					minG:(q.peek() ? q.peek().g : -1),
					minH:(q.peek() ? q.peek().h : -1)
				}
			};
		} else {
			return {
				busy:false,
				response:{
					iterations:iter,
					queueLength:q.length,
					kickstart:q.length > 0 ? samplePathsFromQueue(100) : [],
					nodeCount:nodeId,
					minG:(q.peek() ? q.peek().g : -1),
					minH:(q.peek() ? q.peek().h : -1),
					fullyExhausted:q.length == 0
				}
			};
		}
	}
	function expand(iter,node,track) {
		node.visited = true;
		//for each action valid in the game:
		for(var ai = 0; ai < ACTIONS.length; ai++) {
			var action = ACTIONS[ai];
			//switch to this state, perform action, createOrFindNode()
			switchToSearchState(node);
			processInput(action,false,false,node.backup);
			while(againing) {
				processInput(-1);
			}
			var currentNode = createOrFindNode(node,action);
			if(track) {
				track[ai] = currentNode;
			}
			//log("Found "+currentNode.id+" by "+node.id +":"+action);
			//if this is winning, report a win
			if(winning) {
				//log("WIN");
				postSolution(currentNode, iter);
				
				if(FIRST_SOLUTION_ONLY) {
					q = new priority_queue.PriorityQueue();
					open = initSet();
					closed = initSet();
					if(track) {
						for(var aj = ai; aj < ACTIONS.length; aj++) {
							track[aj] = null;
						}
					}
					return;
				}
				
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
					addEventualSolution([{action:action, predecessor:node}],es);
				}
			}
		}
	}

	function addEventualSolution(nodePreds,s) {
		if(FIRST_SOLUTION_ONLY) { return; }
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

	//FIXME: crashes on level 6 (0-indexed) of Constellation Z. Maybe is infinite looping there.
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
		var prefixes = FIRST_SOLUTION_ONLY ? [currentNode.firstPrefix] : prefixes(currentNode);
		Solver.postSolution({
			id:currentNode.id,
			backup:currentNode.backup,
			g:currentNode.g,
			h:currentNode.h,
			f:currentNode.f,
			prefixes:prefixes,
			ruleCounts:prefixes.map(function(p){ return Solver.getRuleCounts(p)[Solver.LEVEL][Utilities.RC_CATEGORY_WIN]; }),
			iteration:iter,
			time:Solver.timeSinceStart()
		});
		sentSolution = true;
		if(!bestSolution || currentNode.g < bestSolution.g) {
			bestSolution =currentNode;
		}
	};

	var tempCentroids;
	function findDenormCentroids(into) {
		if(!into || into.length != state.objectCount) { into = new Int32Array(state.objectCount); }
		for(var i = 0; i < into.length; i++) {
			into[i] = 0;
		}
		for(i = 0; i < level.n_tiles; i++) {
			var bitmask = level.getCellInto(i,_oA);
			for(var bit = 0; bit < state.objectCount; ++bit) {
				if(bitmask.get(bit)) {
					into[bit] += i;
				}
			}
		}
		return into;
	}

	var tempNode = {
		id:-1,
		visited:false,
		backup:{},
		predecessors:[],
		firstPrefix:[],
		winning:false,
		eventualSolutions:[],
		//indexing optimization:
		keys:tempCentroids,
		f:0, g:0, h:0
	};

	function createOrFindNode(pred, action) {
		tempCentroids = findDenormCentroids(tempCentroids);
		tempNode.winning = winning;
		tempNode.keys = tempCentroids;
		var existingInClosed = member(tempNode,closed);
		var existingInOpen = existingInClosed ? null : member(tempNode,open);
		var existingN = existingInClosed || existingInOpen;
		var g = pred ? pred.g+gDiscount : 0;
		if(existingN) {
			if(pred) {
				//pred.successors[action] = existingN;
				//log("B add "+pred.id+":"+action+" to "+existingN.id);
				existingN.predecessors.push({action:action, predecessor:pred});
			}
			if(g < existingN.g) {
				existingN.g = g;
				//no need to recalculate H, since H is independent of path
				// if(existingInOpen) {
				//	log("Re-queueing "+existingN.id+" from old F "+existingN.f+" to new F "+(g+existingN.h));
				// }
				existingN.f = existingN.g + existingN.h;
				if(existingInOpen) {
					//let's just live with duplicate items!
					q.push(existingN);
					//existingN won't have any successors, since it's in the open set.
					//so there's no need to worry about updating them.
				} else {
					//MAYBE: if existingInClosed, also update successors in the closed set?
					//Won't help with search at all...
				}
			}
			return existingN;
		}
		//actually make a node data structure
		var h = calculateH()*hDiscount;
		var n = {
			id:nodeId,
			visited:false,
			backup:backupLevel(),
			predecessors:pred ? [{action:action, predecessor:pred}] : [],
			firstPrefix:pred ? pred.firstPrefix.slice() : [],
			winning:winning,
			eventualSolutions:[],
			//indexing optimization:
			keys:new Int32Array(tempCentroids),
			f:g+h, g:g, h:h
		};
		nodeId++;
		if(pred) {
			n.firstPrefix.push(action);
		}
		return n;
	}

	function enqueueNode(n) {
		exactInsert(n,open);
		q.push(n);
	}

	var _oA;
	var _oB;

	var max = Math.max;
	var min = Math.min;
	var floor = Math.floor;
	var abs = Math.abs;

	function calculateH() {
		if(hDiscount <= 0 || state.winconditions.length==0) { return 0; }
		var h = 0;
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
						var anyXs = false;
						for (var i=0;i<level.n_tiles;i++) {
							var cell = level.getCellInto(i,_oA);
							if ( (!filter1.bitsClearInArray(cell.data)) ) {
								anyXs = true;
								var nearest = findNearest(filter2,i);
								//no Y!
								//it's not clear what a reasonable value would be.
								//we'll be optimistic in order to try and stay admissible,
								//and hope that the next turn will produce a Y.
								//Put another way, we have "an unsatisfied X".
								if(nearest == -1) {
									minDist = min(minDist,1);
								}
								minDist = min(minDist, distance(nearest,i));
								//already an X on a Y! Just use 0.
								if(minDist == 0) { break; }
							}
						}
						h += anyXs ? minDist : 1;
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
		return h/state.winconditions.length;
	}
	function distance(i,j) {
		var ix = (i / level.height)|0;
		var iy = i - ix*level.height;
		var jx = (j / level.height)|0;
		var jy = j - jx*level.height;
		return abs(ix-jx) + abs(iy-jy);
	}
	function findNearest(filt, i) {
		var maxD = (level.width+level.height)|0;
		var cx = (i / level.height)|0;
		var cy = (i - cx*level.height)|0;
		var j=0;
		var cell;
		for(var d=0; d < maxD; d++) {
			for(var row=0; row < d+1; row++) {
				var lx = cx - d + row;
				var hx = cx + d - row;
				var ly = cy - row;
				var hy = cy + row;
				if(lx >= 0 && ly >= 0) {
					j = (ly+lx*level.height)|0;
					cell = level.getCellInto(j,_oB);
					if(!filt.bitsClearInArray(cell.data)) {
						return j;
					}
				}
				if(lx >= 0 && hy < level.height) {
					j = (hy+lx*level.height)|0;
					cell = level.getCellInto(j,_oB);
					if(!filt.bitsClearInArray(cell.data)) {
						return j;
					}
				}
				if(hx < level.width && ly >= 0) {
					j = (ly+hx*level.height)|0;
					cell = level.getCellInto(j,_oB);
					if(!filt.bitsClearInArray(cell.data)) {
						return j;
					}
				}
				if(hx < level.width && hy < level.height) {
					j = (hy+hx*level.height)|0;
					cell = level.getCellInto(j,_oB);
					if(!filt.bitsClearInArray(cell.data)) {
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
		//log("Just didn't find anything within "+maxD);
		return -1;
	}

	function initSet() {
		return {};
	}
	
	function getInnerSet(node,set) {
		var innerSet = set;
		var ocs = node.keys;
		for(var i = 0; i < ocs.length; i++) {
			if(!innerSet[ocs[i]]) {
				innerSet[ocs[i]] = (i == ocs.length - 1) ? [] : {};
			}
			innerSet = innerSet[ocs[i]];
		}
		return innerSet;
	}

	function equiv(n1,n2) {
		if(n1 == n2) { return true; }
		if(n1.winning != n2.winning) { return false; }
		var n1BakObjs = null;
		if(n1.backup && n1.backup.dat) {
			n1BakObjs = n1.backup.dat;
		} else {
			n1BakObjs = level.objects;
		}
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
		// if(state.anyRandomRules) {
		//	RandomGen = new RNG(searchState.RNG);
		// }
		titleScreen=false;
		titleSelected=false;
		againing=false;
		titleMode=0;
		textMode=false;
		restoreLevel(searchState.backup);
		backups.length = 0;
		restartTarget=searchState.backup;
	};

	return module;
})();