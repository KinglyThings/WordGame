/* Massive TODO
1.) Make state.local represent things only about this client
2.) Make state.server represent the server's state sent in with each message
2a.) Consider scaling this back:
3.) Clicking on the border of a letterbox activates the selection, but doesn't actually select
    the letter. Not 100% sure how to fix this
4.) Change the button images to inactive when it is not the player's turn
5.) Make (state.local.guid === turnPlayer()) a function because I use it like a billion times
6.) Delete old refreshWords functions (And make a new, better one that only does necessary letters)

Question: 

Is it better to:

a.) send as little as possible and update info in the client, knowing
    that the client can potentially get out of sync more easily
b.) send as much as posssible, especially for dev purposes, and
    rely on the client as little as possible
(NOTE: This would all be related to display issues for the client, not actual game logic
       regardless of which of those two options we go with)


*/

// And here we go

// Username is alphanumeric + underscore and can contain between 3 and 15 characters
var usernameValidation = new RegExp('^[A-Za-z0-9_]{3,15}$');
var letterValidation = new RegExp('^[A-Za-z]{1}$');

var socket = io.connect('http://localhost:56789', {'sync disconnect on unload': true});

var state = {};

state.local = {};
state.local.guid = "default0123";
state.local.username = 'Default';
state.local.active_id = '';
state.local.currentLetter = '';
state.local.isChatting = false;

state.server = {};
state.server.players = [];
state.server.turnPlayer = "";
state.server.queue = [];
state.server.words = [];
state.server.toColor = 'pink';

socket.on('connecting', function () {
    console.log('Connecting to Four Letter Words');
});

