var Solver = (function() {
	var module = {};

	var WAIT = -1;
	var UP = 0;
	var LEFT = 1;
	var DOWN = 2;
	var RIGHT = 3;
	var ACTION = 4;
	var VERBOSE = false;

	module.startSearch = function(config) {
		//compile(["loadLevel", config.level], config.rules, config.seed);
		VERBOSE = config.verbose;
		log("Starty B!");
		Solver.continueSearch(0);
		log("okkkk");
	},

	module.continueSearch = function(continuation) {
		log("continue!");
		if(searchSome(continuation)) {
			log("busy!");
			reply("busy", {continuation:continuation+1})
		} else {
			log("echo!");
			reply("echo", {content:"all done", continuation:continuation});
		}
	};

	searchSome = function(continuation) {
		//search a number of iterations, then return true if there is more to come
		log("Some? "+continuation);
		if(continuation < 10) {
			log("yup");
			reply("echo", {content:"searched a little bit: "+continuation});
			return true;
		}
		log("nup");
		return false;
	};

	switchToSearchState = function(searchState) {
		RandomGen = new RNG(searchState.RNG);
		titleScreen=false;
		titleSelected=false;
		againing=false;
		if (leveldat.message===undefined) {
			titleMode=0;
			textMode=false;
			level.objects = new Int32Array(searchState.objects);
			RebuildLevelArrays();
			backups=[]
			restartTarget=backupLevel();
		} else {
			reply("exhausted", {level:curlevel})
		}
	};

	return module;
})();
