/* Overall TODO:
2.) Implement the game as exists currently
3.) Daniel seems interested in Mobile, so I'm going to focus on
    re-doing the backend to support words instead of letters
    I think that has the most interesting potential in terms of
    changing gameplay
4.) Actually catch bad JSONs coming in
5.) Standardize EOL in our files? dict.txt has /r/n, others have /n
6.) Fix bug where you can change a letter to the same letter

*/




// Let's start by reading in the config file
var fs = require('fs');

// TODO: Throw all loading calls into one function so it's less messy
// NOTE: It's ok to stay synchronous until we start listening for requests
var config = {};
var dict = {};
var bonusPhrases = {};

// Create the alphabet array because I'm sick of typing this shift out
var alphabet = [];
for (var i = 65; i <= 90; i++) {
    alphabet.push(String.fromCharCode(i));
}

loadFiles();

// Loads the config from the config.json files
// TODO: Account for a local override file for easier testing
// TODO?: Provide defaults if there is no config file?

function loadConfig() {
    // Load the config
    try {
        config = JSON.parse(fs.readFileSync( __dirname + '/config.json', 'utf8'));
    } catch (err) {
        throw err;
    }

    console.log(config);
    console.log('Config successfully loaded');
}

// Loads the dictionary file from the file path given in the config
// TODO: Don't implement a backup, but actually do something with the exceptions
// Now let's load the dictionary
function loadDictionary() {
    try {  
        var wordData = fs.readFileSync(__dirname + config.dictFilePath, 'utf8');
    } catch (err) {
        throw err;
    }

    var words = wordData.split( "\r\n" );
    for (var i = 0; i < words.length; i++) {
        dict[ words[i] ] = true;
    }
    console.log("Dictionary loaded successfully");
}

// Loads the blacklist file from the file path given in the config
// TODO: Blacklist is up in the air after meeting with Jeremy, so consider
// handling it differently (rewarding blacklist words? not filtering?)
function loadBlacklist() {
    try {
        var badWordData = fs.readFileSync( __dirname + config.blacklistFilePath, 'utf8');
    } catch (err) {
        throw err;
    }

    var badwords = badWordData.split( "\n" );

    // Instead of loading a blacklist, we're going to just delete
    // blacklisted words from the dictionary
    // This makes our life easier when generating random words
    for (var i = 0; i < badwords.length; i++) {
        delete dict[ badwords[i] ];
    }
    console.log("Blacklist loaded successfully");
}

// Loads the bonus phrase file from the file path given in the config
// TODO: Add more bonus phrases? Have more dynamic bonus phrases?
function loadBonusPhrases() {
    var bonusPhrases = {};
    try {
        var bonuses = fs.readFileSync(__dirname + config.bonusPhraseFilePath, 'utf8');
    } catch (err) {
        throw err;
    }

    var phrases = bonuses.split( "\n" );
    for (var i = 0; i < phrases.length; i++) {
        bonusPhrases[ phrases[i] ] = true;
    }
    console.log("Bonus Phrases successfully loaded");
}

// This is a wrapper for the various loading functions
// I'm sure that there's a more intelligent way to do this, but I can't think
// of it at the moment, so this will do to clean things up
function loadFiles() {
    loadConfig();
    loadDictionary();
    loadBlacklist();
    loadBonusPhrases();

    console.log('All files loaded');
}


////////////////////////////////////////////////////////////////////////////////////////////////
// Server Variables to represent the game state

var state = {};
state.players = {};
state.round = 1;
state.queue = [];
state.numPlayers = 0;
state.toColor = 'pink'; 
state.words = [];
state.hint = {};

// This will be called when the game is first launched (after everything else
// has been loaded, but before the websocket connection) and every time the
// game is reset
// TODO: A separate "main()" function to actually start up the everything?
function init() {
    state.round = 1;
    state.toColor = 'pink';

    // Delete the entire words key to avoid weirdness if we decide to change the 
    // number of words mid-game at some point
    delete state.words;
    state.words = [];
    for (var i = 0; i < config.numWords; i++) {
        // Make sure that each word starts off with at least one valid move
        // TODO: Algorithm to determine starting words with more options?
        do {
            var wordArray = breakWord(getRandomWord(), 'blue');
        } while (!hasMoreMoves(wordArray));
        state.words.push(wordArray);
    }
    console.log(state);
    printHint();

    resetScores();
}

init();

// Socket stuff
var io = require('socket.io').listen(config.port);

