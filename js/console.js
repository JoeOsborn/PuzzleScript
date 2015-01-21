function jumpToLine(i) {

    var code = parent.form1.code;

    var editor = code.editorreference;

    // editor.getLineHandle does not help as it does not return the reference of line.
    editor.scrollIntoView(i - 1 - 10);
    editor.scrollIntoView(i - 1 + 10);
    editor.scrollIntoView(i - 1);
    editor.setCursor(i - 1, 0);
}

var consolecache = [];
function consolePrint(text,urgent,extra) {
	if (urgent===undefined) {
		urgent=false;
	}
	if (cache_console_messages&&urgent==false) {		
		consolecache.push({text:text,extra:extra});
	} else {
		addToConsole(extra ? "<details><summary>"+text+"</summary><p>"+extra+"</p></details>" : text);
	}
}


var cache_n = 0;

function addToConsole(text) {
	cache = document.createElement("div");
	cache.id = "cache" + cache_n;
	cache.innerHTML = text;
	cache_n++;
	
	var code = document.getElementById('consoletextarea');
	code.appendChild(cache);
	consolecache=[];
	var objDiv = document.getElementById('lowerarea');
	objDiv.scrollTop = objDiv.scrollHeight;
}

function consoleCacheDump() {
	if (cache_console_messages===false) {
		return;
	}
	
	var lastline = "";
	var times_repeated = 0;
	var summarised_message = "<br>";
	var this_summary = "", this_details = "";
	for (var i = 0; i < consolecache.length+1; i++) {
		if (i < consolecache.length && consolecache[i].text == lastline) {
			times_repeated++;
			if(consolecache[i].extra) {
				this_details += (times_repeated > 0 ? "<br>" : "") + consolecache[i].extra;
			}
		} else {
			this_summary = lastline;
			if (times_repeated > 0) {
				this_summary = this_summary + " (x" + (times_repeated + 1) + ")";
			}
			if(this_summary.length) {
				summarised_message += "<br>";
				summarised_message += this_details.length ? "<details><summary>"+this_summary+"</summary><p>"+this_details+"</p></details>" : lastline;
			}
			this_details = "";
			times_repeated = 0;
			this_summary = lastline = i < consolecache.length ? consolecache[i].text : "";
			this_details = i < consolecache.length ? (consolecache[i].extra || "") : "";
		}
	}
	
	addToConsole(summarised_message);
}

function consoleError(text) {	
        var errorString = '<span class="errorText">' + text + '</span>';
        consolePrint(errorString,true);
}
function clearConsole() {
	var code = document.getElementById('consoletextarea');
	code.innerHTML = '';
	var objDiv = document.getElementById('lowerarea');
	objDiv.scrollTop = objDiv.scrollHeight;
}

var clearConsoleClick = document.getElementById("clearConsoleClick");
clearConsoleClick.addEventListener("click", clearConsole, false);