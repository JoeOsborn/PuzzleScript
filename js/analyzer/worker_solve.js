importScripts(
	"worker_utils.js",
    "utilities.js"
);

importScripts(
	"priority_queue.js",
	"../globalVariables.js",
	"../debug.js",
	"../font.js",
	"../rng.js",
	"../colors.js",
	"../engine.js",
	"../parser.js",
	"../compiler.js"
);
importScripts("solver.js");

/*
Protocol:
	>start: {id:ID,init:{rules: RuleText, level: LevelNumber, [seed:Seed,] verbose: Bool}}
		<started:{id:ID}
		<solution: {id:ID, level: LevelNumber, solution: MoveList}
		<exhausted: {id:ID, level: LevelNumber}
		<stopped: {id:ID, ...}
		<busy: {id:ID, continuation:Object}
			>resume: {continuation:Object}
		If verbose:
		<open: {id:ID, state: State, prefix: MoveList}
		<close: {id:ID, state: State}
		<revisit: {id:ID, state: State, prefix: MoveList}
	>stop: {}
		<stopped:{id:ID}
*/

self.onmessage = function(msg) {
	// log("worker solve got a message "+JSON.stringify(msg.data));
	if(workerDefault(msg)) {
		log("returning early");
		return;
	}
	switch(msg.data.type) {
		case "start":
			log("starting "+id);
			Solver.startSearch(msg.data.init);
			break;
		case "resume":
			log("resuming "+msg.data.continuation);
			Solver.continueSearch(msg.data.continuation);
			break;
		default:
			throw new Error("Unrecognized Message:"+JSON.stringify(msg));
			break;
	}
};
