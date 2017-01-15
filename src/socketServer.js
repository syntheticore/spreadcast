var websocket = require('ws');
var _ = require('eakwell');

var SocketServer = function(options) {
  var self = this;

  var wss = options.socketServer || new websocket.Server({server: options.server});
  var channel = options.channel || 'spreadcast';
  var pingInterval = 10 * 1000;

  wss.on('connection', function(socket) {
    var socks = {};

    var ping = setInterval(function() {
      if(socket.ping) socket.ping(null, null, true);
    }, pingInterval);

    socket.on('message', function(msg) {
      msg = JSON.parse(msg);
      if(msg.channel != channel) return;

      if(msg.type == 'initSocket') {
        var sock = {
          send: function(data) {
            try {
              data.channel = channel;
              data.sessionId = msg.sessionId;
              socket.send(JSON.stringify(data));
            } catch(e) {}
          }
        };
        socks[msg.sessionId] = sock;
        self.onConnection(sock);
      } else if(msg.type == 'closeSocket') {
        var sock = socks[msg.sessionId];
        sock.onClose && sock.onClose();
        delete socks[msg.sessionId];
      } else {
        var sock = socks[msg.sessionId];
        sock && sock.onMessage && sock.onMessage(msg);
      }
    });

    socket.on('close', function() {
      clearInterval(ping);
      _.each(socks, function(sock) {
        sock.onClose && sock.onClose();
      });
    });
  });
};

module.exports = SocketServer;