socket.on('connect', function() {

    console.log('Connected Successfully to Four Letter Words');

    socket.on('registered', function (data) {
        adminAlert(data.joiner.username + ' has entered the building!');
        console.log(state.server.players);
        state.server.players = data.players;
        state.server.queue = data.queue;
        state.server.turnPlayer = turnPlayer();
        state.server.words = data.words;
        state.server.toColor = data.toColor;

        // Use the same handler for turn players and non-turn players so
        // we don't have to keep re-binding everything
        if (data.joiner.guid === state.local.guid) {
            $( window ).unbind('keypress').bind('keypress', function (e) {

                if (e.which === 13) {
                    // Only submit if they aren't chatting
                    if (state.local.isChatting) {
                        console.log('Chat submitted with enter');
                        chat();
                    } else {
                        // Don't play unless we are the turn player
                        if (state.local.guid === turnPlayer()) {
                            console.log('Not chatting, submit play');
                            play();

                            // After playing, reset the state of the game to a non-turn player state
                            $('.letterbox').removeClass('selectedLetter');
                            state.local.active_id = '';
                            state.local.currentLetter = '';
                        }
                    }
                } else if (e.which === 8) {
                    // Bind backspace so we don't leave the page
                    // Only prevent default when the player isn't chatting
                    // or they won't be able to backspace in the input box
                    if (!state.local.isChatting) {
                        e.preventDefault();
                    }
                } else {
                    // Only change the current letter if we are the turn player

                    // Only do this if the player is not chatting
                    if (!state.local.isChatting) {
                        if (state.local.guid === turnPlayer()) {
                            var letter = String.fromCharCode(e.which);
                            if (letterValidation.test(letter)) {
                                // The letter is valid, let's set the current letter
                                state.local.currentLetter = letter.toUpperCase();
                                // Change the letter that was selected to the new letter
                                $( '#' + state.local.active_id ).text(state.local.currentLetter);
                            }
                        } else {
                            // If we're not the turn player, empty out the turn variables
                            state.local.currentLetter = '';
                            state.local.active_id = '';
                            $('.letterbox').removeClass('selectedLetter');
                        }
                    }
                }
            });

        refreshWordsBetter();
        }

        updateRegisterium();
        refreshButtons();
    });

    socket.on('unregistered', function (data) {
        console.log('User unregistered');
        console.log(data);
        state.server.players = data.players;
        state.server.queue = data.queue;
        state.server.turnPlayer = turnPlayer();
        updateRegisterium();

        adminAlert(data.leaver + ' has left the building!');

        // Reset the username for now
        state.local.username = 'Default';
    });

    socket.on('getChat', function (data) {
        console.log('Chat receieved');
        writeChat(data.username, data.text);
    });

    socket.on('skipped', function (data) {
        console.log('Skip received');
        state.server.queue = data.queue;
        state.server.turnPlayer = turnPlayer();
        if (state.server.turnPlayer === state.local.guid) {
            console.log("You are the turn player!");
        }
        adminAlert(data.skipPlayer.username + ' has skipped!');
        updateRegisterium();
        refreshButtons();
    });

    socket.on('reset', function (data) {
        console.log('reset received');
        state.server.queue = data.queue;
        state.server.turnPlayer = turnPlayer();
        state.server.players = data.players;
        state.local.currentLetter = '';
        if (state.server.turnPlayer === state.local.guid) {
            console.log("You are the turn player!");
        }
        state.server.words = data.words;
        state.server.toColor = data.toColor;
        updateRegisterium();
        refreshWordsBetter();
        refreshButtons();
    });

    socket.on('gameOver', function (data) {
        console.log('gameOver received');
        console.log("Data");
        console.log(data);
        // May not be necessary
        state.server = data.state;

        // TODO: Don't use an alert because they make everything terrible
        if (!data.tie) {
            console.log(data);
            if (state.local.guid === data.winner.guid) {
                alert('Congratulations! You won!');
            } else {
                var endMessage = 'The winner was: ' + state.server.players[data.winner].username;
                alert(endMessage);
            }
        } else {
            var endMessage = '';
            if (data.winners.indexOf(state.local.guid) >= 0) {
                endMessage = 'You tied with:'
                for (var i = 0; i < data.winners.length; i++) {
                    if (data.winners[i] !== state.local.guid) {
                        endMessage += ' ' + state.server.players[data.winners[i]] + ',';
                    }
                }
            } else {
                endMessage = 'There was a tie! The winners are:';
                for (var i = 0; i < data.winners.length; i++) {
                    endMessage += ' ' + state.server.players[data.winners[i]] + ',';
                }
            }

            // Chop off the trailing comma
            endMessage.replace(/,$/, '!');
            alert(endMessage);
        }
    });

    socket.on('play', function (data) {
        console.log(data);
        state.server.words = data.words;
        state.server.queue = data.queue;
        state.server.turnPlayer = turnPlayer();
        state.server.players = data.players;
        state.server.toColor = data.toColor;

        updateRegisterium();
        console.log("This is onPlay");
        console.log(data);
        if (data.move) {
            console.log("We really thought this was a successful play");
            // Only refresh a single letter at a time
            var id = '#w' + data.move.word + 'l' + data.move.letter;
            var color = state.server.words[data.move.word][data.move.letter].color;
            $(id).removeClass().addClass(color).addClass('letter').text(data.move.newLetter);
            console.log($(id).attr('class'));
        } else {
            console.log("Or not a successful play");
            // If we're here, it means the single letter refresh is broken somehow
            refreshWordsBetter();
        }
        refreshButtons();
    });

    socket.on('failedPlay', function (data) {
        // This is what is sent when a user has submitted a bad word
        console.log("This should be a failed play");
        state.server.players = data.players;
        state.server.words = data.words;
        console.log(data);

        if (data.move) {
            // Only refresh a single letter at a time
            var id = '#w' + data.move.word + 'l' + data.move.letter;
            $(id).removeClass('selectedLetter');
            console.log($(id));
            // Restore the real letter to the box
            $(id).text(state.server.words[data.move.word][data.move.letter].letter);
        } else {
            console.log("Something is horribly wrong if you hit this");
        }

        console.log('Failed play');
        adminAlert(state.server.players[turnPlayer()].username + ' entered a bad word!');
        updateRegisterium();
    });
});

