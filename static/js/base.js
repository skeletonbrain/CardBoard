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



function CardStack(container, deck, scale) {
    this.container = container;
    this.count = null;
    this.scale = scale || 1;

    container.css(deck.style);
    container.addClass('card');
    if (scale) {
        container.width(container.width() * scale);
        container.height(container.height() * scale);
    }

    this.image = deck.back;
    this.container.css('background-image', 'url(' + this.image + ')');

    this.setCount = function(count) {
        this.count = count;
        this.update();
    }

    this.update = function() {
        var c = this.container;
        c.empty();


        if (this.count) {
            var number = $('<div class="number">').text(this.count);
            number.disableSelection();
            c.append(number);
            number.css('font-size', (this.scale-0.15)  + 'in');
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
    player_decks: [],
    deck: {},
    cards: {},
    queued_cards: { hand: [] },


    restartGame: function() {
        this.ws = null;
        this.code = null;
        this.state = null;
        this.player_id = null;
        this.player_vars = [];
        this.player_decks = [];
        this.deck = {};
        this.cards = {};
        this.queued_cards = { hand: [] };

        $('#board').empty();
        $('#deck').empty();
        $('#hand').empty();
    },


    resize: function() {
        if (this.deck.style) {
            $('#hand').height(this.deck.style.height);
        }

        var height = $(window).height();

        $.each([
            $('#messages'),
            $('#sessionTabs')
        ], function(idx, elem) {
            if (elem.is(':visible')) {
              height -= elem.outerHeight(true);
            }
        });

        $('#board').outerHeight(height);
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
        if ('deck' in data) {
            displayMessage('Loaded new deck');
            this.deck = data.deck;
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
        if ('spawn_card' in data) {
            this.addCard(data.spawn_card);
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
        this.send({'move': {
            'id': card.card_data.id,
            'pos': [pos.left, pos.top]
        }});
    },


    addCard: function(data) {
        var self = this;
        var card = $('<div class="card draggable"></div>');
        card.card_data = {id: data.id, player: data.player, card: data.card};
        this.decorateCard(card, this.deck.cards[data.card]);
        card.draggable({
            stack: '.card',
            snap: true,
            stop: function() { self.updateCard(card); },
            connectToSortable: "#hand"
            // containment: 'window'
        });

        if (data.target == 'board') {
            card.css('position', 'absolute');
            restackDraggables('.card', card);
            this.cards[data.id] = card;
            $('#board').append(card);

            if (this.player_id == data.player) { // spawn instantly for our own cards
                card.offset({left: data.pos[0], top: data.pos[1]});
            }
            else { // animate other player's cards so we can tell where they come from
                card.offset($('#player-' + data.player).find('.deck').offset());
                card.animate({ left: data.pos[0], top: data.pos[1] }, 250);
            }
        }
        else if (data.target == 'hand') {
            var placeholder = self.queued_cards.hand.pop();
            card.css('position', 'static');
            placeholder.replaceWith(card);
            // placeholder.remove();
            // card.appendTo($('#hand'));
            // $('#hand').sortable('refresh');
        }

    },


    buildBoard: function() {
        var self = this;

        var deck = $('#deck');

        var drag_helper = $('<div class="card draggable"></div>');
        this.decorateCard(drag_helper, self.deck.back);
        drag_helper.style = deck[0].style;
        deck.draggable({
            snap: true,
            helper: function() { return drag_helper.clone() },
            zIndex: 1000,
            connectToSortable: "#hand"
        });

        $('#hand')[0].innerHTML = '&nbsp;';

        // we need to keep track of the cards as they drag over the hand
        // otherwise they will trigger drop events on the board
        var over_hand = false;

        //var drop_target = $('<div id="hand_drop" class="rounded">drop target</div>');
        //this.decorateCard(drop_target);
        $('#hand').sortable({
            revert: true,
            axis: 'x',
            // containment: 'parent',
            receive: function(event, ui) {
                if (ui.item.hasClass('deck-draggable')) {
                    var elem = $('#hand').find('.deck-draggable');
                    elem.empty(); // strip numbers
                    elem.removeClass('deck-draggable');
                    elem.addClass('card-draw-target');
                    self.queued_cards.hand.push(elem);
                    self.drawCard('hand', [0,0]);
                }
                else {
                    console.log('hand received item', ui.item);
                    // ui.item.css('position', 'static');
                }
            },
            over: function() {
                over_hand = true;
            },
            out: function() {
                over_hand = false;
            },
            stop: function() {
                // $('#hand .card').css({'position': 'static'});
                // console.log('setting cards to static', $('#hand .card'))
            }
        });

        $('#board').droppable({
            drop: function (event, ui) {
                var elem = ui.draggable;
                if (elem.hasClass('deck-draggable') && !over_hand) {
                    self.drawCard('board', [ui.offset.left, ui.offset.top]);
                }
            }
        });
    },


    decorateCard: function(container, image) {
        container.addClass('card');
        container.css(this.deck.style);
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
        var self = this;

        for (player in vars) {
            var current_vars = this.player_vars[player];
            for (key in vars[player]) {
                current_vars[key] = vars[player][key];
            }
            this.updatePlayer(player);
        }
        this.updateState();
    },

    updatePlayer: function(player) {
        var self = this;

        var deck = self.player_decks[player];
        var vars = self.player_vars[player];
        var display = $('#player-' + player);

        deck.setCount(vars.cards_left);
        display.find('.hand').text(vars.cards_hand);
    },

    updateState: function(state) {
        var self = this;

        if (state) {
            this.state = state;
        }

        if (this.state === 'start') {
            this.buildBoard();

            this.buildPlayers();

            this.resize();

            this.state = 'playing';
        }
        else if (this.state === 'playing') {
            this.player_decks[this.player_id].setCount(this.myVars().cards_left);
        }
    },


    drawCard: function(target, pos) {
       this.send({'target': target, 'draw': pos});
    },


    myVars: function() {
        return this.player_vars[this.player_id];
    },

    buildPlayers: function() {
        var self = this;

        var players = $('#players');
        players.empty();
        console.log(self.player_vars);

        $.each(self.player_vars, function (key, vars) {
            var display = $('<div id="player-' + key + '">');

            $('<div class="name">').text(vars.player_name).appendTo(display);

            var deck, scale;
            console.log('is', key, '==', self.player_id, '?');
            if (key == self.player_id) {
                deck = $('#deck');
                scale = 1.0;
            }
            else {
                deck = $('<div class="deck">').appendTo(display);
                display.appendTo(players);
                scale = 0.75;
            }

            var stack = self.player_decks[key] = new CardStack(deck, self.deck, scale);
            stack.setCount(vars.cards_left);

            // deck.width(deck.width()*0.5);

            // display.append('<div class="hand">').text(vars.cards_hand);
            $('<div class="hand">').text(vars.cards_hand).appendTo(display);
        });

        $('#messages').css({
            'max-height': players.height(),
            'min-height': players.height()
        });
    }
};
