var collisionCount=0;
var findCount=0;

var closedCycles=0;
var openCycles=0;

var SolverCautious = (function() {
	var scope = self || this || {};

	var module = {};

	var DOTDOTDOT = -2;
	var WAIT = -1;
	var UP = 0;
	var LEFT = 1;
	var DOWN = 2;
	var RIGHT = 3;
	var ACTION = 4;
	
	var OPPOSITE_ACTIONS = {};
	OPPOSITE_ACTIONS[UP] = DOWN;
	OPPOSITE_ACTIONS[DOWN] = UP;
	OPPOSITE_ACTIONS[LEFT] = RIGHT;
	OPPOSITE_ACTIONS[RIGHT] = LEFT;
	
	var BACK_STEPS="some";
	//"all": "allow all moves back"
	//"some": "allow moves back only if the map configuration (ignoring the player) has changed between the predecessor and now."
	//"none": "allow no moves back"

	var ITERS_PER_CONTINUATION=20000;
	var ITER_MAX=1000000;
	
	var BACK_STEP_PENALTY=10;
	var SEEN_SPOT_PENALTY=0.00001;
	
	var ACTIONS;

	var FIRST_SOLUTION_ONLY = true;
	//TODO: Let designer give annotations for "shortish", "mediumish", and "longish" games/levels
	//Longer -> lower value for gDiscount
	//For shortish games, maybe even set hDiscount=0
	var hDiscount = 5.0;
	var gDiscount = 1.0;
	var gLimit = Infinity;

	var pauseAfterNextSolution = false;
	var sentSolution = false;
	var bestSolution;

	var nodeId=0;
	var open, closed, q;
	var root;
	var MODE = "fast";
	
	var seenPlayerPositions = {};
	
	var randTable = new Int8Array(256);
	var randTable2 = new Int8Array(256);
	
	var MAP_SIZE=0|0; // in bytes
	var NODE_LIMIT=Infinity;
	
	var notPlayerMask;

	module.startSearch = function(config) {
		if(!_oA) { _oA = new BitVec(STRIDE_OBJ); }
		if(!_oB) { _oB = new BitVec(STRIDE_OBJ); }
		notPlayerMask = state.playerMask.clone();
		notPlayerMask.iflip();
		nodeId=0;
		seenPlayerPositions = {};
		
		MAP_SIZE = level.n_tiles * STRIDE_OBJ * 4; // each STRIDE is 32 bits
		var memLimit = parseFloat(Utilities.getAnnotationValue(Solver.RULES, "MEMORY_LIMIT", Infinity)); // in MB
		if(Math.floor(memLimit) != Infinity) {
			NODE_LIMIT = Math.floor((memLimit*1024*1024) / MAP_SIZE);
		}
		
		for(var ri = 0; ri < randTable.length; ri++) {
			randTable[ri] = Math.random()*256 | 0;
			randTable2[ri] = Math.random()*256 | 0;
		}
		
		if(Solver.MODE == "fast") {
			FIRST_SOLUTION_ONLY = true;
			hDiscount = 1.0;
			gDiscount = 0.5;
		} else if(Solver.MODE == "fast_then_best") {
			FIRST_SOLUTION_ONLY = false;
			pauseAfterNextSolution = true;
			hDiscount = 1.0;
			gDiscount = 0.5;
		}
		
		BACK_STEPS = Utilities.getAnnotationValue(Solver.RULES, "BACK_STEPS", BACK_STEPS).toLowerCase();
		BACK_STEP_PENALTY = parseFloat(Utilities.getAnnotationValue(Solver.RULES, "BACK_STEP_PENALTY", BACK_STEP_PENALTY));
		SEEN_SPOT_PENALTY = parseFloat(Utilities.getAnnotationValue(Solver.RULES, "SEEN_SPOT_PENALTY", SEEN_SPOT_PENALTY));
		gDiscount = parseFloat(Utilities.getAnnotationValue(Solver.RULES, "G_DISCOUNT", gDiscount));
		hDiscount = parseFloat(Utilities.getAnnotationValue(Solver.RULES, "H_DISCOUNT", hDiscount));
		ITER_MAX = parseInt(Utilities.getAnnotationValue(Solver.RULES, "ITER_MAX", ITER_MAX));
		ITERS_PER_CONTINUATION = parseInt(Utilities.getAnnotationValue(Solver.RULES, "ITER_MAX", ITERS_PER_CONTINUATION));

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
		ACTIONS.reverse();

		open = initSet();
		closed = initSet();
		//Sort by F, break ties by H.
		q = new priority_queue.PriorityQueue(function(a,b) { return (a.f == b.f) ? (a.h - b.h) : (a.f - b.f); });
				
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
				for(var ai=0; ai < hint.prefixes[hi].length; ai++) {
					var hintI = hint.prefixes[hi][ai];
					if(hintI == DOTDOTDOT) {
						//just skip it for now
					} else {
						if(q.length==0) {
							log("Got a win earlier than expected");
							break;
						}
						node.actions.splice(node.actions.indexOf(hint.prefixes[hi][ai]));
						node.actions.push(hint.prefixes[hi][ai]);
						node = expand(0, node);
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
			if(iter % 20000 == 0) {
				log("Lev:"+Solver.LEVEL+" Iter:"+iter);
			}
			//dequeue and move from open to closed
			//log("Iter "+iter);
			var node = q.shift();
			//because of weirdness with hints and our inability to delete items from the queue, our q might have noise in it.
			if(node.actions.length == 0) { 
				continue; 
			}
			if(member(node,closed)) { 
				warn("found a closed node "+node.id); 
				continue; 
			}
			//log("Dat:"+JSON.stringify(node.backup));
			//just close nodes with best paths longer than or equal to gLimit.
			if(node.g >= gLimit) { 
				continue;
			}
			expand(iter,node);
			if(node.actions.length == 0) {
				//Don't shift here! The first element in the queue might have changed!
				exactRemove(node,open);
				exactInsert(node,closed);
			} else if(!(sentSolution && FIRST_SOLUTION_ONLY)) {
				node.f = node.g + node.actionHs[node.actionHs.length-1];
				q.push(node);
			}
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
					kickstart:Solver.RANDOM_RESTART && q.length > 0 ? samplePathsFromQueue(100) : [],
					nodeCount:nodeId,
					minG:(q.peek() ? q.peek().g : -1),
					minH:(q.peek() ? q.peek().h : -1),
					fullyExhausted:q.length == 0
				}
			};
		}
	}
	var AGAIN_LIMIT = 100;
	function expand(iter,node) {
		var action = node.actions.pop();
		var actionH = node.actionHs.pop();
		//switch to this state, perform action, createOrFindNode()
		switchToSearchState(node);
		if(!processInput(action,false,false,node.backup,true,true) || cmd_cancel || cmd_restart) {
			return node;
		}
		if(cmd_checkpoint) {
			//TODO: bump this node's H value?
		}
		var againIters = 0;
		while(againing && againIters < AGAIN_LIMIT) {
			processInput(-1,false,false,null,true,true);
			if(cmd_cancel || cmd_restart) { againing = false; }
			//TODO: detect loops
			againIters++;
			if(cmd_checkpoint) {
				//TODO: bump this node's H value?
			}
		}
		if(againIters >= AGAIN_LIMIT) {
			warn("Too many again loops");
		}
		var currentNode = createOrFindNode(node,action,actionH);
		//log("Found "+currentNode.id+" by "+node.id +":"+action);
		//if this is winning, report a win
		if(winning) {
			//log("WIN");
			postSolution(currentNode, iter);
			
			if(FIRST_SOLUTION_ONLY) {
				q = new priority_queue.PriorityQueue();
				open = initSet();
				closed = initSet();
				return currentNode;
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
		return currentNode;
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
			ruleCounts:prefixes.map(function(p){ 
				var counts = Solver.getRuleCounts(p)[Solver.LEVEL];
				//HACK: For some bizarre reason, counts is sometimes null.
				if(!counts) {
					warn("Uh oh, null counts for level "+Solver.LEVEL+" prefix "+p.join(",")+" all counts="+JSON.stringify(Solver.getRuleCounts(p)));
					return [];
				}
				return counts;
			}),
			iteration:iter,
			time:Solver.timeSinceStart()
		});
		sentSolution = true;
		if(!bestSolution || currentNode.g < bestSolution.g) {
			bestSolution =currentNode;
		}
	};

	var rearranged = [];
	var rearrangedCount = 0;
	function hashKey(rearrangeMask) {
		var h = 0|0;
		var l = STRIDE_OBJ;
		var tiles = level.n_tiles;
		rearrangedCount = 0;
		for(var i = 0; i < tiles; i++) {
			level.getCellInto(i,_oA);
			if(rearrangeMask) {
				if(!rearranged[rearrangedCount]) {
					rearranged[rearrangedCount] = _oA.clone();
				} else {
					_oA.cloneInto(rearranged[rearrangedCount]);
				}
				rearranged[rearrangedCount].iand(rearrangeMask);
				rearrangedCount++;
				_oA.iclear(rearrangeMask);
			}
			var bitmask = _oA.data;
			for(var d = 0; d < l; d++) {
				h += (randTable[bitmask[d]&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
				h += (randTable[(bitmask[d]>>8)&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
				h += (randTable[(bitmask[d]>>16)&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
				h += (randTable[(bitmask[d]>>24)&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
			}
		}
		for(i = 0; i < rearrangedCount; i++) {
			var bitmask = rearranged[i].data;
			for(var d = 0; d < l; d++) {
				h += (randTable[bitmask[d]&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
				h += (randTable[(bitmask[d]>>8)&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
				h += (randTable[(bitmask[d]>>16)&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
				h += (randTable[(bitmask[d]>>24)&0x000000FF])|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
			}
		}
		h += ( h << 3 )|0;
		h ^= ( h >> 11 )|0;
		h += ( h << 15 )|0;
		return h;
	}

	function hashKey2Int(h, int32) {
		h += (randTable[int32&0x000000FF])|0;
		h += (h << 10)|0;
		h ^= (h >> 6)|0;
		h += (randTable[(int32>>8)&0x000000FF])|0;
		h += (h << 10)|0;
		h ^= (h >> 6)|0;
		h += (randTable[(int32>>16)&0x000000FF])|0;
		h += (h << 10)|0;
		h ^= (h >> 6)|0;
		h += (randTable[(int32>>24)&0x000000FF])|0;
		h += (h << 10)|0;
		h ^= (h >> 6)|0;
		return h;
	}
	function hashKey2() {
		var h = 2166136261|0;
		var l = STRIDE_OBJ|0;
		var tiles = level.n_tiles;
		var runLength = 0;
		var runStart = _oA;
		var cur = _oB;
		level.getCellInto(0, runStart);
		var tilesMinusOne = tiles - 1;
		for(var i = 0; i < tiles; i++) {
			level.getCellInto(i, cur);
			if(cur.equals(runStart)) {
				runLength++;
			} else {
				for(var d = 0; d < l; d++) {
					h = hashKey2Int(h, cur.data[d]);
				}
				h = hashKey2Int(h, runLength);
				runLength = 1;
				cur.cloneInto(runStart);
			}
		}
		for(var d = 0; d < l; d++) {
			h = hashKey2Int(h, runStart.data[d]);
		}
		h = hashKey2Int(h, runLength);
		return h;		
	}
	
	function hashPlayerPositions(posns,count) {
		var h = 0|0;
		var l = STRIDE_OBJ;
		var tiles = level.n_tiles;
		for(i = 0; i < count; i++) {
			var pos = posns[i];
			h += randTable[(pos&0x000000FF)]|0;
			h += (h << 10)|0;
			h ^= (h >> 6)|0;
			if(tiles > 255) {
				h += randTable[((pos>>8)&0x000000FF)]|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
			}
			if(tiles > 65535) {
				h += randTable[((pos>>16)&0x000000FF)]|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
			}
			if(tiles > 16777215) {
				h += randTable[((pos>>24)&0x000000FF)]|0;
				h += (h << 10)|0;
				h ^= (h >> 6)|0;
			}
		}
		h += ( h << 3 )|0;
		h ^= ( h >> 11 )|0;
		h += ( h << 15 )|0;
		return h;
	}

	var tempNode = {
		id:-1,
		actions:[],
		actionHs:[],
		backup:{},
		predecessors:[],
		firstPrefix:[],
		winning:false,
		eventualSolutions:[],
		key0:-1|0,
		key1:-1|0,
		minusPlayerKey:-1|0,
		f:0, g:0, h:0
	};
	var tempPosns = [];
	
	var closedCyclePoints = {};
	
	function createOrFindNode(pred, action, actionH) {
		var key0 = hashKey();
		var key1 = hashKey2();
		var minusPlayerKey = hashKey(state.playerMask);
		tempNode.winning = winning;
		tempNode.key0 = key0;
		tempNode.key1 = key1;
		var existingInOpen = member(tempNode,open);
		if(existingInOpen) {
			openCycles++;
		}
		var existingInClosed = existingInOpen ? null : member(tempNode,closed);
		if(existingInClosed && !existingInOpen) {
			closedCycles++;
			if(!(existingInClosed.key0 in closedCyclePoints)) {
				closedCyclePoints[existingInClosed.key0] = {};
			}
			if(!(existingInClosed.key1 in closedCyclePoints[existingInClosed.key0])) {
				closedCyclePoints[existingInClosed.key0][existingInClosed.key1] = 0;
			}
			closedCyclePoints[existingInClosed.key0][existingInClosed.key1]++;
		}
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
				if(existingInOpen && existingN.actions.length > 0) {
					//let's just live with duplicate items!
					var opposite = OPPOSITE_ACTIONS[action];
					var oppositeIdx = action in OPPOSITE_ACTIONS ? existingN.actions.indexOf(opposite) : -1;
					if(oppositeIdx != -1) {
						existingN.actions.splice(oppositeIdx,1);
						var ah = existingN.actionHs[oppositeIdx];
						existingN.actionHs.splice(oppositeIdx,1);
						if(BACK_STEPS == "all" || (BACK_STEPS == "some" && !(pred && pred.minusPlayerKey == minusPlayerKey))) {
							existingN.actions.unshift(opposite);
							existingN.actionHs.unshift(ah * BACK_STEP_PENALTY);
						}
					}
					//TODO: Fix this, it's no longer true!
					//existingN won't have any successors, since it's in the open set.
					//so there's no need to worry about updating them.
				} else {
					//MAYBE: if existingInClosed, also update successors in the closed set?
					//Won't help with search at all...
				}
				existingN.f = existingN.g + existingN.actionHs[existingN.actions.length-1];
				q.push(existingN);
			}
			return existingN;
		}		
		//actually make a node data structure
		var h = calculateH()*hDiscount;
		var n = {
			id:nodeId,
			actions:ACTIONS.slice(),
			actionHs:new Array(ACTIONS.length),
			backup:backupLevel(),
			predecessors:pred ? [{action:action, predecessor:pred}] : [],
			firstPrefix:pred ? pred.firstPrefix.slice() : [],
			winning:winning,
			eventualSolutions:[],
			//indexing optimization:
			key0:key0,
			key1:key1,
			minusPlayerKey:minusPlayerKey,
			f:g+h, g:g, h:h
		};
		
		for(var ai = 0; ai < ACTIONS.length; ai++) {
			n.actionHs[ai] = h;
		}
		var opposite = OPPOSITE_ACTIONS[action];
		var oppositeIdx = action in OPPOSITE_ACTIONS ? n.actions.indexOf(opposite) : -1;
		if(oppositeIdx != -1) {
			n.actions.splice(oppositeIdx,1);
			var ah = n.actionHs[oppositeIdx];
			n.actionHs.splice(oppositeIdx,1);
			if(BACK_STEPS == "all" || (BACK_STEPS == "some" && !(pred && pred.minusPlayerKey == minusPlayerKey))) {
				n.actions.unshift(opposite);
				n.actionHs.unshift(ah * BACK_STEP_PENALTY);
			}
		}
		var posnsHash = hashPlayerPositions(playerPositions, playerPositionCount);
		if(!(minusPlayerKey in seenPlayerPositions)) { seenPlayerPositions[minusPlayerKey] = {}; }
		if(!(posnsHash in seenPlayerPositions[minusPlayerKey])) { seenPlayerPositions[minusPlayerKey][posnsHash] = 0; }
		seenPlayerPositions[minusPlayerKey][posnsHash] += 1;
		for(var ai = 0; ai < ACTIONS.length; ai++) {
			var a = ACTIONS[ai];
			if(a < 0 || a >= 4) { continue; }
			var nidx = n.actions.indexOf(a);
			if(nidx == -1) { continue; }
			//let tempPosns[pi] be the probable result of performing a on playerPositions[pi]
			//TODO: consider stuff on the same layer as the player object at playerPositions[pi]?
			for(var pi = 0; pi < playerPositionCount; pi++) {
				var pidx = playerPositions[pi];
				switch(a) {
					case UP:
						tempPosns[pi] = (pidx - 1) < 0 ? pidx : pidx - 1;
						break;
					case DOWN:
						tempPosns[pi] = (pidx + 1) > level.n_tiles ? pidx : pidx + 1;
						break;
					case LEFT:
						tempPosns[pi] = ((pidx - level.height) < 0) ? pidx : (pidx - level.height);
						break;
					case RIGHT:
						tempPosns[pi] = ((pidx + level.height) > level.n_tiles) ? pidx : (pidx + level.height);
						break;
				}
			}
			var tempHash = hashPlayerPositions(tempPosns, playerPositionCount);
			if(!(minusPlayerKey in seenPlayerPositions)) {
				seenPlayerPositions[minusPlayerKey] = {};
			}
			//if the hash of ppprime is in seenPlayerPositions, deprioritize it (splice it from and unshift it to n.actions)
			if(tempHash in seenPlayerPositions[minusPlayerKey]) {
				n.actions.splice(nidx,1);
				var ah = n.actionHs[nidx];
				n.actionHs.splice(nidx,1);
				n.actions.unshift(a);
				n.actionHs.unshift(ah * (1 + SEEN_SPOT_PENALTY*seenPlayerPositions[minusPlayerKey][tempHash]));
				seenPlayerPositions[minusPlayerKey][tempHash]++;
			} else {
				seenPlayerPositions[minusPlayerKey][tempHash] = 1;
			}
		}
		n.f = n.g + n.actionHs[n.actions.length-1];
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
		if(!(node.key0 in set)) {
			set[node.key0] = {};
		}
		if(!(node.key1 in set[node.key0])) {
			set[node.key0][node.key1] = [];
		}
		return set[node.key0][node.key1];

		// if(!(node.key0 in set)) {
		// 	set[node.key0] = [];
		// }
		// return set[node.key0];
	}

	function equiv(n1,n2) {
		if(n1 == n2) { return true; }
		if(n1.key0 != n2.key0) { return false; }
		if(n1.key1 != n2.key1) { return false; }
		if(n1.winning != n2.winning) { return false; }
		//
		// var n1BakObjs = null;
		// if(n1.backup && n1.backup.dat) {
		// 	n1BakObjs = n1.backup.dat;
		// } else {
		// 	n1BakObjs = level.objects;
		// }
		// var n2BakObjs = n2.backup.dat;
		// if(n1BakObjs.length != n2BakObjs.length) { return false; }
		//
		// for(var i=0; i < n1BakObjs.length; i++) {
		// 	if(n1BakObjs[i] != n2BakObjs[i]) {
		// 		collisionCount++;
		// 		return false;
		// 	}
		// }
		findCount++;
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