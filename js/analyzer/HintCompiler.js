var HintCompiler = (function() {
	var module = {};
	
	var winningRE = /^winning\b/i;
	var ellipsesRE = /^\.\.\./;
	
	var thenRE = /^then\b/i;
	var untilRE = /^until\b/i;
	var andRE = /^and\b/i;
	var orRE = /^or\b/i;
	var notRE = /^not\b/i;
	var lparenRE = /^\(/;
	var rparenRE = /^\)/;

	var winConditionRE = /^(?:(?:(no|some)\s+(\S+)(?:\s+on\s+(\S+))?)|(?:all\s+(\S+)\s+on\s+(\S+))|(?:(at least|at most|exactly)\s+([0-9]+)\s+(\S+)(?:\s+on\s+(\S+))?))/i;

	var spaceRE = /\s+/;
	var permuteRE = /^permute\b/i;
	
	//move: up or down or left or right
	//input: up or down or left or right or act
	//any: up or down or left or right or act or wait
	var directionRE = /^(up|down|left|right|moving|action|input|wait|any)\b/i;
	var pattern2DRE = /^(2d\s*\n)((?:\S+\s*\n)+)\n/i;
	var pattern1DRE = /^((?:up|down|left|right|horizontal|vertical)\b)?\[([^\]]*)\]/i;

	//TODO: put at least/at most/exactly into fireRE?
	var fireRE = /^fire\s+(\w+)(?:\s+(up|down|left|right|horizontal|vertical|any))?(?:\s+([0-9]+)\s+times)?\b/i;
	var intRE = /^0|(?:[1-9][0-9]*)/;
	var identifierRE = /^\w+\b/;
	
	function matchSymbol(re, name, metatype) {
		return function(str, pos) {
			var match = re.exec(str);
			if(!match) { return null; }
			var endPos = {line:pos.line, ch:pos.ch + match[0].length};
			return {type:name, metatype:metatype || "keyword", value:match[0], range:{start:pos,end:endPos}, length:match[0].length};
		};
	}
	
	function symbol(re, name, metatype) {
		return {
			type:name,
			match:matchSymbol(re,name,metatype),
			nud:function(tok,stream) { return {parse:tok, stream:stream}; },
			led:noLed,
			lbp:0
		};
	}

	function stringValue(re, name, metatype) {
		return {
			type:name,
			match:function(str, pos) {
				var match = re.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				return {type:name, metatype:metatype || "value", value:match[0].toLowerCase(), range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) { return {parse:tok.value, stream:stream}; },
			led:noLed,
			lbp:0
		}
	}
	
	function noNud(tok,stream) {
		throw new Error(tok.type+" has no null denotation");
	}
	
	function noLed(tok,stream,parse) {
		throw new Error(tok.type+" has no left denotation");
	}

	//start with: ellipses, then, direction.

	var TOKENS = [
		symbol(winningRE, "winning", "predicate"),
		symbol(ellipsesRE, "ellipses"),
		{
			type:"then",
			match:matchSymbol(thenRE, "then"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative operator
				var rhs = parseHint(stream, 1);
				return {parse:{type:"then", metatype:"temporal", steps:[lhs,rhs.parse]}, stream:rhs.stream};
			},
			lbp:1
		},
		{
			type:"until",
			match:matchSymbol(untilRE, "until"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative operator
				var rhs = parseHint(stream, 1);
				return {parse:{type:"until", metatype:"temporal", steps:[lhs,rhs.parse]}, stream:rhs.stream};
			},
			lbp:1
		},
		symbol(andRE, "and"),
		symbol(orRE, "or"),
		symbol(notRE, "not"),
		{
			type:"lparen",
			match:matchSymbol(lparenRE, "lparen"),
			nud:function(tok,stream) {
				var parse = parseHint(stream,0);
				var streamPrime = consumeToken(parse.stream);
				if(streamPrime.token.type != "rparen") {
					throw new Error("Missing right paren after parenthesized group");
				}
				return {parse:parse.parse, stream:streamPrime};
			},
			led:noLed,
			lbp:0
		},
		symbol(rparenRE, "rparen"),
		{
			type:"winCondition",
			match:function(str,pos) {
				var match = winConditionRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var condition, targetObj, onObj = "background", count=-1;
				if(match[1]) {//some or no
					condition = match[1].toLowerCase();
					targetObj = match[2].toLowerCase();
					if(match[3]) {//on Y
						onObj = match[3].toLowerCase();
					}
				} else if(match[4]) {//all
					condition = "all";
					targetObj = match[4].toLowerCase();
					onObj = match[5].toLowerCase();
				} else if(match[6]) {//at least/at most/exactly
					condition = match[6].toLowerCase();
					count = parseInt(match[7]);
					targetObj = match[8].toLowerCase();
					if(match[8]) { //on Y
						onObj = match[9].toLowerCase();
					}
				}
				if(!condition || !targetObj || !onObj) {
					//Should probably never get here, since the regex matched in the first place.
					throw new Error("Invalid win condition at beginning of "+str);
				}
				if(!(targetObj in state.objectMasks)) {
					logError('unwelcome term "' + targetObj +'" found in win condition. Win conditions objects have to be objects or properties (defined using "or", in terms of other properties)', pos.line);
					throw new Error('unwelcome term "' + targetObj +'" found in win condition. Win conditions objects have to be objects or properties (defined using "or", in terms of other properties)');
				}
				if(!(onObj in state.objectMasks)) {
					logError('unwelcome term "' + onObj +'" found in win condition. Win conditions objects have to be objects or properties (defined using "or", in terms of other properties)', pos.line);
					throw new Error('unwelcome term "' + onObj +'" found in win condition. Win conditions objects have to be objects or properties (defined using "or", in terms of other properties)');
				}
				var filter1 = state.objectMasks[targetObj];
				var filter2 = state.objectMasks[onObj];
				return {type:"winCondition", metatype:"predicate", value:{
					/*check: function() {
						switch(condition) {
							case "no":
							{
								for (var i=0;i<level.n_tiles;i++) {
									var cell = level.getCellInto(i,_o10);
									if ( (!filter1.bitsClearInArray(cell.data)) &&  
										 (!filter2.bitsClearInArray(cell.data)) ) {
										return false;
									}
								}
								return true;
							}
							case "some":
							{
								for (var i=0;i<level.n_tiles;i++) {
									var cell = level.getCellInto(i,_o10);
									if ( (!filter1.bitsClearInArray(cell.data)) &&  
										 (!filter2.bitsClearInArray(cell.data)) ) {
										return true;
									}
								}
								return false;
							}
							case "all":
							{
								for (var i=0;i<level.n_tiles;i++) {
									var cell = level.getCellInto(i,_o10);
									if ( (!filter1.bitsClearInArray(cell.data)) &&  
										 (filter2.bitsClearInArray(cell.data)) ) {
										return false;
									}
								}
								return true;
							}
							case "at least":
							case "at most":
							case "exactly":
							{
								var actualCount = 0;
								for (var i=0;i<level.n_tiles;i++) {
									var cell = level.getCellInto(i,_o10);
									if ( (!filter1.bitsClearInArray(cell.data)) &&  
										 (filter2.bitsClearInArray(cell.data)) ) {
										actualCount++;
									}
								}
								if(condition == "exactly") { return actualCount == count; }
								if(condition == "at most") { return actualCount <= count; }
								if(condition == "at least") { return actualCount >= count; }
								return false;
							}
						}
						return false;
					},*/
					condition:condition,
					target:state.objectMasks[targetObj],
					on:state.objectMasks[onObj],
					count:count
				}, range:{start:pos,end:endPos}, length:match[0].length};
			}
		}
		symbol(noRE, "no"),
		symbol(allRE, "all"),
		symbol(someRE, "some"),
		symbol(onRE, "on"),
		symbol(permuteRE, "permute"),
		{
			type:"direction",
			match:function(str,pos) {
				var match = re.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var dir = match[0].toLowerCase();
				var dirs = {up:0,left:1,down:2,right:3,action:4};
				var inputDir = (dir in dirs) ? dirs[dir] : -1;
				return {type:name, metatype:"predicate", value:{
					/*
					var checkFn;
					switch(dir) {
						case "any":
							checkFn = function() { return true; };
							break;
						case "wait":
							checkFn = function() { return lastInputDir == -1; };
							break;
						case "input":
							checkFn = function() { return lastInputDir >= 0; };
							break;
						case "moving":
							checkFn = function() { return lastInputDir >= 0 && lastInputDir <= 3; };
							break;
						default:
							checkFn = function() { return lastInputDir == inputDir; };
							break;
					}					
					check:checkFn,*/
					direction:dir,
					inputDir:inputDir
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok.value, stream:stream};
			},
			led:noLed
		{
			type:"fire",
			match:function(str,pos) {
				var match = fireRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var rule=match[1], direction = match[2] || "any", count = match[3] || -1;
				return {type:"fireCondition", metatype:"predicate", value:{
					rule:rule,
					direction:direction,
					count:count
				}, range:{start:pos, end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok.value, stream:stream};
			},
			led:noLed
		}
		stringValue(identifierRE, "identifier"),
		{
			type:"pattern2D",
			match:function(str, pos) {
				var match = pattern2DRE.exec(str);
				if(!match) { return null; }
				var preMapLines = match[1].split("\n").length-1;
				var lines = match[2].split("\n").map(function(levLine) { return levLine.trim(); });
				var firstRealLine, firstRealLinePos;
				var realLines = [];
				for(var l = 0; l < lines.length; l++) {
					if(lines[l] == "") { continue; }
					if(!firstRealLine) { firstRealLine = lines[l]; }
					var linePos = {line:pos.line+l+preMapLines,ch:0};
					firstRealLinePos = linePos;
					realLines.push(l);
					if(lines[l].length != firstRealLine.length) {
						throw new Error("Invalid 2d pattern: "+lines[l]+"("+linePos+") of length "+lines[l].length+"; should have length "+firstRealLine.length+" to match first line "+firstRealLine+" ("+firstRealLinePos+")");
					}
				}
				var endPos = {line:pos.line+preMapLines+lines.length, ch:0};
				return {type:"pattern2D", metatype:"predicate", value:{
					//check:compile2DPattern(firstRealLinePos.line, realLines),
					pattern:realLines
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok, stream) {
				return {parse:tok.value, stream:stream};
			},
			led:noLed,
			lbp:0
		},
		{
			type:"pattern1D",
			match:function(str, pos) {
				//parse a string that could turn into a rule's LHS
				var match = pattern1DRE.exec(str);
				if(!match) { return null; }
				var lines = match[0].split("\n");
				var endPos = {line:pos.line + lines.length - 1, ch:lines[lines.length-1].length};
				var fakeState = {
					rules:[[match[0].toLowerCase(),pos.line,match[0]]],
					loops:[],
					propertiesDict:state.propertiesDict,
					names:state.names,
					propertiesSingleLayer:state.propertiesSingleLayer,
					synonymsDict:state.synonymsDict,
					aggregatesDict:state.aggregatesDict,
					collisionLayers:state.collisionLayers,
					objects:state.objects,
					objectMasks:state.objectMasks,
					layerMasks:state.layerMasks,
					playerMask:state.playerMask
				};
				//use the existing compiler machinery!
				rulesToArray(fakeState);
				removeDuplicateRules(fakeState);
				rulesToMask(fakeState);
				arrangeRulesByGroupNumber(fakeState);
				collapseRules(fakeState.rules);
				if(fakeState.ruleGroups.length > 1) {
					throw new Error("More rule groups than expected!");
				}
				return {type:"pattern1D", metatype:"predicate", value:{
					//compileRules(fakeState, fakeState.rules, "hint_"+pos.line+"_"+pos.ch);
					//check:function() { return fakeState.rules[0].anyMatchesFn(fakeState.rules[0]); },
					rule:fakeState.rules[0]
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok, stream) {
				return {parse:tok.value, stream:stream};
			},
			led:noLed,
			lbp:0
		},
		{
			type:"int",
			match:function(str, pos) {
				var match = intRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				return {type:"int", metatype:"value", value:parseInt(match[1]), range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok, stream) {
				return {parse:tok.value, stream:stream};
			},
			led:noLed,
			lbp:0
		},
		symbol(spaceRE, "space")
	];
	var NUDS = {};
	var LEDS = {};
	var LBPS = {};
	for(var ti = 0; ti < TOKENS.length; ti++) {
		NUDS[TOKENS[ti].type] = TOKENS[ti].nud;
		LEDS[TOKENS[ti].type] = TOKENS[ti].led;
		LBPS[TOKENS[ti].type] = TOKENS[ti].lbp;
	}
	
	function nextToken(str,pos) {
		var token;
		for(var ti = 0; ti < TOKENS.length; ti++) {
			token = TOKENS[ti].match(str,pos);
			if(token) {
				return token;
			}
		}
		throw new Error("Invalid token at ("+JSON.stringify(pos)+") in \n"+JSON.stringify(str));
	}
	
	function consumeToken(stream) {
		var token, str = stream.string, pos = stream.position;
		do {
			token = nextToken(str, pos);
			str = str.substring(token.length);
			pos = token.range.end;
		} while(token.type == "space");
		return {token:token, string:str, position:pos};
	}
	
	function parseHint(stream,rbp) {
		if(rbp == undefined) { rbp = 0; }
		/*
    t,stream = consumeToken(stream)
    p,stream = parseLeft(t,stream)
    t,stream' = consumeToken(stream)
    if t == rparen return p,stream' //???
    while t && prec < precedence(t)
      p,stream = parseRight(t,stream')
      t,stream' = nextToken(stream)
    return p, stream
		*/
		//str also includes everything after the hint, so be careful!
		var streamPrime;
		stream = consumeToken(stream);
		var leftStream = NUDS[stream.token.type](stream.token,stream);
		var parse = leftStream.parse;
		if(!parse) {
			throw new Error("No valid parse at "+JSON.stringify(stream));
		}
		stream = leftStream.stream;
		streamPrime = consumeToken(stream);
		while(rbp < LBPS[streamPrime.token.type]) {
			var right = LEDS[streamPrime.token.type](streamPrime.token,streamPrime,parse);
			stream = right.stream;
			parse = right.parse;
			if(!parse) {
				throw new Error("No valid parse at "+JSON.stringify(stream));
			}
			streamPrime = consumeToken(stream);
		}
		return {parse:parse, stream:stream};
		/*
		Hint := 
		   TimeHint then TimeHint [tightness 1]
		 | Hint and Hint [tightness 2]
		 | Hint or Hint [tightness 3]
		 | not Hint [tightness 4]
		 | (Hint) [tightness infinity]
		 | WinCondition [tightness 5]
		 | permute Hint Hint Hint [tightness 0]
		 | repeatedly Hint [tightness 0.5]
		 | Direction [tightness 5]
		 | 2DPattern [tightness 5]
		 | RulePattern [tightness 5]
		 | fire Rule Direction Times [tightness 5]
		 | fire Rule Direction [tightness 5]
		 | fire Rule Times [tightness 5]
		 | fire Rule [tightness 5]
		TimeHint :=
		   ... [tightness 5]
		 | Hint
		*/
	}
	module.parseHint = parseHint;
	
	var AGAIN_LIMIT = 100;
	
	module.compileHintBody = function compileHintBody(str,pos) {
		var result = parseHint({token:null,string:str,position:pos}, 0);
		var hint = result.parse;
		//drop the )
		result.remainder = result.remainder.substring(result.remainder.indexOf(")")+1);
		//now, compile to a function which ensures the hint is valid, starting from some arbitrary initial state.
		var hintFn = [
			"function hint_"+pos.line+"(steps) {", 
			"\treturn false;",	
			// 	for(var i = 0; i < steps.length && i < hint.length; i++) {
			// 		var step = steps[i];
			// 		var hintStep = hint[i];
			// 		if(hintStep.move == CODE_DOTDOTDOT) {
			// 			if(i == hint.length - 1) { return true; }
			// 			for(var k = 0; k < steps.length - i; k++) {
			// 				if(hintMatches_(steps.slice(i+k), hint.slice(i+1))) {
			// 					return true;
			// 				}
			// 			}
			// 			return false;
			// 		} else if(hintStep.move == CODE_ANY_MOVE) {
			//
			// 		} else if(step != hintStep.move) {
			// 			return false;
			// 		}
			// 		var again = 0;
			// 		processInput(step,false,false,null,false,true);
			// 		while(againing && again <= AGAIN_LIMIT) {
			// 			processInput(-1,false,false,null,false,true);
			// 			//TODO: detect loops
			// 			again++;
			// 		}
			// 		if(again >= AGAIN_LIMIT) {
			// 			error("Too many again loops!");
			// 		}
			// 		if(!stateMatches(hintStep.state)) {
			// 			return false;
			// 		}
			// 		if(winning && i == steps.length - 1 && i == hint.length - 1) {
			// 			return true;
			// 		}
			// 	}
			// 	//Ran out of hint.
			// 	return false;
			// }
			"}"].
		join("\n");
		var ctx = {};
		//TODO: try/catch/logError
		ctx.eval(hintFn+"\n");
		result.hint = {
			match:ctx["hint_"+pos.line]
		};
		return result;
	}

	return module;
})();