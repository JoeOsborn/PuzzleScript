var scope = self;

// performance.now polyfill © Paul Irish
// https://gist.github.com/paulirish/5438650
// relies on Date.now() which has been supported everywhere modern for years.
// as Safari 6 doesn't have support for NavigationTiming, we use a Date.now() timestamp for relative values
// if you want values similar to what you'd get with real perf.now, place this towards the head of the page
// but in reality, you're just getting the delta between now() calls, so it's not terribly important where it's placed
// prepare base perf object
if (!scope.hasOwnProperty("performance") || !performance || typeof performance === 'undefined') {
    performance = {};
}

if (!performance.now) {
  var nowOffset = Date.now();
  if (performance.timing && performance.timing.navigationStart){
    nowOffset = performance.timing.navigationStart
  }
  performance.now = function now(){
    return Date.now() - nowOffset;
  }
}

var MemoryTest = (function() {
	var module = {};

	var WAIT = -1;
	var UP = 0;
	var LEFT = 1;
	var DOWN = 2;
	var RIGHT = 3;
	var ACTION = 4;

	var ITER_MAX = 10000;

	var REPLY_FN = scope.hasOwnProperty("reply") ? reply : null;
	var LEVEL = 0, RULES = "", SEED = null;
	var OLD_TESTING, OLD_AUTO_ADVANCE;
	
	var INIT_LEVEL;
	var ACTIONS;	
	var START_TIME = 0;

	var nodeId=0;
	var open, closed, q;
	var root;

	module.startTest = function(config) {
		if(!_oA) { _oA = new BitVec(STRIDE_OBJ); }
		if(!_oB) { _oB = new BitVec(STRIDE_OBJ); }
		nodeId=0;
		OLD_TESTING = unitTesting;
		OLD_AUTO_ADVANCE = testsAutoAdvanceLevel;
		LEVEL = config.level;
		RULES = config.rules;
		SEED = config.seed;
		if(config.replyFn) {
			REPLY_FN = config.replyFn;
		}
		START_TIME = performance.now();

		compile(["loadLevel", LEVEL], RULES, SEED);
		
		state.sfx_Events = {};
		state.sfx_CreationMasks = [];
		state.sfx_DestructionMasks = [];
		state.sfx_MovementMasks = [];
		state.sfx_MovementFailureMasks = [];
		
		INIT_LEVEL = backupLevel();

		if (!state.levels[LEVEL] || state.levels[LEVEL].message) {
			REPLY_FN("stopped");
			return;
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
        
		root = createOrFindNode(null,WAIT);
		
		testsAutoAdvanceLevel = false;
		unitTesting = true;

		exactRemove(root,open);
		exactInsert(root,closed);

		for(var iter = 0; iter < ITER_MAX; iter++) {
			var node = root;
			expand(iter, node, null);
			if(iter == 10-1) {
				REPLY_FN("message", {iter:iter+1, mem:getMemUsage()});
			} else if(iter == 100-1) {
				REPLY_FN("message", {iter:iter+1, mem:getMemUsage()});
			} else if(iter == 1000-1) {
				REPLY_FN("message", {iter:iter+1, mem:getMemUsage()});
			} else if(iter == 10000-1) {
				REPLY_FN("message", {iter:iter+1, mem:getMemUsage()});
			} else if(iter == 100000-1) {
				REPLY_FN("message", {iter:iter+1, mem:getMemUsage()});
			} else if(iter == 1000000-1) {
				REPLY_FN("message", {iter:iter+1, mem:getMemUsage()});
			}
		}
		REPLY_FN("stopped");
		restartTarget = INIT_LEVEL;
		restoreLevel(INIT_LEVEL);
		winning = false;
		testsAutoAdvanceLevel = OLD_AUTO_ADVANCE;
		unitTesting = OLD_TESTING;
	};
	
	function getMemUsage() {
		return performance.memory.usedJSHeapSize;
	}
	
	function timeSinceStart() {
		return (performance.now()-START_TIME)/1000.0;
	}
	
	function expand(iter,node,track) {
		//for each action valid in the game:
		for(var ai = 0; ai < ACTIONS.length; ai++) {
			var action = ACTIONS[ai];
			//switch to this state, perform action, createOrFindNode()
			switchToSearchState(node);
			processInput(action,false,false,node.backup,false,true);
			while(againing && again <= AGAIN_LIMIT) {
				processInput(-1,false,false,null,false,true);
				//TODO: detect loops
				again++;
			}
			var currentNode = createOrFindNode(node,action);
			if(track) {
				track[ai] = currentNode;
			}
		}
	}

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
		var g = 0;
		if(existingN) {
			if(pred) {
				//pred.successors[action] = existingN;
				//log("B add "+pred.id+":"+action+" to "+existingN.id);
				//existingN.predecessors.push({action:action, predecessor:pred});
			}
			return existingN;
		}
		//actually make a node data structure
		var h = 0;
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

	var _oA;
	var _oB;

	var max = Math.max;
	var min = Math.min;
	var floor = Math.floor;
	var abs = Math.abs;

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
		// 	RandomGen = new RNG(searchState.RNG);
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