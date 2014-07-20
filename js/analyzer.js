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

function analyze(command,text,randomseed) {
	//by this time, compile has already been called.
	console.log("analyze "+command+" with "+randomseed);
}
