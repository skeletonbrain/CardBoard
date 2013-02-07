/*
 *  CardBoard Copyright (c) 2012 Matthew Thompson
 *  Licensed under the AGPL v3
 */

$(function(){
    ko.applyBindings(game);
});

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

    showSessionTabs: ko.observable(true),

    ws: null,
    code: null,
    state: null,
    player_id: null,
    currentPlayer: ko.observable(),
    players: ko.observableArray(),
    idToPlayer: {},
    //player_decks: [],
    deck: {},
    cards: {},
    queued_cards: { hand: [] },

    over_hand: false, // hack to keep drop events from firing through the hand div


    restartGame: function() {
        this.ws = null;
        this.code = null;
        this.state = null;
        this.player_id = null;
        this.currentPlayer(null);
        this.players.removeAll();
        this.idToPlayer = {};
        //this.player_decks = [];
        this.deck = {};
        this.cards = {};
        this.queued_cards = { hand: [] };

        this.over_hand = false;

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
                this.initPlayers(data.player_vars);
            }
            else {
                this.mergePlayers(data.player_vars);
            }
        }
        if ('message' in data) {
            displayMessage('server: ' + data.message);
        }
        if ('error' in data) {
            displayError('server: ' + data.error);
        }
        if ('spawn_card' in data) {
            this.onSpawn(data.spawn_card);
        }
        if ('move' in data) {
            this.onMove(data.move);
        }
        // if ('transfer' in data) {
            // this.onTransfer(data.transfer);
        // }
        if ('remove_card' in data) {
            this.onRemove(data.remove_card);
        }

        this.updateState(new_state);
    },

    onMove: function(data) {
        var card = this.cards[data.id];
        card.animate({ left: data.pos[0], top: data.pos[1] }, 250);
        restackDraggables('.card', card);
       //card.css('z-index', data.pos[2]);
    },

    onRemove: function(data) {
        var self = this;

        var card = self.cards[data.id];

        if (data.player != self.player_id) {
            var offset = $('#player-' + data.player).find('.deck').offset();

            card.animate({ left: offset.left, top: offset.top }, {
                complete: function() {
                    card.remove();
                    delete self.cards[data.id];
                },
                duration: 250
            });
        }
    },

    onTransfer: function(data) {
        var card = this.cards[data.id];
        if (data.target == 'hand') {
            // increment player hand counter
            // remove card from board
        }
        else if (data.target == 'board') {
            // decrement player hand counter
            //onSpawn probably
        }
    },


    draggedCard: function(card) {
        var pos = card.offset();
        this.send({'move': {
            'id': $(card).attr('data-cardid'),
            'pos': [pos.left, pos.top]
        }});
    },


    onSpawn: function(data) {
        var self = this;
        var card = $('<div class="card draggable"></div>');
        card.attr({
            'data-cardid': data.id,
            'data-player': data.player,
            'data-container': data.target
        });
        this.decorateCard(card, this.deck.cards[data.card]);
        card.draggable({
            stack: '.card',
            snap: true,
            stop: function() {
                if (!game.over_hand) {
                    self.draggedCard(card);
                }
            },
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
        }
    },

    buildBoard: function() {
        var self = this;

        console.log('player length', self.players.length);
        if (self.players().length > 0) {
            var height = $('#players').height();
            $('#messages').css({
                'max-height': height,
                'min-height': height
            });
        }

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

        $('#hand').sortable({
            revert: true,
            axis: 'x',
            receive: function(event, ui) {
                if (ui.item.hasClass('deck-draggable')) { // card dragged from deck
                    var elem = $('#hand').find('.deck-draggable');
                    elem.empty(); // strip numbers
                    self.queued_cards.hand.push(elem);
                    self.drawCard('hand');
                }
                else { // card dragged from board
                    self.transferCard('hand', ui.item);
                }
            },
            over: function() {
                game.over_hand = true;
            },
            out: function() {
                game.over_hand = false;
            },
            remove: function(event, ui) {
                console.log('sortable remove', ui);
            },
            update: function() {
                // bleh something is up with the sortable, it leaves them position:absolute
                $('#hand .card').css('position', 'static');
            }
        });

        $('#board').droppable({
            drop: function (event, ui) {
                var elem = ui.draggable;
                if (!game.over_hand) {
                    if (!elem.attr('data-container')) { // will be set in onSpawn
                        self.drawCard('board', [ui.offset.left, ui.offset.top]);
                    }
                    else if (elem.attr('data-container') == 'hand') {
                        console.log('dragged from hand to board', elem);
                        var card_id = elem.attr('data-cardid');
                        var card = $('#card-' + card_id)[0];
                        var new_card = card.clone();
                        console.log('made new card', new_card);
                        console.log('setting attrs to', card.attr());
                        new_card.attr(card.attr());
                        console.log('set attrs', new_card.attr());
                        $('#board').append(new_card);
                        self.transferCard('board', new_card);
                    }
                    else {
                        console.log('unidentified drag', elem);
                    }
                }
            }
        });
    },

    cardStyle: function(image, scale) {
        // omit image for the deck's back
        var style = $.extend({}, this.deck.style);
        style.backgroundImage = 'url(' + (image ? image : this.deck.back) + ')';

        if (scale) {
            style.width = style.width * scale;
            style.height = style.height * scale;
        }

        return style;
    },

    decorateCard: function(container, image) {
        container.addClass('card');
        container.css(this.cardStyle(image));
    },

    opened: function() {
        displayMessage('Socket opened');

        var inviteLink = location.protocol + '//' + location.host + '?code=' + this.code;
        displayMessage('<a href="' + inviteLink + '" target="_blank">Invite link</a>');
        window.history.pushState('', 'Game Lobby ' + this.code, inviteLink);

        this.send({join: {code: this.code, name: this.player_name}});
    },


    closed: function() {
        displayMessage('Socket closed');
        this.showSessionTabs(true);
        this.ws = null;
    },

    send: function(data) {
      this.ws.send(JSON.stringify(data));
    },

    initPlayers: function(players) {
        // build players observable and id -> player map
        var self = this;

        self.players($.map(players, function(player, id) {
            var result = {};

            $.each(player, function(key, value) {
                result[key] = ko.observable(value);
            });

            result['id'] = id;
            self.idToPlayer[id] = result;

            if (id == self.player_id) {
                self.currentPlayer(result);
            }

            return result;
        }));
    },

    mergePlayers: function(vars) {
        var self = this;

        for (player_id in vars) {
            var current_vars = this.idToPlayer[player_id];
            for (key in vars[player_id]) {
                current_vars[key](vars[player_id][key]);
            }
        }
    },

    updateState: function(state) {
        var self = this;

        if (state) {
            this.state = state;
        }

        if (this.state === 'start') {
            this.buildBoard();

            //this.buildPlayers();

            this.resize();

            this.state = 'playing';
        }
    },

    drawCard: function(target, pos) {
        if (!pos) {
            pos = [0,0];
        }
        this.send({'draw': {
            'pos': pos,
            'target': target
        }});
    },

    transferCard: function(destination, card) {
        card.attr('data-container', destination);
        console.log('card id', $(card).attr('data-cardid'));
        this.send({'transfer': {
            'target': destination,
            'id': $(card).attr('data-cardid')
        }});
    },
};