function writeChat(username, message) {
    // Display admin messages without a username
    var userText = (username === '' ? '' : username + ': ');
    var chatLine = userText + message + '<br />';
    var chatbox = $( '#chatbox' );
    chatbox.append( chatLine );
    var height = chatbox.prop( 'scrollHeight' ) - chatbox.height();
    chatbox.scrollTop( height );
}

function adminAlert(message) {
    var adminLine = '<strong>' + message + '</strong>';
    writeChat('', adminLine);
}

function register() {
    state.local.guid = guid();
    socket.emit('register', {username: state.local.username, guid: state.local.guid});
    console.log('Emitted register');
};

function unregister() {
    socket.emit('unregister', {guid: state.local.guid});
    console.log('Emitted unregister');
};

function reset() {
    // You can only reset if you are the turn player
    if (state.local.guid === turnPlayer()) {
        socket.emit('reset', { guid: state.local.guid });
        console.log('Emitted reset');
    }
};

function skip () {
    // You can only skip if you are the turn player
    if (state.local.guid === turnPlayer()) {
        socket.emit('skip', {guid: state.local.guid});
        console.log('Emitted skip');
    }
};

// TODO: Change state.local.active_id to be an array holding [word, letter]
function play () {
    // Only submit if this is the turn player
    if (state.local.guid === turnPlayer()) {

        // If we haven't selected an element or if we don't have a letter, ignore
        if (state.local.active_id === '' || state.local.currentLetter === '') {
            console.log("You have not select a letter to replace!");
            return 1;
        } else {
            var move = {};

            // Get the word to be changed
            var word_patt = /^w([\d]+)/;
            move.word = state.local.active_id.match(word_patt)[1];

            // Get the letter to be changed
            var letter_patt = /l([\d]+)/;
            move.letter = state.local.active_id.match(letter_patt)[1];
          
            move.newLetter = state.local.currentLetter;

            socket.emit('play', {guid: state.local.guid, move: move});
            console.log('Emitted play');
        }

        // Reset the selected letter
        // TODO: Efficiently grab only the changed letter
        $('.letterbox').removeClass('selectedLetter');
    } else {
        console.log('You cannot emit play because it is not your turn!');
    }
};

/*function changeUsername () {
    var newUsername = $('input#user_name_field').val();
    $('input#user_name_field').val("");
    socket.emit('changeUsername', {guid: state.local.guid, newUsername: newUsername});
    console.log('Emitted changeUsername');
}*/

function chat () {
    var message = $('input#chat_field').val();
    $('input#chat_field').val("");
    socket.emit('chat', {guid: state.local.guid, text: message});
    console.log('Emitted chat');
}

// Returns the GUID of the player whose turn it currently is
function turnPlayer() {
    return state.server.queue[0];
}

