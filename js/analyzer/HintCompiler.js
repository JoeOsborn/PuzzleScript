//TODO:consider a functional rephrasing where each node calls a function to check the remainder of the sequence. might be simpler, inliner might be able to deal with it.

var global = this;

var HintCompiler = (function() {
	var module = {};
	
	var winningRE = /^winning\b/i;
	var finishedRE = /^finished\b/i;
	var ellipsesRE = /^\.\.\.(?=\s|\))/;
	
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
	var pattern2DRE = /^(2d\s*\n)((?:\s*\S+\s*\n)+)\n/i;
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
			nud:function(tok,stream) { return {parse:tok, stream:stream}; },
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

	//direction, then, ellipses, until, not, or
	
	function isTemporal(parse) {
		//catch then/until/permute
		if(parse.metatype == "temporal") { return true; }
		switch(parse.type) {
			//catch ands & ors with any temporal members
			case "and":
				return anyIsTemporal(parse.value.conjuncts);
			case "or":
				return anyIsTemporal(parse.value.disjuncts);
			case "not":
			case "group":
				return isTemporal(parse.value.contents);
		}
		return false;
	}
	function anyIsTemporal(parses) {
		for(var i = 0; i < parses.length; i++) {
			if(isTemporal(parses[i])) { return true; }
		}
		return false;
	}

	var TOKENS = [
		symbol(winningRE, "winning", "predicate"),
		symbol(finishedRE, "finished", "predicate"),
		symbol(ellipsesRE, "ellipses"),
		{
			type:"then",
			match:matchSymbol(thenRE, "then"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative n-ary operator
				var rhs = parseHint(stream, 1);
				var steps;
				//Re-associating to produce an n-ary operator (in practice, I think we should only hit the second case).
				//Groups will not be distributed through. This is not vital for then's semantics, but it's convenient
				//to consider groups as "inner machines".
				//merge then(then(A,B),then(C,D)) into then(A,B,C,D)
				if(lhs.type == "then" && rhs.parse.type == "then") {
					steps = lhs.value.steps.concat(rhs.parse.value.steps);
				//merge then(then(A,B),C) into then(A,B,C)
				} else if(lhs.type == "then") {
					steps = lhs.value.steps.concat([rhs.parse]);
				//merge then(A,then(B,C)) into then(A,B,C)
				} else if(rhs.parse.type == "then") {
					steps = [lhs].concat(rhs.parse.value.steps);
				//leave merge(A,B) as-is.
				} else {
					steps = [lhs,rhs.parse];
				}
				return {parse:{type:"then", metatype:"temporal", value:{steps:steps}, range:{start:steps[0].range.start,end:steps[steps.length-1].range.end}}, stream:rhs.stream};
			},
			lbp:1
		},
		{
			type:"until",
			match:matchSymbol(untilRE, "until"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative n-ary operator
				var rhs = parseHint(stream, 2);
				var steps;
				//Re-associating to produce an n-ary operator (in practice, I think we should only hit the second case).
				//Groups will not be distributed through. This is important for until's semantics. Groups
				//can be considered as "inner machines".
				//merge until(until(A,B), until(C,D)) into until(A,B,C,D)
				if(lhs.type == "until" && rhs.parse.type == "until") {
					steps = lhs.value.steps.concat(rhs.parse.value.steps);
				//merge until(until(A,B), C) into until(A,B,C)
				} else if(lhs.type == "until") {
					steps = lhs.value.steps.concat([rhs.parse]);
				//merge until(A, until(B,C)) into until(A,B,C)
				} else if(rhs.parse.type == "until") {
					steps = [lhs].concat(rhs.parse.value.steps);
				//leave until(A,B) as-is.
				} else {
					steps = [lhs,rhs.parse];
				}
				for(var si = 0; si < steps.length; si++) {
					if(steps[si].type == "ellipses") {
						throw new Error("Can't put ellipses into an until");
					}
				}
				return {parse:{type:"until", metatype:"temporal", value:{steps:steps}, range:{start:steps[0].range.start,end:steps[steps.length-1].range.end}}, stream:rhs.stream};
			},
			lbp:2
		},
		{
			type:"and",
			match:matchSymbol(andRE, "and"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative n-ary operator
				var rhs = parseHint(stream, 3);
				var conjuncts;
				//Re-associating to produce an n-ary operator (in practice, I think we should only hit the second case).
				//Groups will not be distributed through. This is important for and's semantics. Groups
				//can be considered as "inner machines".
				//merge and(and(A,B), and(C,D)) into and(A,B,C,D)
				if(lhs.type == "and" && rhs.parse.type == "and") {
					conjuncts = lhs.value.conjuncts.concat(rhs.parse.value.conjuncts);
				//merge and(and(A,B), C) into and(A,B,C)
				} else if(lhs.type == "and") {
					conjuncts = lhs.value.conjuncts.concat([rhs.parse]);
				//merge and(A, and(B,C)) into and(A,B,C)
				} else if(rhs.parse.type == "and") {
					conjuncts = [lhs].concat(rhs.parse.value.conjuncts);
				//leave and(A,B) as-is.
				} else {
					conjuncts = [lhs,rhs.parse];
				}
				for(var ci = 0; ci < conjuncts.length; ci++) {
					if(conjuncts[ci].type == "ellipses") {
						throw new Error("Can't put ellipses into an and");
					}
				}
				return {parse:{
					type:"and", 
					metatype:anyIsTemporal(conjuncts) ? "temporal" : "predicate", value:{
						conjuncts:conjuncts
					}, 
					range:{start:conjuncts[0].range.start,end:conjuncts[conjuncts.length-1].range.end}
				}, stream:rhs.stream};
			},
			lbp:3
		},
		{
			type:"or",
			match:matchSymbol(orRE, "or"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative n-ary operator
				var rhs = parseHint(stream, 4);
				var disjuncts;
				//Re-associating to produce an n-ary operator (in practice, I think we should only hit the second case).
				//Groups will not be distributed through. This is important for and's semantics. Groups
				//can be considered as "inner machines".
				//merge or(or(A,B), or(C,D)) into or(A,B,C,D)
				if(lhs.type == "or" && rhs.parse.type == "or") {
					disjuncts = lhs.value.disjuncts.concat(rhs.parse.value.disjuncts);
				//merge or(or(A,B), C) into or(A,B,C)
				} else if(lhs.type == "or") {
					disjuncts = lhs.value.disjuncts.concat([rhs.parse]);
				//merge or(A, or(B,C)) into or(A,B,C)
				} else if(rhs.parse.type == "or") {
					disjuncts = [lhs].concat(rhs.parse.value.disjuncts);
				//leave or(A,B) as-is.
				} else {
					disjuncts = [lhs,rhs.parse];
				}
				for(var di = 0; di < disjuncts.length; di++) {
					if(disjuncts[di].type == "ellipses") {
						throw new Error("Can't put ellipses into an or");
					}
				}
				return {parse:{
					type:"or", 
					metatype:anyIsTemporal(disjuncts) ? "temporal" : "predicate", value:{
						disjuncts:disjuncts
					}, 
					range:{start:disjuncts[0].range.start,end:disjuncts[disjuncts.length-1].range.end}
				}, stream:rhs.stream};
			},
			lbp:4
		},
		{
			type:"not",
			match:function(str,pos) {
				var match = notRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				return {type:"not", metatype:"predicate", value:{}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				var parse = parseHint(stream,5);
				if(parse.parse.type == "ellipses") {
					throw new Error("Can't put ellipses into a not by itself");
				}
				return {parse:{
					type:"not", 
					metatype:isTemporal(parse.parse) ? "temporal" : "predicate", 
					value:{contents:parse.parse}, 
					range:{start:tok.range.start,end:parse.stream.token.range.end}
				}, stream:parse.stream};
			},
			led:noLed,
			lbp:5
		},
		{
			type:"lparen",
			match:matchSymbol(lparenRE, "lparen"),
			nud:function(tok,stream) {
				var parse = parseHint(stream,0);
				var streamPrime = consumeToken(parse.stream);
				if(streamPrime.token.type != "rparen") {
					throw new Error("Missing right paren after parenthesized group");
				}
				if(parse.parse.type == "ellipses") {
					throw new Error("Can't put ellipses into a group by themselves");
				}
				return {parse:{type:"group", metatype:"group", value:{contents:parse.parse}, range:{start:tok.range.start,end:streamPrime.token.range.end}}, stream:streamPrime};
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
			},
			nud:function(tok,stream) {
				return {parse:tok, stream:stream};
			},
			led:noLed
		},
		//non-associative n-ary operator? "permute permute x y z permute a b c" is ambiguous.
		symbol(permuteRE, "permute"),
		{
			type:"direction",
			match:function(str,pos) {
				var match = directionRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var dir = match[0].toLowerCase();
				var dirs = {up:0,left:1,down:2,right:3,action:4};
				var inputDir = (dir in dirs) ? dirs[dir] : -1;
				return {type:"direction", metatype:"predicate", value:{
					direction:dir,
					inputDir:inputDir
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok, stream:stream};
			},
			led:noLed
		},
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
				return {parse:tok, stream:stream};
			},
			led:noLed
		},
		//stringValue(identifierRE, "identifier"),
		{
			type:"pattern2D",
			match:function(str, pos) {
				var match = pattern2DRE.exec(str);
				if(!match) { return null; }
				var preMapLines = match[1].split("\n").length-1;
				//TODO: check that any prefix of spaces is equal on all lines?
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
				return {parse:tok, stream:stream};
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
				return {parse:tok, stream:stream};
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
				return {parse:tok, stream:stream};
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
		//TODO: ensure nothing is to the right (arrow-wise) of a "finished" or a "winning" check
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

	function nextStepStmt(tA,fA) {
		if(tA == null || fA == null) { return new Error("Next steps always have a risk of failure"); }
		return unwindStateStmt("si + 1",tA,fA);
	}

	function storeStateStmt(si0) {
		return "var "+si0+" = si;";
	}
	
	function unwindStateStmt(si0,tA,fA) {
		var main = [
			"si = "+si0+";",
			"level.objects = states[si].state;"
		].concat(tA || []);
		if(!fA) {
			return main.join("\n");
		}
		return ["if(("+si0+") < states.length) {"].
			concat(main).
			concat(["} else {"]).
			concat(fA).
			concat("}").
		join("\n");
	}
	
	var _hintID = 0;
	function consumeHintID() {
		_hintID++;
		return _hintID;
	}
	
	//pred should include "result = ..."
	function evaluatePredicate(pred, rest, trueA, falseA) {
		return pred.concat([
			"if(result) {"
		]).concat(rest(trueA, falseA)).concat([
			"} else {"
		]).concat(falseA).concat([
			"}"
		]);
	}
	
	//Action :: [String]
	//codegen(Hint, (Action x Action -> [String]), Action, Action)
	function codegen(hint, rest, trueA, falseA) {
		var hintID = consumeHintID();
		switch(hint.type) {
			case "group":
				return codegen(hint.value.contents, rest, trueA, falseA);
			case "and":
				/*
				A
					if(result) {
						andRest(trueA, falseA)=B
							andRest()=C
								...rest0
							falseA
					} else {
						falseA
					}
				*/
				var conjuncts = hint.value.conjuncts;
				var si0 = "si0_"+hintID;
				var end = "end_"+hintID;
				var pre = [], updateEnd="";
				if(isTemporal(hint)) {
					pre = ["var "+end+" = si;",storeStateStmt(si0)];
					updateEnd = end+" = "+end+" < si ? si : "+end+";";
				}
				var andRest = function(i) {
					if(i == conjuncts.length) {
						return function(tA,fA) {
							return (isTemporal(conjuncts[i-1]) ? [updateEnd] : []).concat([unwindStateStmt(end)]).concat(rest(tA,fA));
						};
					} else {
						return function(tA,fA) {
							return (isTemporal(conjuncts[i-1]) ? 
								[updateEnd,unwindStateStmt(si0)] : 
								[]).concat(
								codegen(conjuncts[i], andRest(i+1), tA, fA)
							);
						};
					}
				}
				return pre.concat(codegen(conjuncts[0], andRest(1), trueA, falseA));
			case "or":
				var disjuncts = hint.value.disjuncts;
				var anyPassed = "anyPassed_"+hintID;
				var si0 = "si0_"+hintID;
				var store = "", unwind = "";
				if(isTemporal(hint)) {
					store = storeStateStmt(si0);
					unwind = unwindStateStmt(si0);
				}
				var result = ["var "+anyPassed+" = false;",store];
				for(var i = 0; i < disjuncts.length; i++) {
					var thisFailed = "thisFailed_"+hintID+"_"+i;
					// var thisFailedD = false;
					// D
					// 	rest
					// 	thisFailedD = true
					// anyPassed = anyPassed || !thisFailedD
					// unwind
					result = result.concat([
						"var "+thisFailed+" = false;"
					]).concat(codegen(disjuncts[i],rest,trueA,[thisFailed+" = true;"])).concat([
						anyPassed+" = "+anyPassed+" || !"+thisFailed+";",
						isTemporal(disjuncts[i]) ? unwind : ""
					])
				}
				// if(!anyPassed) {
				// 	falseA
				// }
				result = result.concat(["if(!"+anyPassed+") {"]).concat(falseA).concat(["}"]);
				return result;
			case "not":
				var label = "loopNot_"+hintID;
				var occurred = "notOccurred_"+hintID;
				return [
					label+":",
					"do {",
					"var "+occurred+" = false;"
				].concat(
					codegen(hint.value.contents, function(tA,fA) { return tA; }, [occurred+" = true;", "break "+label+";"], [occurred+" = false;", "break "+label+";"])
				).concat([
					"} while(false);",
					"if(!"+occurred+") {"
				]).concat(rest(trueA,falseA)).concat([
					"} else {"
				]).concat(falseA).concat([
					"}"
				]);
				throw new Error("Unsupported hint type (yet!)");
			case "then":
				var steps = hint.value.steps;
				var thenRest = function(i) {
					if(i == steps.length) {
						return rest;
					} else {
						var step = steps[i];
						if(step.type == "ellipses") {
							return function(tA, fA) {
								//consume 0 or more steps
								var si0 = "si0_"+hintID+"_"+i;
								var anyPassed = "anyPassed_"+hintID+"_"+i;
								var thisFailed = "thisFailed_"+hintID+"_"+i;
								var track = [thisFailed+" = true;"];
								var label = "loopEllipses_"+hintID+"_"+i;
								return [
									"var "+anyPassed+" = false;",
									label+":",
									"do {",
									"var "+thisFailed+" = false;",
									storeStateStmt(si0),
								].concat(thenRest(i+1)(tA,track)).concat([
									anyPassed+" = "+anyPassed+" || !"+thisFailed+";",
									unwindStateStmt(si0+" + 1",["continue "+label+";"],["break "+label+";"]),
									"} while(si < states.length);",
									"if(!"+anyPassed+") {"
								]).concat(fA).concat([
									"}"
								]);
							};
						} else {
							return function(tA, fA) { 
								return (i > 0 && steps[i-1].type != "ellipses") ? 
									[nextStepStmt(codegen(step,thenRest(i+1),tA,fA),fA)] : 
									codegen(step,thenRest(i+1),tA,fA);
							};
						}
					}
				}
				return (thenRest(0))(trueA,falseA);
			case "until":
				var steps = hint.value.steps;
				var h0 = steps[0];
				var h1 = steps[1];
				//transform a until b until c ==to==> a until b, rest = b until c
				//this is convenient because it lets us treat only binary untils.
				if(steps.length > 2) {
					return codegen({
						type:"until",
						metatype:"temporal",
						value:{steps:[h0,h1]},
						range:{start:hint.range.start, end:h1.range.end}
					},function(tA, fA) {
						return codegen({
							type:"until",
							metatype:"temporal",
							value:{steps:steps.slice(1)},
							range:{start:hint.range.start, end:steps[steps.length-1].range.end}
						}, rest, tA, fA);
					}, trueA, falseA);
				}
				/*
				anyPassed = false
				label
				do {
					store
					g(B,rest,trueA,[thisFailed=true])
					unwind
					g(A,fn(t,f){t},[step, continue label],[break label])
				} while(si < steps.length);
				if(!anyPassed) {
					falseA
				}
				*/
				var si0 = "si0_"+hintID;
				var anyPassed = "anyPassed_"+hintID;
				var thisFailed = "thisFailed_"+hintID;
				var track = [thisFailed+" = true;"];
				var label = "loopUntil_"+hintID;
				return [
					"var "+anyPassed+" = false;",
					label+":",
					"do {",
					"var "+thisFailed+" = false;",
					storeStateStmt(si0),
				].concat(codegen(h1,rest,trueA,track)).concat([
					anyPassed+" = "+anyPassed+" || !"+thisFailed+";",
					unwindStateStmt(si0)
				]).concat(
					codegen(h0,function(tA,fA){return tA;},
						[unwindStateStmt(si0+1,["continue "+label+";"],["break "+label+";"])],
						["break "+label+";"]
					)
				).concat([
					"} while(si < states.length);",
					"if(!"+anyPassed+") {"
				]).concat(falseA).concat([
					"}"
				]);
			case "finished":
				return evaluatePredicate(["result = si == steps.length-1;"], rest, trueA, falseA);
			case "winning":
				return evaluatePredicate(["result = winning;"], rest, trueA, falseA);
			case "direction":
				switch(hint.value.direction) {
					case "any":
						return evaluatePredicate(["result = true;"], rest, trueA, falseA);
					case "wait":
						return evaluatePredicate(["result = states[si].step == -1;"], rest, trueA, falseA);
					case "input":
						return evaluatePredicate(["result = states[si].step != -1;"], rest, trueA, falseA);
					case "moving":
						return evaluatePredicate(["result = states[si].step >= 0 && states[si].step <= 3;"], rest, trueA, falseA);
					default:
						return evaluatePredicate(["result = states[si].step == "+hint.value.inputDir+";"], rest, trueA, falseA);
				}			
			case "pattern1D":
				throw new Error("Unsupported hint type (yet!)");
			case "pattern2D":
				throw new Error("Unsupported hint type (yet!)");
			case "winCondition":
				throw new Error("Unsupported hint type (yet!)");
			case "fire":
				throw new Error("Unsupported hint type (yet!)");
			default:
				throw new Error("Unsupported hint type");
		}
	}
	
		//
	// function codegen(hint, trueC, falseC, soFar) {
	//
	// 	// Change compilation scheme: compile(Term, TrueContinuation, FalseContinuation), where the second and third arguments, when called, continue the compilation process.
	// 	// Each compilation function should have exactly one root level call to compile.
	// 	//
	// 	// NOT compiles its contents, swapping those two
	// 	// NOT A --
	// 	// 	compile(A, falseContinuation, trueContinuation)
	// 	// OR compiles the first disjunct, passing the trueContinuation as-is, with a falseContinuation that compiles&calls the next disjunct (or the original falseContinuation if none are left);
	// 	// A OR B OR * --
	// 	// 	store
	// 	// 	compile(A, trueContinuation, function(unwind; compile(B,trueContinuation,function(unwind; compile(C,trueContinuation,function(*,trueContinuation,falseContinuation))))))
	// 	// AND compiles the first conjunct, passing the falseContinuation as-is, with a trueContinuation that rewinds & compiles&calls the next conjunct (or the original trueContinuation if none are left, fast forwarding to the longest timepoint);
	// 	// A AND B AND * --
	// 	// 	end = si
	// 	// 	store
	// 	// 	compile(A, function(end = si; unwind; compile(B,function(end = max(end,si); unwind...(while(si < end) { next; } trueContinuation())),falseContinuation)), falseContinuation)
	// 	// A UNTIL B UNTIL * -- == (A UNTIL (B and B UNTIL *))
	// 	// 	label:
	// 	// 	do {
	// 	// 		store;
	// 	// 		compile(B,function(compile(B UNTIL *, trueContinuation, falseContinuation)),function(unwind;compile(A,function(next;continue label),falseContinuation)))
	// 	// 	} while(si < steps.length)
	// 	// ... --
	// 	// 	do { store, trueContinuation(), unwind, next } while(si <= steps.length);
	// 	// 	falseContinuation();
	// 	// A THEN B THEN * --
	// 	// 	compile(A,function(compile(B THEN *,trueContinuation,falseContinuation)),falseContinuation)
	//
	// 	//NOTE: the pure style makes the pre/during/post structure hard to read. should rewrite with explicit assignments? or impure?
	// 	switch(hint.type) {
	// 		hintID = consumeHintID();
	// 		case "group":
	// 			return codegen(hint.value.contents, trueC, falseC, soFar);
	// 		case "not":
	// 			/*
	// 			store
	// 			result = false
	// 			label:
	// 			do {
	// 				Contents
	// 					result = false & break label
	// 					result = true & break label
	// 			} while(false)
	// 			unwind
	// 			if(result)
	// 				trueC
	// 				falseC
	// 			*/
	// 			var loopLabel = "loop_"+hintID;
	// 			var thisResult = "result_"+hintID;
	// 			var shouldStore = isTemporal(hint);
	// 			var store="", unwind="", si0;
	// 			if(shouldStore) {
	// 				si0 = "si0_"+hintID;
	// 				store = storeStateStmt(si0);
	// 				unwind = unwindStateStmt(si0);
	// 			}
	// 			soFar = soFar.concat([
	// 				shouldStore ? "var "+si0+";" : "",
	// 				store,
	// 				"var "+thisResult+" = false;",
	// 				loopLabel+":",
	// 				"do {"
	// 			]);
	// 			soFar = codegen(hint.value.contents,
	// 				//break out of the condition immediately if it yields _any_ verified true or false result
	// 				function(soFar) { return soFar.concat([thisResult+" = false;","break "+loopLabel+";"]); },
	// 				function(soFar) { return soFar.concat([thisResult+" = true;","break "+loopLabel+";"]); },
	// 				soFar
	// 			).concat(["} while(false);", unwind]);
	// 			//if thisResult is true (the inner condition was false), do trueC
	// 			soFar = trueC(soFar.concat(["if("+thisResult+") {"]));
	// 			//otherwise, do falseC
	// 			soFar = falseC(soFar.concat(["} else {"])).concat(["}"]);
	// 			return soFar;
	// 		case "and":
	// 			/*
	// 			A and B and C should give:
	//
	// 			store
	// 			A
	// 				unwind & update-end & B
	// 					unwind & update-end & C
	// 						unwind & update-end & rollout-end & trueC
	// 						unwind & falseC
	// 					unwind & falseC
	// 				unwind & falseC
	// 			unwind & falseC
	// 			*/
	// 			var shouldStore = isTemporal(hint);
	// 			var store = "", unwind = "",
	// 			var si0 = "si0_"+hintID;
	// 			soFar = soFar.concat([
	// 				"var end_"+hintID+" = si;"
	// 			]);
	// 			if(shouldStore) {
	// 				store = storeStateStmt(si0);
	// 				unwind = unwindStateStmt(si0);
	// 				soFar = soFar.concat([
	// 					"var "+si0+";",
	// 					store
	// 				]);
	// 			}
	// 			var unwindFalse = function(soFar) {
	// 				return falseC(soFar.concat(unwind));
	// 			};
	// 			var updateEnd = ["end_"+hintID+" = end_"+hintID+" < si ? si : end_"+hintID+";"];
	// 			var goToEnd = ["while(si < end_"+hintID+") {",nextStepStmt(),"}"];
	// 			var nextConjunctTrueC = function(i) {
	// 				if(i == hint.value.conjuncts.length) {
	// 					return function(soFar) {
	// 						return trueC(soFar.concat(updateEnd).concat(goToEnd));
	// 					}
	// 				}
	// 				return function(soFar) {
	// 					var c = hint.value.conjuncts[i];
	// 					return codegen(c,
	// 						nextConjunctTrueC(i+1),
	// 						unwindFalse,
	// 						soFar.concat(updateEnd).concat(unwind)
	// 					);
	// 				}
	// 			};
	// 			return (nextConjunctTrueC(0))(soFar);
	// 		case "or":
	// 			/*
	// 			control should fall through, and falseC should _only_ be called after every alternative is tried. each alternative should _not_ have the chance to call falseC.
	// 			IOW: A or B or C should give:
	//
	// 			store
	// 			anyPassed = false;
	// 			thisFailed = false;
	// 			A
	// 				trueC
	// 				thisFailed = true;
	// 			unwind
	// 			anyPassed = anyPassed || !thisFailed;
	// 			thisFailed = false;
	// 			B
	// 				trueC
	// 				thisFailed=true;
	// 			unwind
	// 			anyPassed = anyPassed || !thisFailed;
	// 			thisFailed = false;
	// 			C
	// 				trueC
	// 				thisFailed=true;
	// 			anyPassed = anyPassed || !thisFailed;
	// 			if(!anyPassed) { falseC }
	//
	// 			--- The key is that the ONLY way to try "different alternatives higher up" is to fall through. calling falseC is like saying "we are doomed".
	// 			*/
	// 			var shouldStore = isTemporal(hint);
	// 			var store = "", unwind = "",
	// 			var si0 = "si0_"+hintID;
	// 			var anyPassed = "anyPassed_"+hintID;
	// 			soFar = soFar.concat([
	// 				"var "+anyPassed+" = false;"
	// 			]);
	// 			if(shouldStore) {
	// 				store = storeStateStmt(si0);
	// 				unwind = unwindStateStmt(si0);
	// 				soFar = soFar.concat([
	// 					"var "+si0+";",
	// 					store
	// 				]);
	// 			}
	//
	// 			var disjuncts = hint.value.disjuncts;
	// 			for(var i = 0; i < disjuncts.length; i++) {
	// 				var thisFailed = "thisFailed_"+hintID+"_"+i;
	// 				var d = disjuncts[i];
	// 				soFar = codegen(d,trueC,function(soFar) {
	// 					return soFar.concat(["thisFailed = false;"]);
	// 				},soFar.concat("var "+thisFailed+" = false;")).concat([
	// 					unwind,
	// 					anyPassed+" = "+anyPassed+" || !"+thisFailed+";"
	// 				]);
	// 			}
	// 			soFar = soFar.concat([
	// 				"if(!"+anyPassed+") {"
	// 			]);
	// 			soFar = falseC(soFar).concat("}");
	// 			return soFar;
	// 		case "ellipses":
	// 			throw new Error("Unhandled ellipses");
	// 		case "until":
	// 			var steps = hint.value.steps;
	// 			//A until B until C --> A until (B and B until C)
	// 			if(steps.length > 2) {
	// 				return codegen({
	// 					type:hint.value.type,
	// 					metatype:hint.value.metatype,
	// 					value:{steps:[steps[0], {
	// 						type:"and",
	// 						metatype:"temporal",
	// 						value:{conjuncts:[steps[1], {
	// 							type:"until",
	// 							metatype:"temporal",
	// 							value:{steps:steps.slice(1)},
	// 							range:{start:steps[1].range.start,end:steps[steps.length-1].range.end}
	// 						}]},
	// 						range:{start:steps[1].range.start,end:steps[steps.length-1].range.end}
	// 					}]},
	// 					{start:steps[0].range.start,end:steps[steps.length-1].range.end}
	// 				}, trueC, falseC, soFar);
	// 			} else {
	// 				/*
	// 				A until B
	//
	// 				var si0
	// 				var anyPassed = false
	// 				label:
	// 				do {
	// 					var thisFailed = false
	// 					store
	// 					B
	// 						trueC
	// 						thisFailed = true
	// 					unwind
	// 					anyPassed = anyPassed || !thisFailed
	// 					A
	// 						step
	// 						break label
	// 				} while(si < steps.length);
	// 				unwind
	// 				//B never became true -- maybe we ran out of steps, or maybe A became false first
	// 				if(!anyPassed) { falseC }
	// 				*/
	// 				var h0 = steps[0];
	// 				var h1 = steps[1];
	// 				var si0 = "si0_"+hintID;
	// 				var store = storeStateStmt(si0);
	// 				var unwind = unwindStateStmt(si0);
	// 				var label = "loop_"+hintID;
	// 				var anyPassed = "anyPassed_"+hintID;
	// 				var thisFailed = "thisFailed_"+hintID;
	// 				soFar = soFar.concat([
	// 					"var "+si0+";",
	// 					"var "+anyPassed+" = false;",
	// 					label+":",
	// 					"do {",
	// 					"var "+thisFailed+" = false;",
	// 					store
	// 				]);
	// 				soFar = codegen(h0,
	// 					trueC,
	// 					function(soFar) { return soFar.concat([thisFailed+" = true;"]); },
	// 					soFar
	// 				);
	// 				soFar = soFar.concat([
	// 					unwind,
	// 					anyPassed+" = "+anyPassed+" || !"+thisFailed+";"
	// 				]);
	// 				soFar = codegen(h1,
	// 					function(soFar) { return soFar.concat([nextStepStmt()]); },
	// 					function(soFar) { return soFar.concat(["break "+label+";"]); },
	// 					soFar
	// 				);
	// 				soFar = soFar.concat([
	// 					"} while(si < states.length);",
	// 					unwind,
	// 					"if(!"+anyPassed+") {"
	// 				]);
	// 				soFar = falseC(soFar);
	// 				return soFar.concat(["}"]);
	// 			}
	// 		case "then":
	// 			/*
	// 			A then B
	// 			A
	// 				step & B
	// 					trueC
	// 					falseC
	// 				falseC
	//
	// 			...
	// 				si0
	// 				anyPassed = false
	// 				do {
	// 					thisFailed = false
	// 					store
	// 					trueC(falseC\{thisFailed=true})
	// 					unwind
	// 					anyPassed = anyPassed || thisFailed
	// 					step
	// 				} while(si < steps.length)
	// 				if(!anyPassed) { falseC }
	//
	// 			FIXME: BUT! I'm not totally sure this will work with (A then ...) and C -- let's experiment.
	// 			*/
	// 			var steps = hint.value.steps;
	// 			var nextStepTrueC = function(i,fc) {
	// 				if(i >= steps.length) { return trueC; }
	// 				var s = steps[i];
	// 				return function(soFar) {
	// 					if(s.type == "ellipses") {
	// 						//consume 0...K inputs then proceed
	// 						var si0 = "si0_"+hintID+"_"+i;
	// 						var store = storeStateStmt(si0);
	// 						var unwind = unwindStateStmt(si0);
	// 						var anyPassed = "anyPassed_"+hintID+"_"+i;
	// 						var thisFailed = "thisFailed_"+hintID+"_"+i;
	// 						soFar = soFar.concat([
	// 							"var "+si0+";",
	// 							"do {",
	// 							thisFailed+" = false;",
	// 							store
	// 						]);
	// 						var thisFailedC = function(soFar) {
	// 							return soFar.concat([thisFailed+" = true;"]);
	// 						};
	// 						soFar = (nextStepTrueC(i+1,thisFailedC))(soFar);
	// 						soFar = soFar.concat([
	// 							unwind,
	// 							anyPassed + " = "+ anyPassed + " || "+thisFailed;
	// 							nextStepStmt(),
	// 							"} while(si < steps.length);",
	// 							"if(!"+anyPassed+") {",
	// 							fc,
	// 							"}"
	// 						]);
	// 					} else {
	// 						return codegen(s,
	// 							nextStepTrueC(i+1,fc),
	// 							fc,
	// 							soFar.concat([nextStepStmt()])
	// 						)
	// 					}
	// 				}
	// 			};
	// 			return (nextStepTrueC(0,falseC))(soFar);
	// 		case "winning":
	// 			return evaluatePredicate("result = winning;", trueC, falseC, soFar);
	// 		case "finished":
	// 			return evaluatePredicate("result = finished;", trueC, falseC, soFar);
	// 		case "direction":
	// 			switch(hint.value.direction) {
	// 				case "any":
	// 					return evaluatePredicate("result = true;", trueC, falseC, soFar);
	// 				case "wait":
	// 					return evaluatePredicate("result = states[si].step == -1;", trueC, falseC, soFar);
	// 				case "input":
	// 					return evaluatePredicate("result = states[si].step != -1;", trueC, falseC, soFar);
	// 				case "moving":
	// 					return evaluatePredicate("result = states[si].step >= 0 && states[si].step <= 3;", trueC, falseC, soFar);
	// 				default:
	// 					return evaluatePredicate("result = states[si].step == "+hint.value.inputDir+";", trueC, falseC, soFar);
	// 			}
	// 		case "pattern1D":
	// 		case "pattern2D":
	// 		case "fire":
	// 		case "winCondition":
	// 		default:
	// 			throw new Error("Unhandled hint type "+hint.type);
	// 	}
	// }
	//
	// //pred MUST assign to result
	// function evaluatePredicate(pred, trueC, falseC, soFar) {
	// 	soFar = soFar.concat([pred, "if(result) {"]);
	// 	soFar = trueC(soFar);
	// 	soFar = soFar.concat(["} else {"]);
	// 	soFar = falseC(soFar);
	// 	soFar = soFar.concat(["}"]);
	// 	return soFar;
	// }
	//
	// function compileHintPart(tabs,hint,body,post) {
	// 	switch(hint.type) {
	// 		//NOTE: anywhere "do a step" or "runCompleteStep(step)" appears below, that's a step plus again loops.
	// 		case "literal":
	// 			body.push.apply(body,hint.value.body.map(function(str) { return tabs+str; }));
	// 			post.unshift.apply(post,hint.value.post.map(function(str) { return tabs+str; }));
	// 			return tabs+hint.value.tabs;
	// 		case "then":
	// 			//include left hint's compiled form. if result == false or si == steps.length, fail; if result == true, do a step(si++), then insert the right hint (it might change result to false)
	// 			var steps = hint.value.steps;
	// 			for(var i = 0; i < steps.length; i++) {
	// 				var step = steps[i];
	// 				if(step.type == "ellipses") {
	// 					/*
	// 					var $si0 = si;
	// 					label:
	// 					do {
	// 						$$storeState
	// 						result = true;
	//
	// 						REST
	//
	// 						unwind to $si0;
	// 						$si0++;
	// 						$$nextStep
	// 					} while($si0 < steps.length);
	// 					*/
	// 					var si0 = gensym("si0",step);
	// 					var mysid = sid;
	// 					sid++;
	// 					body.push(
	// 						tabs+"var "+si0+" = si;",
	// 						tabs+si0+":",
	// 						tabs+"do {",
	// 						//TODO: don't store/unwind if REST is non-temporal
	// 						storeStateStmt(tabs+"\t",si0,mysid),
	// 						//set result to true (it might have been set false on a previous trip through)
	// 						tabs+"\tresult = true;",
	// 						tabs+"\t//next hint part"
	// 					);
	// 					//the rest of the machine will slide in right here. then...:
	// 					post.unshift(
	// 						unwindStateStmt(tabs+"\t",si0,mysid),
	// 						nextStepStmt(tabs+"\t"),
	// 						tabs+"} while("+si0+" < steps.length);"
	// 					);
	// 					sid++;
	// 				} else {
	// 					/*
	// 					STEPS[i]
	// 					if(result) {
	// 						$$nextStep
	//
	// 						REST
	//
	// 					}
	// 					*/
	// 					tabs = compileHintPart(tabs,steps[i],body,post);
	// 					body.push(
	// 						tabs+"if("+(negations % 2 == 0 ? "" : "!")+"result) {"
	// 					);
	// 					if(i < steps.length -1 && steps[i+1].type != "ellipses") {
	// 						body.push(nextStepStmt(tabs+"\t"));
	// 					}
	// 					body.push(tabs+"\t//next hint part");
	// 					//the rest of the machine will slide in right here. then...:
	// 					post.unshift(
	// 						tabs+"}"
	// 					);
	// 				}
	// 				tabs = tabs + "\t";
	// 			}
	// 			break;
	// 		case "until":
	// 			/* X until Y until Z
	// 			(Y then (Y until Z)) or (X then (Y then Z)) or (X then (Y then Y then Z)) or ... (X then X then (Y then Z)) or...
	//
	// 			on finding a successful X
	// 				move forward until reaching Y
	// 					on finding a successful Y
	// 						move forward until reaching Z
	// 							on finding a successful Z
	// 								succeed
	// 					else fail (find the next X)
	// 				else fail
	//
	// 				else Y is false so retry up one
	//
	// 			(a or (a then b)) until c --> [a b c] should pass.
	//
	// 			var si0, si00
	// 			do {
	// 				si0 = si
	// 				$$store
	// 				(si == si0 || LHS)
	// 					RHS
	// 						REST
	// 				$$rewind
	// 				$$next
	// 			} while(si0 < steps.length)
	//
	// 			a until b then c
	// 			[a ab ab c]
	//
	// 			[a b X] -- attempt 1
	// 			[a a b c] -- attempt 2
	//
	// 			it's cleanest if we take the first match only
	//
	// 			(a until ((c then d) OR b)) then d
	// 			[a bc d]
	//
	// 			NOPE, got to take all the matches. :x
	// 			*/
	//
	// 			for(var i = 0; i < steps.length-1; i++) {
	// 				var lhs = steps[i];
	// 				var rhs = steps[i+1];
	// 				var si0 = gensym("si0",lhs);
	// 				var si00 = gensym("si00",lhs);
	// 				var mysid = sid;
	// 				sid++;
	// 				body.push(
	// 					tabs+"var "+si00+" = si;",
	// 					tabs+"var "+si0+" = si;",
	// 					tabs+"do {",
	// 					tabs+si0+" = si;",
	// 					storeStateStmt(tabs,si0,mysid)
	// 				);
	// 				post.unshift(
	// 					unwindStateStmt(tabs+"\t",si0,mysid),
	// 					nextStepStmt(tabs+"\t"),
	// 					tabs+"} while("+si0+" < steps.length);"
	// 				);
	// 				tabs = tabs + "\t";
	// 				tabs = compileHintPart(tabs, {type:"or", metatype:"temporal", value:{disjuncts:[
	// 					{type:"literal",metatype:"predicate",value:{body:["si0==si00"],post:[],tabs:""}},
	// 					lhs
	// 				]}}, body, post);
	// 				//slide in the RHS
	// 				tabs = compileHintPart(tabs, rhs, body, post);
	// 				//rest of machine slides in here
	// 			}
	// 			//
	// 			//
	// 			//
	// 			// /*
	// 			// var $si0 = si;
	// 			// $si0:
	// 			// do {
	// 			//
	// 			// 	$$storeState
	// 			// 	STEPS[i+1]
	// 			// 		if(result) {
	// 			// 			REST
	// 			// 		}
	// 			// 		$$unwindState
	// 			//
	// 			// 		STEPS[i]
	// 			// 			if(result) {
	// 			// 				//bail out if STEPS[i] does not hold
	// 			// 				break;
	// 			// 			}
	// 			// 		$$nextStep //always nextStep, even if STEPS[i] is an arrow.
	// 			// 	 	//a b a b a b c --> (a then b) until c. the "a then b" moves the cursor to the b, then it gets moved again.
	// 			// } while($si0 < steps.length);
	// 			// */
	// 			// var steps = hint.value.steps;
	// 			// for(var i = 0; i < steps.length-1; i++) {
	// 			// 	var step = steps[i];
	// 			// 	var nextStep = steps[i+1];
	// 			// 	var si0 = gensym("si0",step);
	// 			// 	var mysid = sid;
	// 			// 	sid++;
	// 			// 	body.push(
	// 			// 		tabs+"var "+si0+" = si;",
	// 			// 		tabs+si0+":",
	// 			// 		tabs+"do {",
	// 			// 		//TODO: don't store/unwind if STEPS[i+1] is non-temporal and REST is non-temporal
	// 			// 		storeStateStmt(tabs+"\t",si0,mysid),
	// 			// 		//set result to true (it might have been set false on a previous trip through)
	// 			// 		tabs+"\tresult = true;",
	// 			// 		tabs+"\t//until RHS "+si0
	// 			// 	);
	// 			// 	var oldTabs = tabs;
	// 			// 	var preBody = [oldTabs+"\t//until LHS "+si0], prePost = [];
	// 			// 	var lhsTabs = compileHintPart(oldTabs+"\t",step,preBody,prePost);
	// 			// 	//FIXME: this is wrong. consider "(a OR (a then b)) until c" and "[a,b,c]".
	// 			// 	preBody.push(
	// 			// 		lhsTabs+"if(result) {",
	// 			// 		nextStepStmt(lhsTabs+"\t"),
	// 			// 		lhsTabs+"\tcontinue "+si0+";",
	// 			// 		lhsTabs+"} else {",
	// 			// 		lhsTabs+"\tbreak "+si0+";",
	// 			// 		lhsTabs+"}"
	// 			// 	);
	// 			// 	post.unshift.apply(post,
	// 			// 		preBody.concat(prePost).concat([
	// 			// 			unwindStateStmt(oldTabs+"\t",si0,mysid)
	// 			// 		]).
	// 			// 		concat([
	// 			// 			oldTabs+"\tif(!result) { break "+si0+"; }",
	// 			// 			oldTabs+"} while("+si0+" < steps.length);"
	// 			// 		])
	// 			// 	);
	// 			//
	// 			// 	tabs = compileHintPart(tabs+"\t",nextStep,body,post);
	// 			// 	body.push(
	// 			// 		tabs+"if(result) { //next hint part "+si0
	// 			// 	);
	// 			// 	//the rest of the machine will slide in right here. then...:
	// 			// 	post.unshift(tabs+"} //end hint part "+si0);
	// 			// 	tabs = tabs + "\t";
	// 			// }
	// 			//in a loop:
	// 			//  include right hint's compiled form.
	// 			//    if result==true, succeed & break
	// 			//    if result==false:
	// 			//      include left hint's compiled form.
	// 			//      if result==true and si < steps.length, do a step(si++) and continue in the loop
	// 			//      if result==false, fail
	// 			break;
	// 		case "group":
	// 			body.push(tabs+"//begin group");
	// 			post.unshift(tabs+"//end group");
	// 			tabs = compileHintPart(tabs, hint.value.contents, body, post);
	// 			break;
	// 		case "ellipses":
	// 			throw new Error("Ellipses not handled by an arrow.");
	// 			break;
	// 		case "direction":
	// 			//succeed if checkfn body succeeds
	// 			switch(hint.value.direction) {
	// 				case "any":
	// 					body.push(tabs+"result = true;");
	// 					break;
	// 				case "wait":
	// 					body.push(tabs+"result = steps[si-1] == -1;");
	// 					break;
	// 				case "input":
	// 					body.push(tabs+"result = steps[si-1] != -1;");
	// 					break;
	// 				case "moving":
	// 					body.push(tabs+"result = steps[si-1] >= 0 && steps[si-1] <= 3;");
	// 					break;
	// 				default:
	// 					body.push(tabs+"result = steps[si-1] == "+hint.value.inputDir+";");
	// 					break;
	// 			}
	// 			break;
	// 		case "winning":
	// 			body.push(tabs+"result = winning;");
	// 			break;
	// 		case "finished":
	// 			body.push(tabs+"result = (si == steps.length);");
	// 			break;
	// 		case "and":
	// 			var conjuncts = hint.value.conjuncts;
	// 			var targetTimeVar = "target_"+hint.range.start.line+"_"+hint.range.start.ch;
	// 			var si0 = gensym("si0_cjn",hint);
	// 			if(hint.metatype == "temporal") {
	// 				body.push(
	// 					tabs+"var "+targetTimeVar+" = si;",
	// 					tabs+"var "+si0+" = si;"
	// 				);
	// 			}
	// 			for(var i = 0; i < conjuncts.length; i++) {
	// 				if(isTemporal(conjuncts[i])) {
	// 					/*
	// 					si0=si
	// 					store
	// 					c_1
	// 						target = si
	// 						if(result) {
	// 							rewind
	// 							c_2
	// 								target = max(target,si)
	// 								if(result) {
	// 									...
	// 									c_i
	// 										target = max(target,si)
	// 										if(result) {
	// 											while(si < target) {
	// 												$$nextStep
	// 											}
	// 											REST
	// 										}
	// 								}
	// 						}
	// 					*/
	// 					if(i < conjuncts.length-1) {
	// 						var mysid = sid;
	// 						sid++;
	// 						body.push(
	// 							storeStateStmt(tabs,si0,mysid)
	// 						);
	// 					}
	// 					tabs = compileHintPart(tabs, conjuncts[i], body, post);
	// 					body.push(
	// 						tabs+targetTimeVar+" = (si > "+targetTimeVar+") ? si : "+targetTimeVar+";"
	// 					);
	// 					if(i < conjuncts.length-1) {
	// 						body.push(unwindStateStmt(tabs,si0,mysid));
	// 					}
	// 				} else {
	// 					//$$conjuncts[i]
	// 					//if(result) {
	// 							// REST
	// 					//}
	// 					tabs = compileHintPart(tabs, conjuncts[i], body, post);
	// 					body.push(tabs+"if(result) {");
	// 					post.unshift(tabs+"}");
	// 					tabs = tabs + "\t";
	// 				}
	// 			}
	// 			if(hint.metatype == "temporal") {
	// 				body.push(
	// 					tabs+"while(si < "+targetTimeVar+") {",
	// 					nextStepStmt(tabs+"\t"),
	// 					tabs+"}"
	// 				);
	// 			}
	// 			//Rest of the machine slides in here (a big open conditional)
	// 			break;
	// 		case "or":
	// 			/*
	// 			$$store
	// 			c_1
	// 				REST
	// 		  if(!result) {
	// 		  	$$rewind
	// 			}
	// 			c_2
	// 				REST
	// 			...
	// 			*/
	// 			problem: REST needs to be inserted many times. how to deal with that?
	//
	// 			throw new Error("Or not supported yet");
	// 			break;
	// 		case "not":
	// 			if(hint.value.useLookahead) {
	// 				push store state to body
	// 			}
	// 			switch(hint.value.contents.type) {
	// 				case "not":
	// 					tabs = compileHintPart(tabs, hint.value.contents.value.contents, body, post);
	// 					break;
	// 				case "group":
	// 					tabs = compileHintPart(tabs, {
	// 						type:"not",
	// 						metatype:hint.metatype,
	// 						value:{
	// 							contents:hint.value.contents.value.contents,
	// 							useLookahead:false
	// 						},
	// 						range:hint.range
	// 					})
	// 					break;
	// 				case "and":
	// 					tabs = compileHintPart(tabs, {
	// 						type:"or",
	// 						metatype:hint.value.contents.metatype,
	// 						value:{
	// 							disjuncts:hint.value.contents.conjuncts.map(function(d) {
	// 								return {
	// 									type:"not",
	// 									metatype:anyIsTemporal(hint.value.contents.conjuncts) ? "temporal" : "predicate",
	// 									value:{contents:d, useLookahead:false},
	// 									range:d.range
	// 								};
	// 							})
	// 						}
	// 						range:hint.range
	// 					}, body, post);
	// 					break;
	// 				case "or":
	// 					tabs = compileHintPart(tabs, {
	// 						type:"and",
	// 						metatype:hint.value.contents.metatype,
	// 						value:{
	// 							conjuncts:hint.value.contents.disjuncts.map(function(d) {
	// 								return {
	// 									type:"not",
	// 									metatype:anyIsTemporal(hint.value.contents.disjuncts) ? "temporal" : "predicate",
	// 									value:{contents:d, useLookahead:false},
	// 									range:d.range
	// 								};
	// 							})
	// 						}
	// 						range:hint.range
	// 					}, body, post);
	// 					break;
	// 				case "then":
	// 					//not (A then B) -- (not A) or (A then not B)
	// 					// distribute not. a then of length K goes into a K-disjunction of thens:
	// 					var disjuncts = [];
	// 					var steps = hint.value.contents.value.steps;
	// 					var thisDisjunct, theseSteps;
	// 					for(var i = 0; i < steps.length; i++) {
	// 						thisDisjunct = {
	// 							type:"then",
	// 							metatype:"temporal",
	// 							value:{steps:theseSteps},
	// 							range:steps[i].range
	// 						}
	// 						for(var j = 0; j < i; j++) {
	// 							//j then...
	// 							theseSteps.push(steps[j]);
	// 						}
	// 						//not i
	// 						theseSteps.push({
	// 							type:"not",
	// 							metatype:isTemporal(steps[i]) ? "temporal" : "predicate",
	// 							value:{contents:steps[i]}
	// 							range:steps[i].range
	// 						})
	// 						disjuncts.push(thisDisjunct);
	// 					}
	// 					tabs = compileHintPart(tabs, {
	// 						type:"or",
	// 						metatype:"temporal", //definitely temporal, since (nearly) each disjunct is a "then"
	// 						value:{
	// 							disjuncts:disjuncts
	// 						}
	// 						range:hint.range
	// 					}, body, post);
	// 					break;
	// 				case "until":
	// 					//handle until specially:
	// 					/*
	// 					for steps lhs=i, rhs=i+1
	// 					loop:
	// 					do {
	// 						not rhs
	// 							not lhs
	// 								REST
	// 							$$nextStep
	// 							continue loop;
	// 						break loop;
	// 					} while(si < steps.length);
	// 					*/
	// 					var steps = hint.value.contents.value.steps;
	// 					for(var i = 0; i < steps.length-1; i++) {
	// 						var loopLabel = gensym("not_until",hint);
	// 						body.push(tabs+loopLabel+":");
	// 						body.push(tabs+"do {");
	// 						post.unshift(
	// 							tabs+"\tbreak "+loopLabel+";",
	// 							tabs+"while(si < steps.length);"
	// 						)
	// 						tabs = compileHintPart(tabs, {
	// 							type:"not",
	// 							metatype:isTemporal(rhs) ? "temporal" : "predicate",
	// 							value:{contents:rhs},
	// 							range:rhs.range
	// 						}, body, post);
	// 						post.unshift(
	// 							nextStepStmt(tabs),
	// 							tabs+"\tcontinue "+loopLabel+";",
	// 						)
	// 						tabs = compileHintPart(tabs, {
	// 							type:"not",
	// 							metatype:isTemporal(lhs) ? "temporal" : "predicate",
	// 							value:{contents:lhs},
	// 							range:lhs.range
	// 						}, body, post);
	// 						//rest slides in here
	// 					}
	// 					break;
	// 				default:
	// 					if(isTemporal(hint.value.contents)) {
	// 						throw new Error("Uh oh, doing a poorly-founded negation");
	// 					}
	// 					tabs = compileHintPart(tabs, hint.value.contents, body, post);
	// 					body.push(tabs+"result = !result;");
	// 					break;
	// 			}
	// 			if(hint.value.useLookahead) {
	// 				push unwind state to body
	// 			}
	//
	// 			// if(hint.metatype == "temporal") {
	// 			// 	/*
	// 			// 	store state?
	// 			// 	loop: do{
	// 			// 		BODY
	// 			// 	while(false); ///acts as a "goto fail" to support NOTs of loopy things
	// 			// 	result = !result;
	// 			// 	unwind?
	// 			// 	REST
	// 			//
	// 			// 	Semantics: NOT always takes the shortest option? No, that sucks....
	// 			//
	// 			// 	(not (... then a)) then b
	// 			// 	"not-a-sequence-ending-with-a followed by a b"
	// 			// 	[a c a c b]
	// 			// 	[a c X] -- attempt 1
	// 			// 	[a c a c B}] -- attempt 2
	// 			//
	// 			// 	this means the "break" trick can't be used since the inner nondeterminacy needs to do its loopy thing. I need to put an "} else { REST " on every "if (result) {...}" check within the scope of the NOT...
	// 			// 	*/
	// 			// 	var si0, mysid;
	// 			// 	var lookahead = hint.value.useLookahead;
	// 			// 	if(lookahead) {
	// 			// 		si0 = gensym("si0",hint.value.contents); //lookahead
	// 			// 		mysid = sid; //lookahead
	// 			// 		sid++; //lookahead
	// 			// 	}
	// 			// 	body.push(
	// 			// 		tabs+"//begin NOT",
	// 			// 		lookahead ? tabs+"var "+si0+" = si;" : "", //lookahead
	// 			// 		lookahead ? storeStateStmt(tabs,si0,mysid) : "" //lookahead
	// 			// 	);
	// 			// 	var preBody = [], prePost = [];
	// 			// 	var contentTabs = compileHintPart(tabs, hint.value.contents, preBody, prePost);
	// 			// 	body.push.apply(body,
	// 			// 		[
	// 			// 		  tabs+si0+"_not:",
	// 			// 		  tabs+"do {"
	// 			// 		].
	// 			// 		concat(preBody).concat([contentTabs+"break "+si0+"_not;"]).concat(prePost).
	// 			// 		concat([
	// 			// 			tabs+"while(false);",
	// 			// 			lookahead ? unwindStateStmt(tabs,si0,mysid) : "", //lookahead
	// 			// 			tabs+"result = !result;",
	// 			// 			tabs+"//end NOT"
	// 			// 		])
	// 			// 	);
	// 			// 	//rest of the machine goes here
	// 			//
	// 			// //not a
	// 			// } else {
	// 			// 	/*
	// 			// 		BODY
	// 			// 			result = !result;
	// 			// 		REST
	// 			// 	*/
	// 			// 	tabs = compileHintPart(tabs, hint.value.contents, body, post);
	// 			// 	body.push(tabs+"result = !result;");
	// 			// }
	// 			break;
	// 		default:
	// 			logError("Can't handle this kind of hint yet:"+JSON.stringify(hint));
	// 			break;
	// 	}
	// 	return tabs;
	// }
	//
	function prettify(str) {
		var tabs = "";
		var lines = str.split("\n");
		var li = 0;
		do {
			var line = lines[li].trim();
			if(line.length == 0) {
				lines.splice(li,1);
				//try again
			} else {
				if(line.indexOf("}") == line.length-1 || line.indexOf("}") == 0) {
					tabs = tabs.substr(0, tabs.length-1);
				}
				line = tabs + line;
				lines[li] = line;
				if(line.indexOf("{") == line.length-1) {
					tabs = tabs + "\t";
				}
				li++;
			}
		} while(li < lines.length);
		return lines.join("\n");
	}
	
	module.compileHintBody = function compileHintBody(str,pos) {
		hintID = 0;
		var result = parseHint({token:null,string:str,position:pos}, 0);
		var hint = result.parse;
		//drop the )
		result.remainder = result.stream.string.substring(result.stream.string.indexOf(")")+1);
		//now, compile to a function which ensures the hint is valid, starting from some arbitrary initial state.
		var hintFnPre = [
			"var initObjects = level.objects;",
			"var si = 0;"
		];
		var hintFnPost = [
			"level.objects = initObjects;",
			"return false;", 
			"}"
		];
		/*
		Change compilation scheme: compile(Term, TrueContinuation, FalseContinuation), where the second and third arguments, when called, continue the compilation process.
		Each compilation function should have exactly one root level call to compile.
		
		NOT compiles its contents, swapping those two
		NOT A --
			compile(A, falseContinuation, trueContinuation)
		OR compiles the first disjunct, passing the trueContinuation as-is, with a falseContinuation that compiles&calls the next disjunct (or the original falseContinuation if none are left);
		A OR B OR * --
			store
			compile(A, trueContinuation, function(unwind; compile(B,trueContinuation,function(unwind; compile(C,trueContinuation,function(*,trueContinuation,falseContinuation))))))
		AND compiles the first conjunct, passing the falseContinuation as-is, with a trueContinuation that rewinds & compiles&calls the next conjunct (or the original trueContinuation if none are left, fast forwarding to the longest timepoint);
		A AND B AND * --
			end = si
			store
			compile(A, function(end = si; unwind; compile(B,function(end = max(end,si); unwind...(while(si < end) { next; } trueContinuation())),falseContinuation)), falseContinuation)
		A UNTIL B UNTIL * -- == (A UNTIL (B and B UNTIL *))
			label:
			do {
				store;
				compile(B,function(compile(B UNTIL *, trueContinuation, falseContinuation)),function(unwind;compile(A,function(next;continue label),falseContinuation)))
			} while(si < steps.length)
		... -- 
			do { store, trueContinuation(), unwind, next } while(si <= steps.length);
			falseContinuation();
		A THEN B THEN * --
			compile(A,function(compile(B THEN *,trueContinuation,falseContinuation)),falseContinuation)
		
		Handle indendation ONLY via pretty printing.
		*/
		var generated = codegen(hint,
			function(tA, fA) { return ["if(si == states.length-1) {"].concat(tA).concat(["} else {"]).concat(fA).concat(["}"]); },
			["if(!matchFn || !matchFn()) {",
				"level.objects = initObjects;",
				"return true;",
				"}"
			],
			[]
		);
		var hintFn = prettify(["function hint_"+pos.line+"(states, matchFn) {","console.log('hint');"].concat(hintFnPre).concat(generated).concat(hintFnPost).join("\n"));
		try {
			global.eval(hintFn+"\n");
		} catch(e) {
			console.log(hintFn);
			throw e;
		}
		result.hint = {
			match:global["hint_"+pos.line]
		};
		return result;
	}

	return module;
})();