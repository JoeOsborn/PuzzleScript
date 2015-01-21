var Utilities = (function() {
	var module = {};
	
	module.getAnnotationValue = function(rules, anno, notFound) {
		var re = /\(\s*@(.*)\s*:\s*(.*)\s*\)/ig;
		var match;
		while(match = re.exec(rules)) {
			if(match[1].toLowerCase() == anno.toLowerCase()) {
				return match[2].trim();
			}
		}
		re = /\(\s*@(.*)\s*\)/ig;
		while(match = re.exec(rules)) {
			if(match[1].toLowerCase() == anno.toLowerCase()) {
				return true;
			}
		}
		return notFound;
	}
	return module;
})();