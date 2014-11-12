var testLocalGames = [
	"atlas shrank",
	"blockfaker",
	"bouncers",
	"byyourside",
	"cakemonsters",
	"castlemouse",
	"chaos wizard",
	"collapse",
	"color chained",
	"constellationz",
	"cratopia",
	"cute train",
	"diesinthelight",
	"dropswap",
	"dungeonjanitor",
	"ebony and ivory",
	"equestrianarmageddon",
	"gobble_rush",
	"heroes_of_sokoban",
	"heroes_of_sokoban_2",
	"heroes_of_sokoban_3",
	"icecrates",
	"kettle",
	"ledchallenge",
	"legend of zokoban",
	"limerick",
	"lovendpieces",
	"lunar_lockout",
	"m c eschers armageddon",
	"manic_ammo",
	"mazezam",
	"microban",
	"midas",
	"modality",
	"naughtysprite",
	"nekopuzzle",
	"notsnake",
	"octat",
	"ponies jumping synchronously",
	"push",
	"puzzles",
	"riverpuzzle",
	"robotarm",
	"scriptcross",
	"slidings",
	"smother",
	"sok7",
	"sokoban_basic",
	"sokoban_horizontal",
	"sokoban_match3",
	"sokoban_sticky",
	"sokobond demake",
	"stick_candy_puzzle_saga",
	"sumo",
	"take heart lass",
	"the_saga_of_the_candy_scroll",
	"threes",
	"tiny treasure hunt",
	"tunnel rat",
	"whaleworld",
	"wordgame",
	"wrappingrecipe",
	"zenpuzzlegarden"
];
var testRemoteGames = [
	// //gallery
	// "eb0f9102f85b5ea536b1", //singleton traffic
	// "9440559", //Pants, Shirt, Cap
	// "ee4c36def9a6847d6308", //Space valet
	// "f2d0ac09901841f6fdb8", //Instrumenta di Superi
	// "6877929", //explod
	// "6887338", //dang im huge
	// "6902186", //take heart lass
	// "9675998", //closure demake
	// "7324598", //flying kick
	// "11359118", //beam islands
	// "cffeb1b80f76458b742a", //aaaah! i'm being attacked by a giant tentacle!
	// "11345687", //you're pulleying my leg
	// //draknek
	// "9098676", //pirate game
	// "219a7db6511dad557b84", //mirror isles
	// "3845c2a534e0c860dde2", //coin drop puzzle
	// "c06feb492ab44b937639", //a sneeze a day keeps the crates away
	// "e3e444f7c63fb21b6ec0", //cyber lasso
	// "9027730", //Happy Birthday Hennell: Sokoban Edition 2014
	// //forum
	// "8cbe871f8c0d59fab93b", //honey giants
	// "4e0d1c8757978c897b93", //pumpkin smasher
	// "6850739", //run at sign run
	// "6893197", //little dungeons
	// "6906829", //nethack sokoban
	// "6906808", //the trouble with toasters
	// "6913806", //dark maze 3
	// "6925815", //super treasure pirate puzzle
	// "6883021", //scriptcross
	// "6926001", //diamond mine
	// "6950063", //bombs away
	// "6958388", //mow problems
	// "6957504", //hitori
	// "6888445", //portalscript
	// "6983124", //Paaaaaaac-maaaaaaaaaan
	// "6999675", //ball smash blocks
	// "7009206", //magical shoe adventure
	// "7012014", //P[+]SITIVE ~ NEG[-]TIVE
	// "6925166", //Leo
	// "6980172", //Telekin (beta)
	// "7019377", //Snakeoban
	// "7002729", //illuminate
	// "7062958", //Impetus
	// "7126625", //Shoving
	// "7093907", //mirror bounce
	// "7093901", //space expedition
	// "7093980", //the nuevo asylum
	// "7093902", //sharks eating palm trees
	// "7110091", //bug exterminator
	// "7044599", //velocity castle
	// "7178156", //cave story demake
	// "7176470", //it is pitch dark
	// "7057589", //soko-bine
	// "6985280", //Pipes!
	// "7195427", //The gods await me
	// "6997771", //RZGX Bad Copy
	// "7189898", //Indie Mod-4 Love
	// "6875392", //Pontoluvian StraightJacket Puzzle
	// "6896687", //There is no-one to help you
	// "7222153", //hero
	// "7132066", //cave explorer
	// "7261648", //palette
	// "7256241", //sheeple
	// "7260153", //the shields of power
	// "7255864", //bouapha's candle quest
	// "7093917", //dragon quest
	// "7285472", //power block
	// "7033604", //8.68-HACK
	// "7328771", //D-Day
	// "7348685", //A cog's life
	// "6957166", //ice breaker
	// "7420380", //bat loves lava shark
	// "7401686", //mandy crush
	// "7445850", //variations on sokoban
	// "7499595", //magnetron
	// "7536360", //sokoslam
	// "7242443", //spooky pumpkin game
	// "7511684", //aperture science sokoban testing initiative
	// "d18f805191aaec31905d", //snow
	// "03ef528b3ab5b8706b20", //sticky v0.901
	// "a6fcfa7742e88667c923", //the great emu war
	// "774ee1a536ef8263680f", //handle with care
	// "79ab868f806885adb0af", //colour + colour
	// "7838234", //neutralize
	// "7982020", //cooperacing
	// "7851076", //bloxyd
	// "7998213", //the initiate's spell
	// "7997709", //1-2-3-Ban
	// "8123164", //Santa's great escape
	// "8278387", //graded sir
	// "8315260", //four color theorem
	// "7714572", //cancel
	// "8835996", //rocketman
	// "8837998", //rocketmen
	// "8488576", //the dragon's cave
	// "8426932", //castle duck!
	// "65fdad48226e7fde41e9", //all together
	// "7998287", //tall grass
	// "8540011", //miss direction
	// "8947085", //tipover
	// "9023954", //the observable universe
	// "7239913", //heavy sword
	// "ac003a3b7e159dd54eb8", //boxes and balloons
	// "47f443db6973d820383f", //sokochrome
	// "97b970807330876c9171", //floor painter
	// "68d640ad0d3ef2205aea", //a block pushing puzzle
	// "6a6c07f71d7039e4155e", //spacekoban
	// "8848936", //volcano
	// "0590a6662f9e8e6afe4a", //swapbot
	// "8970711", //don't play on the ice
	// "23f51195601e97c80e9d", //heroes of sokoban and other tales
	// "798da90e0404885ba8ca", //middlegrounds
	// "f769ab6e9a971fc70991", //dinnertime!
	// "c66f9042141d57f6c571", //hypermaze
	// "7017254", //cattrap
	// "3d185bf1dc3765742064", //down a hole
	// "37d77e3f5b3b1e6e4673", //cannonclobber
	// "6849764", //a game?
	// "6851419", //mimic translations
	// "6851308", //switcheroo
	// "7262654", //connorses's switcheroo levels
	// "e7f21a1667880eb8aff0", //gifts of the forest
	// "1a3056782a7e6c0eb1db", //gamlet
	// "91812deb73f9fa066c9c", //pitman
	// "b70777227e6fb5d7ad05", //princess of isometria
	// "eb1666d62c9116c45013", //dot puzzle
	// "050ead59a13f35c6f4e0", //faced
	// "8604829", //cops and robbers
	// "e8b39f0fda0164155d00", //racist dogs
	// "5323d88b149771329af3", //hanoi: winter
	// "c77564dbd27fa158038d", //frown inversion squad
	// "9a42a9d3a5160dff0214", //repel
	// "6e1e4c24d22dc93d9fdf", //unlucky unlock
	// "773ec39e12295db4fc50", //tetrastrophe
	// "10549009", //reckonist
	// "10012467", //overfive
	// "10549802", //tiara quest (pt 1)
	// "c757ce7cf04a2573bcda", //spooki
	// "10023917", //gbsenku
	// "6955915", //niggle
	// "7591507", //the heart go wander
	// "1ec17c6dfa898d32e8cb", //frogbike: magnet hero
	// "3adbfbfb261f587fa19b", //shroom party
	// "7626248", //signal
	// "bb740a14359963d150c1", //lucid dinner
	// "9843320", //push-a-crate
	// "3e4aa7f30a92529806f6", //impasse demake
	// "6c287d330f96a453eea4", //do you want to build a snowman?
	// "c58ba6f441c8b2ecb817", //wriggler demake
	// "11466737", //32 nanobots
	// "913178f4fd23292a2b92", //Knighted chtp 2
	// "2f9d8f13f73e26878273", //forest road
	// "afd50da1988e391887ce", //switchboard operator
	// "11389736", //kick the can
	// "9fdbdcb1cfcfb6b1c628", //i'm sick today
	// "11486646", //loup-mouton-chou
	// "11371495", //aerobatics
	// "11349888", //emerita
	// "11328270", //platformer one
	// "8568540", //pink matter
	// "10974815", //at last, a ninja!
	// "11221348", //stealth agent gemini
	// "11104462", //mice and cheese
	// "11094463", //rgb
	// "8450765", //12345
	// "10492598", //turn-based pac-man
	// "10346416", //ouroboros
	// "10008797", //sheep
	// "9950856", //travelling salesman
	// "9882277", //attack of the martian giants
	// "9963665", //towers of saigon
	// "9484988", //low battery
	// "9357684", //the cretan labyrinth
	// "9619733", //drop maze
	// "9729683", //saute mouton
	// "9728457", //gibber dash
	// "9680093", //zanzlanz adventures
	// "9380622", //battle-mage
	// "9607170", //brain
	// "9605662", //birthday?
	// "9163494", //ogre push
	// "9483811", //godzilla
	// "9420193", //data diver
	// "9128592", //mnswpr.exe
	// "9345539", //warpdoor
	// "8814563", //blind ninja
	// "7508894", //let's part e
	// "9285892", //adventure de(?)make
	// "9200013", //drod demake
	// "9290224", //high noon rpg game
	// "9139865", //light maze
	// "9190890", //space wreck
	// "7696024", //Brendan loves mondays
	// "9198430", //flood
	// "9159444", //strata-gems
	// "7695464", //hector
	// "9128088", //goblin slayer
	// "7063674", //robot repairs
	// "9128725", //touchdown heroes
	// "9065838", //sokobot
	// "7381081", //elevator simulator
	// "2db388ed325ecca43cd2", //stand
	// "44db0cd60ac600746bad", //party demon
	// "b48b73a89b8c99fff7f2" //stand 2
];

