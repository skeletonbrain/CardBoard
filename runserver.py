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


MAX_PLAYERS = 2

ROOT = os.path.dirname(__file__)


settings = dict(
    debug = True,
    cookie_secret = 'TODO:customkeyhere',
    xsrf_cookies = True,
    autoescape = None,
    template_path = os.path.join(ROOT, 'templates'),
    static_path = os.path.join(ROOT, 'static'),
)


class Session(object):
    def __init__(self, code):
        self.clients = []
        self.code = code
        self.timeout = time.time() + 60*5

    def add_client(self, client):
        if len(self.clients) >= MAX_PLAYERS:
            client.write_message({'error': 'there are already two players in this session'})
            client.close()
            return

        if client in self.clients:
            client.write_message({'error': 'you are already connected to this session'})
            return

        self.clients.append(client)
        self.broadcast({'message': '{}/{} clients connected'.format(len(self.clients), MAX_PLAYERS)})

        if len(self.clients) < MAX_PLAYERS:
            self.broadcast({'message': 'invite another player with this code: {}'.format(self.code)})

    def broadcast(self, message):
        for client in self.clients:
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
        if data['join']:
            code = data['join']
            if code in self.sessions:
                self.code = code
                self.session = self.sessions[code]
                self.session.add_client(self)
            else:
                self.write_message({'error': 'no session found'})
                self.close()

    @classmethod
    def cleanup_sessions(cls):
        now = time.time()
        for code, session in cls.sessions.items():
            if session.timeout > now:
                session.kick_clients()
                del cls.sessions[code]

    @classmethod
    def create_session(cls, code):
        cls.cleanup_sessions()
        assert code not in cls.sessions
        cls.sessions[code] = Session(code)

    @classmethod
    def make_session_code(cls):
        while True:
            code = hashlib.sha1(os.urandom(16)).hexdigest()[:8]
            if code not in cls.sessions:
                return code


class IndexHandler(tornado.web.RequestHandler):
    def get(self):
        data = {}
        self.render('index.html', **data)


class SessionHandler(tornado.web.RequestHandler):
    def post(self, mode):
        if mode == 'create':
            self.create(self.get_argument('url'))

    def create(self, url):
        # TODO: validate url
        data = {
            'code': CardSocketHandler.make_session_code()
        }
        CardSocketHandler.create_session(data['code'])
        print 'session create for url {}'.format(url)
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

