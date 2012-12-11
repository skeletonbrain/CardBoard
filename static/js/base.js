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



function CardStack(container, style) {
    this.container = container;
    this.image = null;
    this.count = null;

    container.css(style);
    container.addClass('card');

    this.setImage = function(image) {
        this.image = image;
        this.container.css('background-image', 'url(' + image + ')');
    }

    this.setCount = function(count) {
        this.count = count;
        this.update();
    }

    this.update = function() {
        var c = this.container;
        c.empty();

        if (this.count) {
            var number = $('<div class="number">' + this.count + '</div>');
            number.disableSelection();
            c.append(number);
            number.css('padding-top', (c.height() - number.height()) * 0.5);
        }
    }
}


var game = {

    ws: null,
    code: null,
    state: null,
    player_id: null,
    player_vars: [],
    deck: {},
    deck_stack: null,
    cards: {},


    restartGame: function() {
        this.ws = null;
        this.code = null;
        this.state = null;
        this.player_id = null;
        this.player_vars = [];
        this.deck = {};
        this.deck_stack = null;
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
        this.decorateCard(card, this.deck.cards[data.card]);
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


    decorateCard: function(container, image) {
        container.addClass('card');
        container.css(game.deck.style);
        if (image) {
            container.css('background-image', 'url(' + image + ')');
        }
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

            this.deck_stack = new CardStack(deck, this.deck.style);
            this.deck_stack.setImage(this.deck.back);

            var drag_helper = $('<div class="card"></div>');
            this.decorateCard(drag_helper, this.deck.back);
            drag_helper.style = deck[0].style;
            deck.draggable({
                snap: true,
                helper: function() { return drag_helper },
                stop: function(e, ui) { self.drawCard([ui.offset.left, ui.offset.top]); },
                zIndex: 1000
            });

            this.deck_stack.setCount(this.myVars().cards_left);

            this.state = 'playing';
        }
        else if (this.state === 'playing') {
            this.deck_stack.setCount(this.myVars().cards_left);
        }
    },


    drawCard: function(pos) {
       this.send({'draw': pos});
    },


    myVars: function() {
        return this.player_vars[this.player_id];
    },
};