io.sockets.on('connection', function (socket) {
    console.log('connection');

    socket.on('disconnect', function () {
        unregister({guid: socket.guid});
    });

    socket.on('register', function (data) {
        console.log('register received');
        register(data);
    });

    socket.on('unregister', function (data) {
        console.log('unregister received');
        unregister(data);
    });

    socket.on('chat', function (data) {
        console.log('chat received');
        chat(data);
    });

    socket.on('changeUsername', function (data) {
        console.log('changeUsername received');
        changeUsername(data);
    });

    socket.on('reset', function (data) {
        console.log('reset received');
        if (isTurnPlayer(data.guid)) {
            reset();
        } else {
            console.log('You can only reset if it is your turn!');
            console.log(data.guid);
            console.log(state.queue[0]);
        }
    });

    socket.on('skip', function (data) {
        console.log('skip received');
        skip(data);
    });

    socket.on('play', function (data) {
        console.log('play received');
        play(data);
    });

    function register (data) {
        // TODO: Catch bad JSONs

        // If the player doesn't exist, register her
        // Otherwise, don't bother
        if (!state.players[data.guid]) {
            var player = {};
            player.username = data.username;
            player.guid = data.guid;
            player.score = 0;
            player.bonus = false;
            state.players[player.guid] = player;

            // Add the new player to the queue
            state.queue.push(player.guid);

            state.numPlayers++;

            var message = {};
            message = JSON.parse(JSON.stringify(state));
            message.joiner = {};
            message.joiner.username = player.username;
            message.joiner.guid = player.guid;

            // Store the guid in the socket so that disconnect works properly
            socket.guid = data.guid;
            console.log('Socket.guid is: ');
            console.log(socket.guid);

            // Let people know we have a new player
            io.sockets.emit('registered', message);

            console.log(state);
            console.log('register complete');
        }
    }

    function unregister (data) {
        // TODO: Catch bad JSONs
        // TODO: Unrepoducible bug with unregister where the same guid can be registered multiple times
        var guid = data.guid;

        // Only unregister if the player is already registered
        if (state.players[guid]) {
            // Grab the username for a prettier exit message
            var username = state.players[guid].username;

            delete state.players[guid];
            state.numPlayers--;

            // Remove the player from the queue
            for (var i = 0; i < state.queue.length; i++) {
                if (state.queue[i] === guid) {
                    state.queue.splice(i, 1);
                }
            }

            console.log("This is after the user is purged");
            console.log(state);

            // Construct the return JSON
            var message = {};
            message = JSON.parse(JSON.stringify(state));
            message.leaver = username;

            // Let the other players know that a player has left
            io.sockets.emit('unregistered', message);

            console.log(state);
            console.log('unregister complete');
        } else {
            console.log('Bad guest! How dare you unregister before you register!');
        }
    }

    function chat (data) {
        // TODO: Catch bad JSONs
        var message = {};

        // Only receive chat messages from registered players
        if (state.players[data.guid]) {
            message.username = state.players[data.guid].username;
            message.text = data.text;

            io.sockets.emit('getChat', message);
            console.log('chat complete');
        } else {
            console.log('BAD USER, trying to chat without registering!');
        }
    }

    function changeUsername (data) {
        // TODO: Catch bad JSONs
        // TODO: Validate usernames to alphanumeric regex (Less restrictive, maybe?)
        // REGEX: ^[A-Za-z0-9_]{1,15}$

        // Can only change the username of a real player
        if (state.players[data.guid]) {

            var oldUsername = state.players[data.guid].username;
            state.players[data.guid].username = data.newUsername;

            var changer = {};
            changer.guid = data.guid;
            changer.oldUsername = oldUsername;
            changer.newUsername = data.newUsername;

            var message = {};
            message = JSON.parse(JSON.stringify(state));
            message.changer = changer;

            io.sockets.emit('changeUsername', message);
            console.log('Username changed for', data.guid);
        } else {
            console.log('You can only change your username if you exist!');
        }
    }

    function reset () {
        // TODO: Catch bad JSONs

        // Only allow the turn player to reset
        // NOTE: The game should auto-reset if there are no more moves left
        //       but we can worry about that later
        nextPlayer();
        init();
        io.sockets.emit('reset', state);
        console.log('Resetting Game');     
    }

    function skip (data) {
        // TODO: Catch bad JSONs

        // Only allow the player whose turn it is to skip
        if (isTurnPlayer(data.guid)) {
            nextPlayer();
            var message = JSON.parse(JSON.stringify(state));
            message.skipPlayer = {};
            message.skipPlayer.username = state.players[data.guid].username;
            io.sockets.emit('skipped', message);
        } else {
            console.log('You are not allowed to skip! CHEATER!');
        }
    }

    function play (data) {
        // TODO: Catch bad JSONs
        console.log(data);

        // Has to be a valid word
        if (Number(data.move.word) < 0 || Number(data.move.word) >= state.words.length) {
            console.log("Invalid word Index");
            io.sockets.emit('failedPlay', data);
            return 1;
        }

        // Has to be a valid letter in a valid word
        if (Number(data.move.letter) < 0 || Number(data.move.letter) >= state.words[data.move.word].length) {
            console.log("Invalid letter Index");
            io.sockets.emit('failedPlay', data);
            return 1;
        }

        // Can't be the same letter it was before
        if (state.words[Number(data.move.word)][Number(data.move.letter)].letter.toUpperCase() === data.move.newLetter.toUpperCase()) {
            console.log("Cannot change a letter to itself");
            io.sockets.emit('failedPlay', data);
            return 1;
        }

        // only allow the player whose turn it is to play
        if (isTurnPlayer(data.guid)) {
            var scoreChange = 0;

            var word = formWord(state.words[data.move.word]);
            // TODO: Do this more intelligently with splice or slice or something
            var newWord = "";

            for (var i = 0; i < word.length; i++) {
                if (i === Number(data.move.letter)) {
                    newWord += data.move.newLetter;
                } else {
                    newWord += word.charAt(i);
                }
            }

            if (checkWord(newWord) && state.words[data.move.word][data.move.letter].color !== state.toColor) {
                // Change the word
                flipColor(state.words[data.move.word][data.move.letter]);
                state.words[data.move.word][data.move.letter].letter = data.move.newLetter;
                state.words[data.move.word][data.move.letter].score = getLetterScore(data.move.newLetter);

                // Update the player's score
                scoreChange += bonusScore();

                state.players[data.guid].bonus = (scoreChange > 0);

                scoreChange += getWordValue(state.words[data.move.word]);
                state.players[data.guid].score += scoreChange;

                // Advance the round, if necessary
                if (allColorChange()) {
                    // TODO: Change the flipColor function to only take and return a string
                    state.round++;
                    state.toColor = (state.toColor === 'blue' ? 'pink' : 'blue');
                }

                // Check if the game is over
                // TODO: Something with this is wrong, make it work
                //       The weirdness to to do with checking the game over conditions
                if (isGameOver()) {
                    var winners = getLeadPlayer();
                    console.log(winners);
                    console.log(winners.length);
                    if (winners.length === 1) {
                        io.sockets.emit('gameOver', {winner: winners[0], state: state, tie: false});
                    } else {
                        io.sockets.emit('gameOver', {winners: winners, state: state, tie: true})
                    }
                    console.log('Game over');

                    // The winner has been announced, time to start a new game
                    reset();

                } else {

                    // Proceed with the game
                    nextPlayer();
                    var message = JSON.parse(JSON.stringify(state));
                    message.move = data.move;
                    io.sockets.emit('play', message);
                    console.log('Play successful');
                }
            } else {
                // Don't let score go below 0
                if (state.players[data.guid].score <= config.deductionValue) {
                    state.players[data.guid].score = 0;
                } else {
                    state.players[data.guid].score -= config.deductionValue;
                }

                var message = JSON.parse(JSON.stringify(state));
                message.move = data.move;
                socket.emit('failedPlay', message);
                console.log(data.move);
                console.log('Play was unsuccessful');
            }
        } else {
            console.log('You can only play on your turn');
        }
        printHint();
    }
});


