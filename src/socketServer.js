var websocket = require('ws');
var _ = require('eakwell');

var SocketServer = function(options) {
  var self = this;

  var wss = options.socketServer || new websocket.Server({server: options.server});
  var channel = options.channel || 'spreadcast';
  var pingInterval = 10 * 1000;

  wss.on('connection', function(socket) {
    var socketId = _.uuid();
    var socks = {};

    var ping = setInterval(function() {
      if(socket.ping) socket.ping(null, null, true);
    }, pingInterval);

    socket.on('message', function(msg) {
      msg = JSON.parse(msg);
      if(msg._socket.channel != channel) return;
      var sessionId = msg._socket.sessionId;

      if(msg.type == '_initSocket') {
        var sock = {
          deviceId: socketId,
          sessionId: sessionId,
          send: function(data) {
            try {
              data._socket = {
                channel: channel,
                sessionId: sessionId
              };
              socket.send(JSON.stringify(data));
            } catch(e) {}
          }
        };
        socks[sessionId] = sock;
        self.onConnection(sock);
      } else if(msg.type == '_closeSocket') {
        var sock = socks[sessionId];
        sock.onClose && sock.onClose();
        delete socks[sessionId];
      } else {
        var sock = socks[sessionId];
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
