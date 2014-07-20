self.onmessage = function(msg) {
	if(msg.data.type == "stop") {
		postMessage({"type":"stopped"});
		self.close();
		return;
	}
	postMessage({type:"echo", echo:msg.data});
};
