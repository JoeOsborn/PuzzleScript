var Utilities = (function() {
	var module = {};
	
	module.RC_CATEGORY_WIN = "rc-win";
	module.RC_CATEGORY_INTERACTIVE = "rc-interactive";
	
	module.incrementRuleCount = function incrementRuleCount(counts,lev,cat,ruleGroup,ruleIndex) {
		if(!counts[lev]) {
			counts[lev] = {};
		}
		if(!counts[lev][cat]) {
			counts[lev][cat] = [];
		}
		if(!counts[lev][cat][ruleGroup]) {
			counts[lev][cat][ruleGroup] = [];
		}
		if(!counts[lev][cat][ruleGroup][ruleIndex]) {
			counts[lev][cat][ruleGroup][ruleIndex] = 0;
		}
		counts[lev][cat][ruleGroup][ruleIndex]++;
	};
	module.getEntry = function getEntry(counts,lev,cat,ruleGroup,ruleIndex) {
		if(!counts) { return 0; }
		if(!counts[lev]) { return 0; }
		if(!counts[lev][cat]) { return 0; }
		if(!counts[lev][cat][ruleGroup]) { return 0; }
		if(!counts[lev][cat][ruleGroup][ruleIndex]) { return 0; }
		return counts[lev][cat][ruleGroup][ruleIndex];
	}
	return module;
})();