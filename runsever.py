#!/usr/bin/env python

import tornado.httpserver
import tornado.websocket
import tornado.ioloop
import tornado.web

import os


class WSHandler(tornado.websocket.WebSocketHandler):
    def open(self):
        print 'opened connection'
        self.write_message('testing new connection')

    def on_message(self, message):
        print 'got message {}'.format(message)

    def on_close(self):
        print 'closed connection'


class IndexHandler(tornado.web.RequestHandler):
    def get(self):
        self.redirect('/static/html/index.html')


static_path = os.path.join(os.path.dirname(__file__), 'static')


settings = {
    'debug': True,
}


application = tornado.web.Application([
    (r'/', IndexHandler),
    (r'/ws', WSHandler),
    (r'/static/(.*)', tornado.web.StaticFileHandler, {'path': static_path}),
], **settings)



if __name__=='__main__':
    port = 8000
    http_server = tornado.httpserver.HTTPServer(application)
    http_server.listen(port)
    print 'Listening on port {}'.format(port)
    tornado.ioloop.IOLoop.instance().start()