//get stats for every level of every game:
//how long it took to get first answer (in iters and in seconds), how many answers in M iters & N seconds

SolverCautious.BACK_STEPS = "some";
SolverCautious.BACK_STEP_PENALTY = "10";
SolverCautious.SEEN_SPOT_PENALTY = "0.00001";
SolverCautious.gDiscount = "1.0";
SolverCautious.hDiscount = "5.0";
SolverCautious.ITER_MAX = "1000000";
SolverCautious.ITERS_PER_CONTINUATION = "1000";

var gameIdx = 0, solving = false;
var firstTest, secondTest;
firstTest = setInterval(function() {
	if(solving || gameIdx >= testLocalGames.length) { return; }
	solving = true;
	testLocalGame(testLocalGames[gameIdx], function() {
		solving = false;
		gameIdx++;
		if(gameIdx >= testLocalGames.length) {
			clearInterval(firstTest);
			gameIdx = 0;
			secondTest = setInterval(function() {
				if(solving || gameIdx >= testRemoteGames.length) { return; }
				solving = true;
				testRemoteGame(testRemoteGames[gameIdx], function() {
					solving = false;
					gameIdx++;
					if(gameIdx >= testRemoteGames.length) {
						clearInterval(secondTest);
					}
				});
			}, 1000);
		}
	});
},1000);