// Updates the list of players
// The players will display in turn order
// The turn player will be at the top and in a larger box
// The local player will be bolded
// TODO: Have special box for local player
// TODO: Rename to refreshQueue when registerium stop amusing me
function updateRegisterium() {

    var user_list = jQuery( '<ul/>' );
    console.log(state.server);
    console.log(state.server.players);

    for (var i = 0; i < state.server.queue.length; i++) {
        if (state.server.players[state.server.queue[i]]) {

            var user = jQuery( '<li/>' );

            var username = state.server.players[state.server.queue[i]].username;
            var score = state.server.players[state.server.queue[i]].score;

            user.text(username + ': ' + score);

            // If it is the local player, display something special
            if (state.server.queue[i] === state.local.guid) {
                user.addClass('local_player');
            }

            // If it is the turn player, display something special
            if (i == 0) {
                user.addClass('turn_player');
            }

        }
        user_list.append( user );
    }

    // Now, add the list to the registerium element
    jQuery( '#registerium' ).html(user_list);
    console.log('Registerium updated!');
}
///////////////////////////////
// Refreshes the word display with the most recent words
function refreshWords () {
        // This is where we have to refresh the words
        // TODO: Replace this all with jQuery stuff when I'm not too tired to look it up
        var wordStuff = '';

        // For each word in the word list
        for (var i = 0; i < state.server.words.length; i++) {
            // For each letter in the word
            var lineWrap = '<div class="row" id="wordRow' + i + '">';
            wordStuff += lineWrap;
            for (var j = 0; j < state.server.words[i].length; j++) {

                // Generate the id for the letter element
                var id = 'w' + i + 'l' + j; 
                var line = '<div class="letterbox ' + state.server.words[i][j].color + '">';
                line += '<span class="letter" id="' + id + '" onclick="selectLetter">'+ state.server.words[i][j].letter.toUpperCase() + '</span></div>';
                wordStuff += line;
            }
            wordStuff += '</div><br /><br />';
        }

        // Now that the words are set up, add them.
        document.getElementById('words').innerHTML = wordStuff;
        console.log('Words Refreshed');
}

// Refresh words with jQuery
// TODO: Make a function that will only remake one letter, so we don't
//       redraw the whole thing each time a word is changed
function refreshWordsBetter () {
    var wordStuff = $( '<div>' );

    // For each word in the word list
    for (var i = 0; i < state.server.words.length; i++) {
        var lineWrap = $( '<div>' );
        lineWrap.addClass('row');
        lineWrap.attr('id', 'wordRow' + i);

        // For each letter in the word
        for (var j = 0; j < state.server.words[i].length; j++) {
            // Generate the id for the letter element
            var id = 'w' + i + 'l' + j;
            
            // Generate the wrapper box for the letter
            var letterbox = $( '<div>' );
            letterbox.addClass('letterbox');
            letterbox.addClass(state.server.words[i][j].color);
            if (state.local.active_id === id) {
                letterbox.addClass('selectedLetter');
            }

            // If this word is changeable, add this event
            // Change the border color of this on click to yellow
            // Change the border color of everything else to black
            // TODO: Change this to a delegated event on the #words div?
            letterbox.on('click', function (event) {

                console.log(state.local.guid);
                console.log(turnPlayer());
                console.log($(event.target));
                console.log(getToColor());

                // Only run this function when the player is the current turn player
                if (state.local.guid === turnPlayer()) {
                    // Only run this function when this is a valid element to change
                    if ($(event.target).hasClass(getToColor())) {
                        console.log("Invalid target for selection");
                        return;
                    }

                    // TODO: Clear the active id and current letter and reset
                    //       the letter that was previously changed to its original form
                    console.log(event);
                    //if ($(event.target).attr('id') !== state.local.active_id) {
                    //    refreshWordsBetter();
                    //}

                    // Find the letter that was previously selected
                    // Set its selected state to null
                    // Set its letter content back to whatever it was before we changed it
                    var lastLetterId = state.local.active_id;
                    console.log(lastLetterId);
                    // If there was a last letter that was not this letter, set it back to the server state
                    if (lastLetterId !== '' && (lastLetterId !== $(event.target).attr(id))) {

                        // TODO: Make the match capture into one regex
                        // Get the word to be changed
                        var word_patt = /^w([\d]+)/;
                        var lastWord = lastLetterId.match(word_patt)[1];

                        // Get the letter to be changed
                        var letter_patt = /l([\d]+)/;
                        var lastLetter = lastLetterId.match(letter_patt)[1];

                        // Set the letter of the previously clicked element
                        var lastLetterText = state.server.words[lastWord][lastLetter].letter;
                        $( '#' + lastLetterId).text(lastLetterText);
                        console.log('Resetting letter to server state');
                    }

                    $('.letterbox').removeClass('selectedLetter');
                    $(event.currentTarget).addClass('selectedLetter');
                    state.local.active_id = $(event.target).attr('id');
                    console.log(state.local.active_id);
                } else {
                    console.log("You cannot choose a letter to change because it is not your turn!");
                }
            });

            // Generate the letter element
            var letter = $( '<span>' );
            letter.addClass('letter');
            letter.attr('id', id);
            // TODO: Consider doing this with css: text-transform
            letter.text(state.server.words[i][j].letter.toUpperCase());

            letterbox.append(letter);
            lineWrap.append(letterbox);
        }

        wordStuff.append(lineWrap);
    }

    // Now we have everything we need, so output it
    $('#words').html(wordStuff);


}