// Private Functions?
// TODO: Understand scoping in javascript

// Checks that a word is valid
// Returns true when the word is valid and false when it is not
function checkWord (word) {
    return (dict[word.toLowerCase()] ? true : false);
}

// Gets a random word from the dictionary
// TODO: Make this accept a word length argument
function getRandomWord () {
    var rand = Math.floor(Math.random() * Object.keys(dict).length);
    return Object.keys(dict)[rand];
}

// Shift the queue to change the turn player
// NOTE: I'm planning to use the head of the array to represent the turn player
function nextPlayer () {
    // If there are 0 or 1 player(s), don't even bother changing
    if (getNumPlayers() > 1) {
        state.queue.push(state.queue.shift());
    }
}

// Accepts two words as arguments and returns the amount of bonus points
// earned by those words (Will be 0 if the words don't form a special phrase)
function phraseBonus (first, second) {
    // TODO: (Maybe) add scoring logic to this function separately
    var phrase = first + " " + second;
    return (bonusPhrases[phrase] ? config.phraseBonus : 0);
}

// This function breaks a word into an array of letter json objects
// This is used when generating new words
function breakWord (word, color) {
    var letters = [];
    for (var i = 0; i < word.length; i++) {
        var letter = { letter: word.charAt(i),
                       color: color,
                       score: getLetterScore(word.charAt(i)) };
        letters.push(letter);
    }

    return letters;
}

// This function returns true when the player who emitted the event
// is the current player
function isTurnPlayer (guid) {
    return (guid === state.queue[0]);
}

