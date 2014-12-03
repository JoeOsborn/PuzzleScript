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
	
	var ITERS_PER_CONTINUATION=20000;
	var ITER_MAX=1000000;
	
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

	var AGAIN_LIMIT = 100;
	var againSet = [];
	var nodeId=0;
	var open, closed, q;
	var root;
	var MODE = "fast";
	
	var randTable = new Int8Array(256);
	
	var MAP_SIZE=0|0; // in bytes
	var NODE_LIMIT=Infinity;
	
	var notPlayerMask;
	
	var specs;
	
	var pooledBackups = [];
	var pooledBackupsCount = -1;
	var backupRestores = 0, backupClears = 0;
	
	var q;
	
	module.startSearch = function(config) {
		if(!_oA) { _oA = new BitVec(STRIDE_OBJ); }
		if(!_oB) { _oB = new BitVec(STRIDE_OBJ); }
		notPlayerMask = state.playerMask.clone();
		notPlayerMask.iflip();
		nodeId=0;
		backupRestores = 0;
		backupClears = 0;
		var parsedSpecs = config.spec || [];
		specs = [];
		for(var s = 0; s < parsedSpecs.length; s++) {
			specs.push(SpecCompiler.compileSpec("s_"+curlevel+"_"+s,parsedSpecs[s]));
		}
		
		MAP_SIZE = level.n_tiles * STRIDE_OBJ * 4; // each STRIDE is 32 bits
		var memLimit = parseFloat(Utilities.getAnnotationValue(Solver.RULES, "MEMORY_LIMIT", Infinity)); // in MB
		if(Math.floor(memLimit) != Infinity) {
			NODE_LIMIT = Math.floor((memLimit*1024*1024) / MAP_SIZE);
		}
		
		for(var ri = 0; ri < randTable.length; ri++) {
			randTable[ri] = Math.random()*256 | 0;
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

		open = initSet();
		closed = initSet();
		//Sort by F, break ties by H.
		//q = new priority_queue.PriorityQueue(function(a,b) { return (a.f == b.f) ? (a.h - b.h) : (a.f - b.f); },[],32767);
		//qq = new priority_queue.PriorityQueue(function(a,b) { return (a.f == b.f) ? (a.h - b.h) : (a.f - b.f); },[]);
		q = new priority_queue.PriorityQueue(function(a,b) { return (a.f == b.f) ? (a.h - b.h) : (a.f - b.f); },[]);
		
		var initHDiscount = hDiscount;
		var initGDiscount = gDiscount;
		hDiscount = 0;
		gDiscount = 0;
		root = createOrFindNode(null,WAIT);
		enqueueNode(root);
		hDiscount = initHDiscount;
		gDiscount = initGDiscount;
				
		//log("lvl"+LEVEL+": config.spec="+JSON.stringify(config.spec));
		//TODO: use the specs to guide search! if a spec has no "..." or "until" in it, we can try it as a solution (maybe assuming a "..." on the end?). if it has a "..." but only at the end, likewise!
	// 	if(config.spec && config.spec.prefixes && config.spec.prefixes.length) {
	// 		hDiscount = 0;
	// 		gDiscount = 0;
	// 		var spec = config.spec;
	// 		for(var hi=0; hi < spec.prefixes.length; hi++) {
	// 			var node = root;
	// 			for(var ai=0; ai < spec.prefixes[hi].length; ai++) {
	// 				var specI = spec.prefixes[hi][ai];
	// 				if(specI == DOTDOTDOT) {
	// 					//just skip it for now
	// 				} else {
	// 					if(q.length==0) {
	// 						log("Got a win earlier than expected");
	// 						break;
	// 					}
	// 					node = expand(0, node, spec.prefixes[hi][ai]);
	// 				}
	// 			}
	// 		}
	// 		if(q.length != 0) {
	// 			Solver.REPLY_FN("specInsufficient", {
	// 				level:Solver.LEVEL,
	// 				spec:config.spec,
	// 				queueLength:q.length,
	// 				nodeCount:nodeId,
	// 				minG:(q.peek() ? q.peek().g : -1),
	// 				minH:(q.peek() ? q.peek().h : -1),
	// 				time:Solver.timeSinceStart()
	// 			});
	// 		}
	// 		hDiscount = initHDiscount;
	// 		gDiscount = initGDiscount;
	// 	}
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
	
	function popQueue() {
		var node = q.shift();
		// if(q.length < q.fixedLength && qq.length > 0) {
		// 	var replace = qq.shift();
		// 	q.push(replace);
		// }
		return node;
	}
	
	function pushQueue(n) {
		var overflow = q.push(n);
		// if(overflow) {
		// 	clearBackup(overflow);
		// 	qq.push(overflow);
		// }
	}

	module.searchSome = function(continuation) {
		//search a number of iterations, then return true if there is more to come
		//up to X iterations:
		sentSolution = false;
		var lastPrintedIter = -1;
		for(var iter=continuation; iter<continuation+ITERS_PER_CONTINUATION && iter<ITER_MAX && q.length > 0; iter++) {
			if((iter - lastPrintedIter) >= 20000 || lastPrintedIter == -1) {
				log("Lev:"+Solver.LEVEL+" Iter:"+iter);
				lastPrintedIter = iter;
			}
			//dequeue and move from open to closed
			//log("Iter "+iter);
			var node = popQueue();
			//because of weirdness with specs and our inability to delete items from the queue, our q might have noise in it.
			if(node.closed) { 
				continue;
			}
			//TODO: remove this check
			if(member(node,closed)) { 
				error("found a closed node "+node.id); 
				continue; 
			}
			//log("Dat:"+JSON.stringify(node.backup));
			//just skip nodes with best paths longer than or equal to gLimit.
			if(node.g >= gLimit) { 
				//TODO: should it be put into closed?
				continue;
			}
			if(node.backup == null) {
				//TODO: remake the backup using its best predecessor (recursively). During backup reconstruction, let any non-closed node with f < cutoffF keep its backup around.
				throw new Error("An open node had its backup removed! Too late to fix it!");
			}
			for(var ai = 0; ai < ACTIONS.length; ai++) {
				var action = ACTIONS[ai];
				expand(iter,node,action);
				iter++;
				//Special hack -- if we've abandoned the search, don't expand any more.
				if(FIRST_SOLUTION_ONLY && sentSolution) {
					break;
				}
			}
			if(FIRST_SOLUTION_ONLY && sentSolution) {
				break;
			}
			iter--;
			closeNode(node);
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

	
	function clearBackup(node) {
		//never clear the root!
		if(node == root) { return; }
		pooledBackupsCount++;
		pooledBackups[pooledBackupsCount] = node.backup;
		node.backup = null;
		backupClears++;
		if(backupClears % 1000 == 0) {
			console.log("Backup clears:"+backupClears);
		}
	}
	
	function setBackup(node) {
		if(pooledBackupsCount < 0 || !pooledBackups[pooledBackupsCount]) {
			node.backup = backupLevel();
		} else {
			node.backup = pooledBackups[pooledBackupsCount];
			pooledBackups[pooledBackupsCount] = null;
			pooledBackupsCount--;
			backupLevel(node.backup);
		}
	}

	function expand(iter,node,action) {
		//switch to this state, perform action, createOrFindNode()
		switchToSearchState(node);
		if(!processInput(action,false,false,node.backup,true,true) || cmd_cancel || cmd_restart) {
			return node;
		}
		if(cmd_checkpoint) {
			//TODO: bump this node's H value?
		}
		var againLooped = false;
		var againIters = 0;
		while(againing && againIters < AGAIN_LIMIT) {
			if(!againSet[againIters]) {
				againSet[againIters] = {hash:0|0, backup:null};
			}
			againSet[againIters].backup = backupLevel(againSet[againIters].backup);

			var hash = hashKey(null);
			againSet[againIters].hash = hash;
			for(var i = 0; i < againIters; i++) {
				var againInstance = againSet[i];
				if(againInstance.hash == hash) {
					for(var j = 0; j < level.n_tiles*STRIDE_OBJ; j++) {
						if(level.objects[j] != againInstance.backup.dat[j]) {
							break;
						}
					}
					if(j == level.n_tiles*STRIDE_OBJ) {
						againLooped = true;
						break;
					}
				}
			}
			if(againLooped) {
				//throw exception?
				warn("Encountered infinite AGAIN loop. Treating this path as no-good.");
				break;
			}

			processInput(-1,false,false,againSet[againIters].backup,true,true);
			if(cmd_cancel || cmd_restart) { againing = false; }
			againIters++;
			if(cmd_checkpoint) {
				//TODO: bump this node's H value?
			}
		}
		if(againIters >= AGAIN_LIMIT) {
			warn("Too many again iterations; assuming an undetected infinite loop.");
			againLooped = true;
		}
		if(againLooped) { return node; }
		var currentNode = createOrFindNode(node,action);
		//log("Found "+currentNode.id+" by "+node.id +":"+action);
		//if this is winning, report a win
		if(winning) {
			//log("WIN");
			postSolution(currentNode, iter);
			
			if(FIRST_SOLUTION_ONLY) {
				q = new priority_queue.PriorityQueue();
				// qq = new priority_queue.PriorityQueue();
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
	
	function calculateMatchedSpecsByPrefix(prefixes, currentNode) {
		console.log("Calculating matched specs:"+JSON.stringify(prefixes));
		if(!specs || specs.length == 0) { return []; }
		var resultByPrefix = prefixes.map(function(prefix) {
			switchToSearchState(root);
			var states = [];
			for(var p = 0; p < prefix.length; p++) {
				var dir = prefix[p];
				runCompleteStep(dir);
				states.push({
					move:dir,
					winning:winning,
					state:new Int32Array(level.objects)
				});
			}
			var result = [];
			for(var s = 0; s < specs.length; s++) {
				switchToSearchState(root);
				result[s] = specs[s].match(states);
			}
			return result;
		});
		switchToSearchState(currentNode);
		return resultByPrefix;
	}

	function postSolution(currentNode, iter) {
		var prefixes = FIRST_SOLUTION_ONLY ? [currentNode.firstPrefix] : prefixes(currentNode);
		var matchedSpecs = calculateMatchedSpecsByPrefix(prefixes, currentNode);
		Solver.postSolution({
			id:currentNode.id,
			backup:currentNode.backup,
			g:currentNode.g,
			h:currentNode.h,
			f:currentNode.f,
			prefixes:prefixes,
			matchedSpecsByPrefix:matchedSpecs,
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
		var h = 0|0;
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
		h += ( h << 3 )|0;
		h ^= ( h >> 11 )|0;
		h += ( h << 15 )|0;
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
		backup:{},
		predecessors:[],
		firstPrefix:[],
		winning:false,
		eventualSolutions:[],
		key0:-1|0,
		key1:-1|0,
		f:0, g:0, h:0,
		closed:false
	};
	var tempPosns = [];
	
	var closedCyclePoints = {};
	
	function createOrFindNode(pred, action) {
		var key0 = hashKey();
		var key1 = hashKey2();
		tempNode.winning = winning;
		tempNode.key0 = key0;
		tempNode.key1 = key1;
		var existingInOpen = member(tempNode,open);
		if(existingInOpen) {
			openCycles++;
		}
		var existingInClosed = existingInOpen ? null : member(tempNode,closed);
		// if(existingInClosed && !existingInOpen) {
		// 	closedCycles++;
		// 	if(!(existingInClosed.key0 in closedCyclePoints)) {
		// 		closedCyclePoints[existingInClosed.key0] = {};
		// 	}
		// 	if(!(existingInClosed.key1 in closedCyclePoints[existingInClosed.key0])) {
		// 		closedCyclePoints[existingInClosed.key0][existingInClosed.key1] = 0;
		// 	}
		// 	closedCyclePoints[existingInClosed.key0][existingInClosed.key1]++;
		// }
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
				//if we are reopening a node, give it a backup again.
				if(!existingN.backup) {
					backupRestores++;
					if(backupRestores % 1000 == 0) {
						console.log("Backup restores:"+backupRestores);
					}
					setBackup(existingN);
				}
				existingN.f = existingN.g + existingN.h;
				reopenNode(existingN);
			}
			return existingN;
		}		
		//actually make a node data structure
		var h = (hDiscount > 0 ? calculateH()*hDiscount : 0);
		var n = {
			id:nodeId,
			backup:null,
			predecessors:pred ? [{action:action, predecessor:pred}] : [],
			firstPrefix:pred ? pred.firstPrefix.slice() : [],
			winning:winning,
			eventualSolutions:[],
			//indexing optimization:
			key0:key0,
			key1:key1,
			f:g+h, g:g, h:h,
			closed:false
		};
		setBackup(n);
		
		n.f = n.g + n.h;
		nodeId++;
		if(pred) {
			n.firstPrefix.push(action);
		}
		return n;
	}

	function enqueueNode(n) {
		exactInsert(n,open);
		n.closed = false;
		q.push(n);
	}
	
	function closeNode(node) {
		exactRemove(node,open);
		exactInsert(node,closed);
		node.closed = true;
		clearBackup(node);
	}

	function reopenNode(node) {
		exactRemove(node,closed);
		exactInsert(node,open);
		node.closed = false;
		q.push(node);
	}
	
	var _oA;
	var _oB;

	var max = Math.max;
	var min = Math.min;
	var floor = Math.floor;
	var abs = Math.abs;

	function calculateH() {
		if(state.winconditions.length==0) { return 0; }
		var h = 0;
		if(!_oA) { _oA = new BitVec(STRIDE_OBJ); }
		if(!_oB) { _oB = new BitVec(STRIDE_OBJ); }
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
								//TODO: should we ignore nearby Ys that are already on Xs?
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
	module.calculateH = calculateH;
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
	
	function getInnerSet(node,set,autovivify) {
		if(!(node.key0 in set)) {
			if(!autovivify) { return null; }
			set[node.key0] = {};
		}
		if(!(node.key1 in set[node.key0])) {
			if(!autovivify) { return null; }
			set[node.key0][node.key1] = [];
		}
		return set[node.key0][node.key1];

		// if(!(node.key0 in set)) {
		// 	set[node.key0] = [];
		// }
		// return set[node.key0];
	}
	
	function removeInnerSet(node,set) {
		if((node.key0 in set)) {
			if(node.key1 in set[node.key0]) {
				delete set[node.key0][node.key1];
			}
			if(Object.getOwnPropertyNames(set[node.key0]).length == 0) {
				delete set[node.key0];
			}
		}
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
		var innerSet = getInnerSet(node,set,false);
		if(!innerSet) { return false; }
		var idx = memberIndexInner(node,innerSet);
		if(idx != -1) {
			return innerSet[idx];
		}
		return null;
	}

	function insert(node, set) {
		var innerSet = getInnerSet(node,set,true);
		var idx = memberIndexInner(node,innerSet);
		if(idx == -1) {
			innerSet.push(node);
		}
	}

	function remove(node, set) {
		var innerSet = getInnerSet(node,set,false);
		if(!innerSet) { return; }
		var idx = memberIndexInner(node,innerSet);
		if(idx != -1) {
			innerSet.splice(idx,1);
		}
		if(innerSet.length == 0) {
			removeInnerSet(node,set);
		}
	}

	function exactInsert(node, set) {
		var innerSet = getInnerSet(node,set,true);
		if(innerSet.indexOf(node) == -1) {
			innerSet.push(node);
		}
	}

	function exactRemove(node, set) {
		var innerSet = getInnerSet(node,set,false);
		if(!innerSet) { return; }
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