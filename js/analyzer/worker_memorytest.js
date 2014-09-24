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
importScripts("memory_test.js");

/*
Protocol:
	>start: {id:ID,init:{rules: RuleText, level: LevelNumber, [seed:Seed,] verbose: Bool}}
		<started:{id:ID}
			<message: {id:ID, ...}
			<stopped: {id:ID, ...}
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
			MemoryTest.startTest(msg.data.init);
			break;
		default:
			throw new Error("Unrecognized Message:"+JSON.stringify(msg));
			break;
	}
};