function tryLoadGist(id,cb) {
	var githubURL = 'https://api.github.com/gists/'+id;

	consolePrint("Contacting GitHub",true);
	var githubHTTPClient = new XMLHttpRequest();
	githubHTTPClient.open('GET', githubURL);
	githubHTTPClient.onreadystatechange = function() {
		if(githubHTTPClient.readyState!=4) {
			return;
		}

		if (githubHTTPClient.responseText==="") {
			consoleError("GitHub request returned nothing.  A connection fault, maybe?");
		}

		var result = JSON.parse(githubHTTPClient.responseText);
		if (githubHTTPClient.status===403) {
			consoleError(result.message);
		} else if (githubHTTPClient.status!==200&&githubHTTPClient.status!==201) {
			consoleError("HTTP Error "+ githubHTTPClient.status + ' - ' + githubHTTPClient.statusText);
		} else {
			var code;
			for(var f in result["files"]) {
				try {
					code = result["files"][f];
					unloadGame();
					compile(["restart"],code);
					break;
				} catch(e) {
					code = null;
				}
			}
			if(code) {
				testGame(code,cb);
			} else {
				throw("No valid code in gist "+id);
			}
		}
	}
	githubHTTPClient.setRequestHeader("Content-type","application/x-www-form-urlencoded");
	githubHTTPClient.send();
}

