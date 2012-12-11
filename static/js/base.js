/*
 *  CardBoard Copyright (c) 2012 Matthew Thompson
 *  Licensed under the AGPL v3
 */

function joinLobby(code, name) {
    var content = $('#messages');

    if ("WebSocket" in window) {
        game.restartGame();
        game.ws = new WebSocket('ws://' + location.host + '/ws');
        game.code = code;
        game.player_name = name;
        game.status = 'lobby';

        game.ws.onopen = function() {
            game.opened();
        };

        game.ws.onmessage = function(event) { game.processMessage(event); };

        game.ws.onclose = function() { game.closed(); };
    }
    else {
        alert("This website requires WebSockets.");
    }
}


function displayMessage(message) {
    addMessage("", message);
}


function displayError(error) {
    addMessage("error", error);
}


function addMessage(type, text) {
    var messages = $('#messages');
    messages.show();
    var div = $("<div class='" + type + "'>" + text + "</div>");
    div.hide();
    div.appendTo(messages);
    div.show('highlight');
    messages.scrollTop(messages[0].scrollHeight);
}


function restackDraggables(selector, top) {
    /* from jquery.ui.draggable.js, MIT license */
    var group = $.makeArray($(selector)).sort(function(a,b) {
            return (parseInt($(a).css("zIndex"),10) || 0) - (parseInt($(b).css("zIndex"),10) || 0);
    });
    if (!group.length) { return; }

    var min = parseInt(group[0].style.zIndex) || 0;
    $(group).each(function(i) {
            this.style.zIndex = min + i;
    });

    $(top)[0].style.zIndex = min + group.length;
}


var game = {

    ws: null,
    code: null,
    state: null,
    player_id: null,
    player_vars: [],
    deck: {},
    cards: {},


    restartGame: function() {
        this.ws = null;
        this.code = null;
        this.state = null;
        this.player_id = null;
        this.player_vars = [];
        this.deck = {};
        this.cards = {};

        $('#board').empty();
        $('#deck').empty();
        $('#hand').empty();
    },


    processMessage: function(event) {
        var data = $.parseJSON(event.data);

        var new_state = null;

        if ('state' in data) {
            new_state = data.state;
        }
        if ('player_id' in data) {
            this.player_id = data.player_id;
        }
        if ('player_vars' in data) {
            if (new_state === 'start') {
                this.player_vars = data.player_vars;
            }
            else {
                this.mergeVars(data.player_vars);
            }
        }
        if ('message' in data) {
            displayMessage('server: ' + data.message);
        }
        if ('error' in data) {
            displayError('server: ' + data.error);
        }
        if ('deck' in data) {
            displayMessage('Loaded new deck');
            this.deck = data.deck;
        }
        if ('spawn_card' in data) {
            this.addCardToBoard(data.spawn_card);
        }
        if ('move' in data) {
            this.moveCard(data.move);
        }
        console.log('message', data);

        this.updateState(new_state);
    },


    moveCard: function(data) {
        var card = this.cards[data.id];
        card.animate({ left: data.pos[0], top: data.pos[1] }, 250);
        restackDraggables('.card', card);
       //card.css('z-index', data.pos[2]);
    },


    updateCard: function(card) {
        var pos = card.offset();
        var zindex = card.css('z-index');
        this.send({'move': {
            'id': card.card_data.id,
            'pos': [pos.left, pos.top, zindex]
        }});
    },


    addCardToBoard: function(data) {
        var self = this;
        var card = $('<div class="card draggable"></div>');
        card.card_data = {id: data.id, player: data.player, card: data.card};
        card.css(this.deck.style);
        card.css('background-image', 'url("' + this.deck.cards[data.card] + '")');
        card.draggable({
            stack: '.card',
            snap: true,
            stop: function() { self.updateCard(card); }
        });
        card.css('position', 'absolute');

        if (this.player_id == data.player) {
            card.offset({left: data.pos[0], top: data.pos[1]});
        }
        else {
            card.offset($('#deck').offset());
            card.animate({ left: data.pos[0], top: data.pos[1] }, 250);
        }
        restackDraggables('.card', card);
        this.cards[data.id] = card;
        $('#board').append(card);
    },


    opened: function() {
        displayMessage('Socket opened');
        displayMessage('<a href="' + location.protocol + '//' + location.host
            + '?code=' + this.code + '" target="_blank">Invite link</a>');
        this.send({join: {code: this.code, name: this.player_name}});
    },


    closed: function() {
        displayMessage('Socket closed');
        $('#sessionTabs').show();
        this.ws = null;
    },


    send: function(data) {
      this.ws.send(JSON.stringify(data));
    },


    mergeVars: function(vars) {
        for (player in vars) {
            for (key in vars[player]) {
                this.player_vars[player][key] = vars[player][key];
            }
        }
        this.updateState();
    },


    updateState: function(state) {
        var self = this;

        if (state) {
            this.state = state;
        }

        var deck = $('#deck');

        if (this.state === 'start') {

            var deck_back = 'url("' + this.deck.back + '")';

            console.log(1, deck);
            deck.css(this.deck.style);
            console.log(2);
            deck.css('background-image', deck_back);
            console.log(3);
            deck.addClass('card');
            console.log(4);
            // deck.click(function() { game.drawCard() });

            var drag_helper = $('<div class="card"></div>');
            console.log(5);
            drag_helper.css(this.deck.style);
            console.log(6);
            drag_helper.css('background-image', deck_back);
            console.log(7);
            deck.draggable({
                snap: true,
                helper: function() { return drag_helper },
                stop: function(e, ui) { self.drawCard([ui.offset.left, ui.offset.top]); },
                zIndex: 1000
            });
            console.log(8);

            this.updateDeck();
            console.log(9);

            this.state = 'playing';
        }
        else if (this.state === 'playing') {
            this.updateDeck();
        }
    },


    drawCard: function(pos) {
       this.send({'draw': pos});
    },


    myVars: function() {
        return this.player_vars[this.player_id];
    },


    updateDeck: function() {
        var deck = $('#deck');

        deck.empty();
        var number = $('<div class="number">' + this.myVars().cards_left + '</div>');
        number.disableSelection();
        deck.append(number);
        number.css('padding-top', (deck.height() - number.height()) * 0.5);
    }
};
