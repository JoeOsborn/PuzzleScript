//TODO:consider a functional rephrasing where each node calls a function to check the remainder of the sequence. might be simpler, inliner might be able to deal with it.

var global = this;

var HintCompiler = (function() {
	var module = {};
	
	var winningRE = /^winning\b/i;
	var finishedRE = /^finished\b/i;
	var ellipsesRE = /^([0-9]+)?\.\.\.(infinity|[0-9]+)?(?=\s|\))/;
	
	var thenRE = /^(then|\,)\b/i;
	var untilRE = /^until\b/i;
	var andRE = /^(and|\&)\b/i;
	var orRE = /^(or|\|)\b/i;
	var notRE = /^(not|\~)\b/i;
	var impliesRE = /^(implies|\=\>)\b/i;
	var iffRE = /^(iff|\<\=\>)\b/i;
	var lparenRE = /^\(/;
	var rparenRE = /^\)/;
	var spaceRE = /\s+/;
	var permuteRE = /^permute\b/i;
	
	//move: up or down or left or right
	//input: up or down or left or right or act
	//any: up or down or left or right or act or wait
	var directionRE = /^(up|down|left|right|\^|\>|\<|v|moving|action|x|input|wait|any)\b/i;
	//(at Pos)? 2d ...
	var pattern2DRE = /^(2d\s*\n)((?:\s*\S+\s*\n)+)\n/i;
	//(at Pos)? Dir? [rule]
	var pattern1DRE = /^(?:(up|down|left|right|horizontal|vertical)\b)?\[([^\]]*)\]/i;

	var winConditionRE = /^(?:(?:(no|some)\s+(\S+)(?:\s+on\s+(\S+))?)|(?:all\s+(\S+)\s+on\s+(\S+))|(?:(at least|at most|exactly)?\s+([0-9]+)\s+(\S+)(?:\s+on\s+(\S+))?))/i;

	var fireRE = /^fire(?:\s+(up|down|left|right|horizontal|vertical|any))?\s+(\w+)(?:\s+(at least|at most|exactly)?\s+([0-9]+)\s+times)?\b/i;
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
		{
			type:"ellipses",
			match:function(str,pos) {
				var match = ellipsesRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var min = match[1] ? parseInt(match[1]) : 0;
				var max = match[2] ? (match[2].toLowerCase() == "infinity" ? Number.MAX_VALUE : parseInt(match[2])) : Number.MAX_VALUE;
				if(isNaN(min)) { throw new Error("Invalid minimum on bounded ellipses"); }
				if(isNaN(max)) { throw new Error("Invalid maximum on bounded ellipses"); }
				return {type:"ellipses", metatype:"temporal", value:{
					minLength:min,
					maxLength:max
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok, stream:stream};
			},
			led:noLed,
			lbp:0
		},
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
				var rhs = parseHint(stream, 5);
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
			lbp:5
		},
		{
			type:"or",
			match:matchSymbol(orRE, "or"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative n-ary operator
				var rhs = parseHint(stream, 6);
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
			lbp:6
		},
		{
			type:"implies",
			match:matchSymbol(impliesRE, "implies"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				//left-associative n-ary operator
				var rhs = parseHint(stream, 3);
				return {parse:{
					type:"implies", 
					metatype:anyIsTemporal([lhs,rhs.parse]) ? "temporal" : "predicate", value:{
						lhs:lhs,
						rhs:rhs.parse
					}, 
					range:{start:lhs[0].range.start,end:rhs.parse.range.end}
				}, stream:rhs.stream};
			},
			lbp:3
		},
		{
			type:"iff",
			match:matchSymbol(iffRE, "iff"),
			nud:noNud,
			led:function(tok,stream,lhs) {
				var rhs = parseHint(stream, 4);
				return {parse:{
					type:"iff", 
					metatype:anyIsTemporal([lhs,rhs.parse]) ? "temporal" : "predicate", value:{
						lhs:lhs,
						rhs:rhs.parse
					}, 
					range:{start:lhs[0].range.start,end:rhs.parse.range.end}
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
				var parse = parseHint(stream,7);
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
			lbp:7
		},
		//n-ary operator. "permute permute x y z permute a b c" is ambiguous. Let's say it's right associative: permute (permute x y z) (permute a b c)
		//permute a then b then c d --> permute (a then b then c) d
		{
			type:"permute",
			match:function(str,pos) {
				var match = permuteRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				return {type:"permute", metatype:"predicate", value:{}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				var conjuncts = [];
				//permute A B C --> ((... then A) and (... then B) and (... then C))
				var parse;
				do {
					parse = parseHint(stream,0);
					if(parse.parse.type == "ellipses") {
						throw new Error("Can't put ellipses into a permute by itself");
					}
					//Since permute reads a series of specs, we have to stop it
					//from crashing into the extra ) at the end of the spec string.
					var streamPrime = consumeToken(parse.stream);
					if(streamPrime.token.type == "rparen") {
						break;
					}
					//TODO: these ranges aren't really correct... might make debugging annoying.
					conjuncts.push({
						type:"then",
						metatype:"temporal",
						value:{
							steps:[
								{type:"ellipses",metatype:"keyword",value:"ellipses",range:parse.parse.range},
								parse.parse
							]
						},
						range:parse.parse.range
					});
					stream = parse.stream;
				} while(true);
				return {parse:{
					type:"and",
					metatype:"temporal",
					value:{conjuncts:steps}, 
					range:{start:tok.range.start,end:parse.stream.token.range.end}
				}, stream:parse.stream};
			},
			led:noLed,
			lbp:0
		},
		{
			type:"lparen",
			match:matchSymbol(lparenRE, "lparen"),
			nud:function(tok,stream) {
				var parse = parseHint(stream,0);
				if(parse.parse.type == "ellipses") {
					throw new Error("Can't put ellipses into a group by themselves");
				}
				var streamPrime = consumeToken(parse.stream);
				if(streamPrime.token.type != "rparen") {
					throw new Error("Missing right paren after parenthesized group");
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
					condition = (match[6] || "exactly").toLowerCase();
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
					condition:condition,
					target:state.objectMasks[targetObj],
					on:state.objectMasks[onObj],
					count:count
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok, stream:stream};
			},
			led:noLed,
			lbp:0
		},
		{
			type:"direction",
			match:function(str,pos) {
				var match = directionRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var dir = match[0].toLowerCase();
				var dirs = {up:0,left:1,down:2,right:3,action:4};
				dirs["^"] = dirs.up;
				dirs["<"] = dirs.left;
				dirs["v"] = dirs.down;
				dirs[">"] = dirs.right;
				dirs["x"] = dits.action;
				var inputDir = (dir in dirs) ? dirs[dir] : -1;
				return {type:"direction", metatype:"predicate", value:{
					direction:dir,
					inputDir:inputDir
				}, range:{start:pos,end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok, stream:stream};
			},
			led:noLed,
			lbp:0
		},
		{
			type:"fire",
			match:function(str,pos) {
				var match = fireRE.exec(str);
				if(!match) { return null; }
				var endPos = {line:pos.line, ch:pos.ch + match[0].length};
				var direction = match[1] || "any", rule=match[2], condition = (match[3] || "exactly").toLowerCase(), count = match[4] || -1;
				return {type:"fireCondition", metatype:"predicate", value:{
					rule:rule,
					direction:direction,
					condition:condition,
					count:count
				}, range:{start:pos, end:endPos}, length:match[0].length};
			},
			nud:function(tok,stream) {
				return {parse:tok, stream:stream};
			},
			led:noLed,
			lbp:0
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
				if(fakeState.rules.length > 1) {
					throw new Error("More rule groups than expected!");
				}
				for(var i = 0; i < fakeState.rules[0].length; i++) {
					if(fakeState.rules[0][i].patterns.length != 1) {
						throw new Error("A 1D pattern had more than one pattern!");
					}
				}
				return {type:"pattern1D", metatype:"predicate", value:{
					rules:fakeState.rules[0]
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
					// D
					// 	rest --> passed=true
					// unwind
					result = result.concat(codegen(disjuncts[i],rest,[anyPassed+" = true;"].concat(trueA),[])).concat([
						isTemporal(disjuncts[i]) ? unwind : ""
					])
				}
				// if(!passed) {
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
								var label = "loopEllipses_"+hintID+"_"+i;
								var minLength = hint.value.minLength;
								var maxLength = hint.value.maxLength;
								var ellipsesEnd = "ellipsesEnd"+hintID+"_"+i;
								return unwindStateStmt("si + "+minLength, 
									[
										"var "+anyPassed+" = false;",
										"var "+ellipsesEnd+" = "+(maxLength == Number.MAX_VALUE ? "states.length-1" : "si+"+maxLength)+";",
										label+":",
										"do {",
										storeStateStmt(si0),
									].concat(thenRest(i+1)([anyPassed+" = true;"].concat(tA),[])).concat([
										unwindStateStmt(si0+" + 1",["continue "+label+";"],["break "+label+";"]),
										"} while(si <= "+ellipsesEnd+");",
										"if(!"+anyPassed+") {"
									]).concat(fA).concat([
										"}"
									]),
									falseA
								);
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
				//it's equivalent to "a until (b and b until c)", but we implicitly encode the AND with the call to codegen.
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
					g(B,rest,passed=true&trueA,[])
					unwind
					g(A,fn(t,f){t},[step, continue label],[break label])
				} while(si < steps.length);
				if(!anyPassed) {
					falseA
				}
				*/
				var si0 = "si0_"+hintID;
				var anyPassed = "anyPassed_"+hintID;
				var label = "loopUntil_"+hintID;
				return [
					"var "+anyPassed+" = false;",
					label+":",
					"do {",
					storeStateStmt(si0),
				].concat(codegen(h1,rest,[anyPassed+" = true;"].concat(trueA),[])).concat([
					unwindStateStmt(si0)
				]).concat(
					codegen(h0,function(tA,fA){return tA;},
						[unwindStateStmt(si0+"+ 1",["continue "+label+";"],["break "+label+";"])],
						["break "+label+";"]
					)
				).concat([
					"} while(si < states.length);",
					"if(!"+anyPassed+") {"
				]).concat(falseA).concat([
					"}"
				]);
			case "implies":
				//a => b ---> (not a) or b
				var lhs = hint.value.lhs;
				var rhs = hint.value.rhs;
				var temporal = isTemporal(hint);
				return codegen({
					type:"or",
					metatype:temporal,
					value:{
						disjuncts:[
							{
								type:"not",
								metatype:isTemporal(lhs),
								value:{contents:lhs},
								range:lhs.range
							},
							rhs
						]
					},
					range:hint.range
				}, rest, trueA, falseA);
			case "iff":
				//a <=> b ---> (a => b) and (b => a)
				var lhs = hint.value.lhs;
				var rhs = hint.value.rhs;
				var temporal = isTemporal(hint);
				return codegen({
					type:"and",
					metatype:temporal,
					value:{conjuncts:[
						{
							type:"implies",
							metatype:temporal,
							value:{lhs:lhs, rhs:rhs},
							range:hint.range
						},
						{
							type:"implies",
							metatype:temporal,
							value:{lhs:rhs, rhs:lhs},
							range:hint.range
						}
					]},
					range:hint.range
				}, rest, trueA, falseA);
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
				var anyTrue = "p1d_anyTrue_"+hintID;
				var checks = ["var "+anyTrue+" = false;"];
				for(var i = 0; i < hint.value.rules.length; i++) {
					var rule = hint.value.rules[i];
					//We know that these kinds have rule have only one pattern.
					var matchFn = "hint_"+hint.range.start.line+"_"+hintID+"_p1d_match_"+i;
					compileMatchFunction(state, matchFn, rule, 0);
					checks = checks.concat(generateMatchLoops("p1d_"+hintID+"_"+i+"_",rule,[matchFn],
						function occ(_prefix, _rule, _indices, _ks) {
							return rest([anyTrue+" = true;"].concat(trueA), []);
						}
					));
				}
				return checks.concat(["if(!"+anyTrue+") {"]).concat(falseA).concat(["}"]);
			case "pattern2D":
				//TODO: this			
				throw new Error("Unsupported hint type (yet!) " + hint.type);
			case "winCondition":
				var idx = "winCondition_i_"+hintID;
				var failed = "winCondition_failed_"+hintID;
				var f1 = hint.value.target;
				var f2 = hint.value.on;
				var checks1 = "("; //target is not there
				var checks2 = "("; //object is not there
				for(var i = 0; i < STRIDE_OBJ; i++) {
					//!(data[i] & arr[i]) && !(data[i+1] & r[i+1]) && ...
					checks1 = checks1 + "!("+f1.data[i]+" & level.objects["+idx+"*STRIDE_OBJ+"+i+"])" + (i < STRIDE_OBJ - 1 ? " && " : ")");
					checks2 = checks2 + "!("+f2.data[i]+" & level.objects["+idx+"*STRIDE_OBJ+"+i+"])" + (i < STRIDE_OBJ - 1 ? " && " : ")");
				}
				var label = "winCondition_loop_"+hintID;
				switch(condition) {
					case "no":
						return [
							"var "+failed+" = false;",
							"for(var "+idx+" = 0; "+idx+" < level.n_tiles; "+idx+"++) {",
							"if(!"+checks1+" && !"+checks2+") {", //target is there and on is there
							failed+" = true;",
						].concat(falseA).concat([
							"break;", //TODO: constructive negation of no X on Y?
							"}",
							"}",
							"if(!"+failed+") {"
						]).concat(rest(trueA, falseA)).concat([
							"}"
						]);
					case "some":
						return [
							"var "+failed+" = true;",
							"for(var "+idx+" = 0; "+idx+" < level.n_tiles; "+idx+"++) {",
							"if(!"+checks1+" && !"+checks2+") {", //target is there and on is there
						].concat(rest([failed+" = false;"].concat(trueA), [])).concat([
							"}",
							"}",
							"if("+failed+") {"
						]).concat(falseA).concat([
							"}"
						]);
					case "all":
						return [
							"var "+failed+" = false;",
							"for(var "+idx+" = 0; "+idx+" < level.n_tiles; "+idx+"++) {",
							"if(!"+checks1+" && "+checks2+") {", //target is there and on is _not_ there
							failed+" = true;",
						].concat(falseA).concat([
							"break;", //TODO: constructive negation of all X on Y?
							"}",
							"}",
							"if(!"+failed+") {"
						]).concat(rest(trueA, falseA)).concat([
							"}"
						]);
					case "at least":
					case "at most":
					case "exactly":
						var count = "winCondition_count_"+hintID;
						var targetCount = hint.value.count;
						var countChecks = {
							"at least":count+" >= "+targetCount,
							"at most":count+" <= "+targetCount,
							"exactly":count+" == "+targetCount
						};
						return [
							"var "+count+" = 0;",
							"for(var "+idx+" = 0; "+idx+" < level.n_tiles; "+idx+"++) {",
							"if(!"+checks1+" && !"+checks2+") {", //target is there and on is there
							count+"++;",
							"}",
							"}",
							"if("+countChecks[condition]+") {"
						].concat(rest(trueA, falseA)).concat([
							"} else {"
						]).concat(falseA).concat([
							"}"
						]);
					default:
						throw new Error("Unsupported win condition " + hint.value.condition);
				}
			case "fire":
				throw new Error("Unsupported hint type (yet!) " + hint.type);
			default:
				throw new Error("Unsupported hint type " + hint.type);
		}
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
		var generated = codegen(hint,
			function(tA, fA) { return ["if(si == states.length-1) {"].concat(tA).concat(["} else {"]).concat(fA).concat(["}"]); },
			[
				"if(!matchFn || !matchFn()) {",
				"level.objects = initObjects;",
				"return true;",
				"}"
			],
			[]
		);
		var hintFn = prettify(["function hint_"+pos.line+"(states, matchFn) {","console.log('hint');"].concat(hintFnPre).concat(generated).concat(hintFnPost).join("\n"));
		evalCode(hintFn);
		result.hint = {
			match:global["hint_"+pos.line]
		};
		return result;
	}

	return module;
})();