function tryLoadFile(fileName, cb) {
	var fileOpenClient = new XMLHttpRequest();
	fileOpenClient.open('GET', "../demo/"+fileName+".txt");
	fileOpenClient.onreadystatechange = function() {
		if(fileOpenClient.readyState!=4) {
			return;
		}
		if(fileOpenClient.status != 200) {
			throw("Couldn't load "+fileName+":"+fileOpenClient.status);
		}
		unloadGame();
		var code = fileOpenClient.responseText;	
		testGame(code, cb);
	}
	fileOpenClient.send();
}

function testGame(code, cb) {
	compile(["restart"],code);
	var solving = false;
	var testLevel = 0;
	var tester = setInterval(function() {
		if(solving || testLevel >= state.levels.length) { return; }
		solving = true;
		if(!state.levels[testLevel].message) {
			testGameLevel(code,testLevel);
		} else {
			//nop
		}
		solving = false;
		testLevel++;
		if(testLevel >= state.levels.length) {
			clearInterval(tester);
			cb();
		}
	}, 100);
}

var TIME_BUDGET = 30*1000; //30 seconds, in ms

function testGameLevel(code, lev) {
	SolverCautious.ITERS_PER_CONTINUATION = 1000;
	QUnit.test("Game:\""+state.metadata.title+"\", level:"+lev, function(assert) {
		expect(1);
		var solutions = [];
		var fullyExhausted = false;
		var timeSpent = 0;
		var startTime = Date.now();
		var resp = Solver.startSearch({
			rules:code,
			level:lev,
			mode:"fast",//"fast_then_best",
			hint:[],
			//seed:randomseed,
			verbose:true,
			replyFn:function(type,msg) {
				//console.log("MSG:"+type+":"+JSON.stringify(msg));
				switch(type) {
					case "solution":
						//data.solution.iteration
						//data.time
						//data.solution.prefixes.map(function(p) { return prefixToSolutionSteps(p).join(" "); })
						solutions.push({time:msg.time, solution:msg.solution});								
						break;
					case "exhausted":
						//data.time
						//data.response.iterations
						fullyExhausted = msg.response.fullyExhausted;
						break;
					default:
						break;
				}
			}
		});
		timeSpent = Date.now() - startTime;
		while(resp && resp.continuation && solutions.length == 0 && timeSpent <= TIME_BUDGET) {
			resp = Solver.continueSearch(resp.continuation);
			timeSpent = Date.now() - startTime;
		}
		if(solutions.length) {
			assert.ok(true,"Game:\""+state.metadata.title+"\", level:"+lev+" solved.");
		} else if(fullyExhausted) {
			assert.ok(false,"Game:\""+state.metadata.title+"\", level:"+lev+" not solved (unsolvable).");
		} else if (timeSpent <= TIME_BUDGET) {
			assert.ok(false,"Game:\""+state.metadata.title+"\", level:"+lev+" not solved (exhausted iterations).");
		} else {
			assert.ok(false,"Game:\""+state.metadata.title+"\", level:"+lev+" not solved (out of time).");
		}
	});
}

function testLocalGame(id,cb) {
	tryLoadFile(id,cb);
}
function testRemoteGame(id,cb) {
	tryLoadGist(id,cb);
}

function error(msg) {
	notify("error", msg);
	throw new Error(msg);
}

function warn(msg) {
	notify("warning", msg);
}

function log(msg) {
	notify("info", msg);
}

function notify(severity, msg) {
	console.log(severity+":"+msg);
}