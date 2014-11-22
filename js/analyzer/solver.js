var Solver = (function() {
	var scope = self || this || {};

	var module = {};
	var nowOffset = Date.now();
	module.now = function() {
		return Date.now() - nowOffset;
	}

	module.VERBOSE = false;
	module.REPLY_FN = null;
	var OLD_TESTING, OLD_AUTO_ADVANCE;
	
	module.START_TIME = 0;

	module.MODE = "fast";
	module.SOLVER = SolverCautious;

	module.startSearch = function(config) {
		OLD_TESTING = unitTesting;
		OLD_AUTO_ADVANCE = testsAutoAdvanceLevel;
		module.LEVEL = config.level;
		module.RULES = config.rules;
		module.SEED = config.seed;
		module.VERBOSE = config.verbose;
		module.MODE = config.mode || mode;
		if(config.replyFn) {
			module.REPLY_FN = config.replyFn;
		} else {
			module.REPLY_FN = reply;
		}
		module.START_TIME = module.now();
		compile(["loadLevel", Solver.LEVEL], Solver.RULES, Solver.SEED);
		
		module.INIT_LEVEL = backupLevel();
		
		state.sfx_Events = {};
		state.sfx_CreationMasks = [];
		state.sfx_DestructionMasks = [];
		state.sfx_MovementMasks = [];
		state.sfx_MovementFailureMasks = [];
		
		module.SOLVER = SolverCautious;
		if(module.RULES.indexOf("(@FREE_MOVEMENT)") != -1) {
			module.SOLVER = SolverFreeMove;
		}
		var start = module.SOLVER.startSearch(config);
		if(start.fullyExhausted) {
			Solver.REPLY_FN("exhausted", {level:module.LEVEL, time:module.timeSinceStart(), response:start});
			Solver.REPLY_FN("stopped");
			return null;
		} else {
			return Solver.continueSearch(start.continuation);
		}
	};
	
	module.timeSinceStart = function() {
		return (module.now()-module.START_TIME)/1000.0;
	}
	
	module.continueSearch = function(continuation) {
		testsAutoAdvanceLevel = false;
		unitTesting = true;
		var response = module.SOLVER.searchSome(continuation);
		if(response.busy) {
			module.REPLY_FN("busy", {level:module.LEVEL, time:module.timeSinceStart(), response:response.response});
		} else {
			restartTarget=module.INIT_LEVEL;
			winning=false;
			restoreLevel(module.INIT_LEVEL);
			log("response:"+JSON.stringify(response));
			module.REPLY_FN("exhausted", {level:module.LEVEL, time:module.timeSinceStart(), response:response.response});
			module.REPLY_FN("stopped");
		}
		testsAutoAdvanceLevel = OLD_AUTO_ADVANCE;
		unitTesting = OLD_TESTING;
		return response.response;
	};

	var storedRuleCounts;
	var storedRuleCategory = Utilities.RC_CATEGORY_WIN;
	
	function ruleApplied(rule,ruleGroup,ruleIndex,direction) {
		Utilities.incrementRuleCount(storedRuleCounts,module.LEVEL,storedRuleCategory,ruleGroup,ruleIndex);
	};

	var AGAIN_LIMIT = 100;
	module.getRuleCounts = function(prefix) {
		var retval = [];
		//alias storedRuleCounts to our return value
		storedRuleCounts = retval;
		registerApplyAtWatcher(ruleApplied);
		//go to initial state
		restartTarget = module.INIT_LEVEL;
		winning=false;
		restoreLevel(module.INIT_LEVEL);
		//run prefix
		for(var i = 0; i < prefix.length; i++) {
			runCompleteStep(prefix[i]);
		}
		unregisterApplyAtWatcher(ruleApplied);
		storedRuleCounts = null;
		return retval;
	}

	module.postSolution = function(soln) {
		module.REPLY_FN("solution", {
			level:module.LEVEL, 
			solution:soln,
			time:module.timeSinceStart()
		});
	};
	
	return module;
})();