// Advances the round (flipping the color direction in the process)
// Returns true on success
// TODO: Make this void? Make this return something useful?
function nextRound () {
    // Advance the round number
    state.round++;

    // Flip the color direction
    state.toColor = ((state.toColor === 'pink') ? 'blue' : 'pink');

    return true;
}

// Resets the scores for all players
function resetScores () {
    console.log(state.players);
    for (var player in state.players) {
        state.players[player].score = 0;
        state.players[player].bonus = false;
    }
    console.log(state.players);
}

// Returns the current number of registered players
function getNumPlayers () {
    return state.numPlayers;
}

// Returns a string containing the word represented by an array of
// letter objects. This will be used when we are trying to turn a message's
// new word into 
function formWord (wordArray) {
    var word = "";
    for (var i = 0; i < wordArray.length; i++) {
        word += wordArray[i].letter;
    }

    return word;
}

// Returns the point value of the given letter
function getLetterScore (letter) {
    return 1; // For testing purposes
    return config.pointValues[letter.toUpperCase()];
}

// Returns the number of bonus points earned for making the current phrase
// NOTE: Currently hard-coded to only support two words, because I'm not sure
// how our current bonus mechanism translates to 3+ words yet
function bonusScore () {
    // Currently, we have two kinds of bonus: Match and Phrase
    var bonus = 0;

    // TODO: Yeah, I know we can fail faster here, but it's 3 in the morning
    var firstWord = formWord(state.words[0]);
    var secondWord = formWord(state.words[1]);

    // Check for a Match Bonus, where both words are the same
    if (firstWord.toUpperCase() === secondWord.toUpperCase()) {
        bonus += 2 * getWordValue(state.words[0].toUpperCase());
    }

    // Check for a Phrase Bonus
    var phrase = firstWord.toLowerCase() + " " + secondWord.toLowerCase();
    if (bonusPhrases[phrase]) {
        bonus += config.phraseBonus;
    }
    console.log("The phrase bonus result is: " + bonus);
    return bonus;
}

// Returns the number of points a word is worth in total
function getWordValue (wordArray) {
    var score = 0;
    for (var i = 0; i < wordArray.length; i++) {
        score += wordArray[i].score;
    }
    return score;
}

// Returns true if the game is over
function isGameOver () {
    return (state.round > config.maxRounds || !movesRemaining());
}

// Returns an array of GUIDs associated with players who have the highest score
// The GUIDs return in no particular order
function getLeadPlayer () {
    var leads = [];
    var max = 0;
    for (var player in state.players) {
        if (state.players[player].score > max) {
            leads = [];
            leads.push(state.players[player].guid);
            max = state.players[player].score;
        } else if (state.players[player].score === max) {
            leads.push(state.players[player].guid);
        }
    }
    return leads;
}

// Returns true if there is another possible move for the given word
// Returns false if there is not another possible move
function hasMoreMoves (wordArray) {

    var word = formWord(wordArray);
    for (var i = 0; i < wordArray.length; i++) {

        // Only check if a word can be made by changing the letter at i if 
        // the letter is actually available for changing
        if (!(wordArray[i].color === state.toColor)) {
            var letter = word.charAt(i);
            for (var j = 0; j < 26; j++) {
                // It is invalid to change a letter to itself, so ignore that case
                if (alphabet[j] !== letter.toUpperCase()) {
                    var newWord = word.slice(0, i) + alphabet[j] + word.slice(i + 1);
                    if (checkWord(newWord)) {
                        state.hint = {
                            fromWord: word,
                            toWord: newWord
                        };
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

// Returns true if there is another possible move in the game
// Returns false if there are no more possible moves in the game
function movesRemaining () {
    for (var i = 0; i < state.words.length; i++) {
        if (hasMoreMoves(state.words[i])) {
            return true;
        }
    }
    state.hint = {};
    return false;
}

// Logs out one possible valid play, or "NO MOVES" if 
// there are no valid plays for a word
function printHint () {
        if( state.hint ) {
            console.log("Change word " + state.hint.fromWord + " to : " + state.hint.toWord);
        } else {
            console.log("No more moves");
        }
}

// Returns the flipped color of a given letter object
function flipColor (letter) {
    
    letter.color = (letter.color === 'blue' ? 'pink' : 'blue');
    return letter.color;
}

// Returns true when the color of all letters have flipped to that
// of the toColor (when the round is over, essentially)
function allColorChange () {
    for (var i = 0; i < state.words.length; i++) {
        for (var j = 0; j < state.words[i].length; j++) {
            if (!(state.words[i][j].color === state.toColor)) {
                return false;
            }
        }
    }

    return true;
}

