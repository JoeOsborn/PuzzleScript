//monkey-patch compile

//Put a branch here for idempotence sake
if(!this.hasOwnProperty("compileAndAnalyze") ||
	 !this.compileAndAnalyze) {
	console.log("patch compile");
	var justCompile = compile;
	var compileAndAnalyze = function(command,text,randomSeed) {
		justCompile(command,text,randomSeed);
		analyze(command,text,randomSeed);
	}
	compile = compileAndAnalyze;
}

//Launch a web worker to do analysis without blocking the UI.
var worker = new Worker("js/analyzer/worker.js");

worker.onmessage = function(msg) {
	console.log("got "+JSON.stringify(msg.data)+" from worker");
}

worker.onerror = function(event) {
    throw new Error(event.message + " (" + event.filename + ":" + event.lineno + ")");
}

//worker.postMessage({type:"start"});
//worker.postMessage({type:"stop"});

function analyze(command,text,randomseed) {
	//by this time, compile has already been called.
	console.log("analyze "+command+" with "+randomseed);
}
