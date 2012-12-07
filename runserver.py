#!/usr/bin/env python

import tornado.httpserver
import tornado.websocket
import tornado.ioloop
import tornado.web
import tornado.escape

import os
import hashlib
import time
import json
import random


MAX_PLAYERS = 2

ROOT = os.path.dirname(__file__)

DECKS = {
    'Standard 52 Cards': 'static/decks/playing_cards.json'
}


settings = dict(
    debug = True,
    cookie_secret = 'TODO:customkeyhere',
    xsrf_cookies = True,
    autoescape = None,
    template_path = os.path.join(ROOT, 'templates'),
    static_path = os.path.join(ROOT, 'static'),
)


class Session(object):
    def __init__(self, code, deck):
        self.clients = []
        self.client_decks = {}
        self.client_id = {}
        self.code = code
        self.timeout = time.time() + 60*5
        self.deck_cards = []
        self.card_back = ''
        self.card_style = {}
        self.read_deck(deck)
        self.cards = {}

    def read_deck(self, deck):
        data = tornado.escape.json_decode(open(deck, 'r').read())
        path = os.path.dirname(deck)
        self.deck_cards = [path + '/' + card for card in data['cards']]
        self.card_style = data['style']
        self.card_back = path + '/' + data['back']

    def add_client(self, client):
        if len(self.clients) >= MAX_PLAYERS:
            client.write_message({'error': 'there are already {} players in this session'.format(MAX_PLAYERS)})
            client.close()
            return

        if client in self.clients:
            client.write_message({'error': 'you are already connected to this session'})
            return

        self.clients.append(client)
        self.broadcast({'message': '{}/{} clients connected'.format(len(self.clients), MAX_PLAYERS)})

        if len(self.clients) < MAX_PLAYERS:
            self.broadcast({'message': 'invite another player with this code: {}'.format(self.code)})
        else:
            self.start_game()

    def start_game(self):
        self.client_id = {client: num for num,client in enumerate(self.clients)}

        for client in self.clients:
            deck = self.client_decks[client] = list(range(len(self.deck_cards)))
            random.shuffle(deck)

        client_vars = {}
        for num, client in enumerate(self.clients):
            client_vars[num] = {
                'cards_left': len(self.client_decks[client])
            }

        for num, client in enumerate(self.clients):
            message = {
                'state': 'start',
                'message': 'game full, starting',
                'deck': {
                    'cards': self.deck_cards,
                    'back': self.card_back,
                    'style': self.card_style,
                },
                'player_vars': client_vars,
                'player_id': num
            }
            client.write_message(message)

    def on_draw(self, client, pos):
        num = self.client_id[client]
        card = self.client_decks[client].pop()
        card_id = len(self.cards)
        pos = map(int, pos);

        card_data = {
            'player': num,
            'card': card,
            'id': card_id,
            'pos': pos
        }

        self.cards[card_id] = card_data

        message = {
            'spawn_card': card_data,
            'player_vars': {
                num: {
                    'cards_left': len(self.client_decks[client])
                }
            },
            'message': 'player {} drew a card'.format(num)
        }
        self.broadcast(message)

    def on_move(self, client, data):
        card = int(data['id'])
        pos = map(int, data['pos'])
        self.broadcast({'move': {
            'id': card,
            'pos': pos
        }}, skip=client)


    def broadcast(self, message, skip=None):
        for client in (x for x in self.clients if x != skip):
            client.write_message(message)

    def kick_clients(self):
        for client in self.clients:
            client.write_message({'message': 'server is kicking you'})
            client.close()


class CardSocketHandler(tornado.websocket.WebSocketHandler):
    connections = set()
    sessions = {}

    def __init__(self, *args, **kwargs):
        self.code = None
        self.session = None
        tornado.websocket.WebSocketHandler.__init__(self, *args, **kwargs)

    def open(self):
        CardSocketHandler.connections.add(self)
        print 'opened connection'

    def on_close(self):
        CardSocketHandler.connections.remove(self)
        if self.session:
            # drop other clients
            for client in self.session.clients:
                if client is not self:
                    client.write_message({'message': 'client left, destroying session'})
                    client.close()
                    client.session = None
            self.session.clients = []
            self.session = None
            del self.sessions[self.code]

    def on_message(self, message):
        data = tornado.escape.json_decode(message)
        if 'join' in data:
            code = data['join']
            if code in self.sessions:
                self.code = code
                self.session = self.sessions[code]
                self.session.add_client(self)
            else:
                self.write_message({'error': 'no session found'})
                self.close()
        if 'draw' in data:
            self.session.on_draw(self, data['draw'])
        if 'move' in data:
            self.session.on_move(self, data['move'])

    @classmethod
    def cleanup_sessions(cls):
        now = time.time()
        for code, session in cls.sessions.items():
            if session.timeout < now:
                print 'session', code, 'timed out:', session.timeout, now
                session.broadcast('session timed out');
                session.kick_clients()
                del cls.sessions[code]

    @classmethod
    def create_session(cls, code, deck):
        cls.cleanup_sessions()
        assert code not in cls.sessions
        cls.sessions[code] = Session(code, deck)

    @classmethod
    def make_session_code(cls):
        while True:
            code = hashlib.sha1(os.urandom(16)).hexdigest()[:8]
            if code not in cls.sessions:
                return code


class IndexHandler(tornado.web.RequestHandler):
    def get(self):
        data = {
            'decks': sorted(DECKS.keys())
        }
        self.render('index.html', **data)


class SessionHandler(tornado.web.RequestHandler):
    def post(self, mode):
        if mode == 'create':
            self.create(self.get_argument('deck'))

    def create(self, deck):

        if deck not in DECKS:
            self.set_status(400)
            self.finish('unknown deck')
            return

        data = {
            'code': CardSocketHandler.make_session_code()
        }
        CardSocketHandler.create_session(data['code'], DECKS[deck])
        print 'session create for deck {}'.format(deck)
        self.write(json.dumps(data))


application = tornado.web.Application([
    (r'/', IndexHandler),
    (r'/session/(join|create)', SessionHandler),
    (r'/ws', CardSocketHandler),
], **settings)


if __name__=='__main__':
    port = 2100
    #tornado.options.parse_command_line()
    http_server = tornado.httpserver.HTTPServer(application)
    http_server.listen(port)
    print 'Listening on port {}'.format(port)
    tornado.ioloop.IOLoop.instance().start()