////////////////////////////////////////////////////////////////

// TODO: Get documentation for this function.
function S4() {
    console.debug( 'Entering S4()' );
    return (((1 + Math.random()) * 0x10000) | 0)
        .toString(16)
        .substring(1);
};

// Generates an RFC-4122 compliant GUID.  Because.
// TODO: Get documentation for this function.
function guid () {
    console.debug( 'Entering guid()' );
    return S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() +
        "-" + S4() + S4() + S4();
};

// Let's start by running the stuff to happen on page load
jQuery(function() {
    $('#game').hide();
    $('#login_modal').show();

    $('#chat_field').on('focus', function() {
        state.local.isChatting = true;
    });

    $('#chat_field').on('blur', function() {
        state.local.isChatting = false;
    });
    // Let's set up the click events for the letterboxes
    // TODO: Make this work in IE8 and below
    /*
    $('.letterbox').each(function (index) {
        var that = this;
        that.bind('click', function() {
            // Only process if it is the player's turn
            if (state.local.guid === turnPlayer()) {
                // Set the active id (to be used upon keypress)
                var id = that.attr('id');
                setActiveId(id);

                $('.letterbox').each(function (index) {
                    $(window).unbind('keypress');
                });

                $(window).bind('keypress', function(e) {
                    this.state.local.guid;
                });
            }
        });
    }); */
});

// TODO: Dynamically bind and unbind this function to the login button using jQuery
function verifyUsername() {
    var username = $('input#login_username').val();

    // Only register if the username is valid
    if(usernameValidation.test(username)) {
        state.local.username = username;
        $('#chat_username').html( state.local.username );
        register();
        $('#login_modal').hide();
        $('#game').show();
    } else {
        $('#login_errors').html('Enter a valid username: (Alphanumeric + underscore, between 3 and 15 characters');
    }

}

// Sets the id of the letter to be changed
function setActiveId(id) {
    state.local.active_id = id;
}

// Binds all the event handlers needed for a player turn
function bindTurnHandlers() {
    // Register the player's keypresses 
    //$( window )
    return 1;
}

// Unbinds all the event handlers needed for a player turn
function unbindTurnHandlers() {
   /* // Get rid of the keypress event for changing the letter
    $( window ).unbind( 'keypress' );

    // Unbind the click events on the letter squares
    for (var i = 0; i < state.server.words.length; i++) {
        for (var j = 0; j < state.server.words[i].length; j++) {
            var id = '#w' + i + 'l' + j;
            $( id ).unbind();
        }
    }

    // We no longer have an active ID
    setActiveId(false);
*/
    // Re-bind the handlers that should always work

    return 2;    
}

// Change the letter 
function updateLetter() {
    // If we have changed a letter, 
    $(state.local.active_id).text(state.local.currentLetter);
}

// Returns the toColor of the server
function getToColor () {
    return state.server.toColor;
}

// Sets the button state appropriately depending on whether or not this 
// is the turn player
function refreshButtons () {
    console.log('Reached refresh buttons');
    if (state.local.guid === turnPlayer()) {
        $('.button').removeClass('inactive');
    } else {
        // Make sure we only have one inactive class at a time
        $('.button').removeClass('inactive').addClass('inactive');
    }
}