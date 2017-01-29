var _ = require('eakwell');

var socket;
var socketReady;
var instances = [];
var shutdown = false;

var Socket = function(channel) {
  var self = this;

  self.channel = channel || 'spreadcast';
  self.sessionId = _.uuid();

  self.send = function(data) {
    socketReady.then(function() {
      data._socket = {
        channel: self.channel,
        sessionId: self.sessionId
      };
      try {
        if(socket) socket.send(JSON.stringify(data));
      } catch(e) {}
    });
  };

  self.close = function() {
    if(!_.remove(instances, self)) return;
    self.onclose && self.onclose();
    self.send({
      type: '_closeSocket'
    });
  };

  instances.push(self);

  self.send({
    type: '_initSocket'
  });
};

var openSocket = function() {
  socket = new WebSocket(location.origin.replace(/^http/, 'ws'));
  socketReady = new Promise(function(ok) {
    socket.onopen = ok;
  });
  socket.onclose = function() {
    if(shutdown) return;
    // Reconnect socket
    _.defer(function() {
      openSocket();
      _.each(instances, function(sock) {
        sock.onreconnect && sock.onreconnect(e);
      });
    }, 1000);
  };
}

var init = function() {
  if(socket) return;

  openSocket();

  socket.onmessage = function(e) {
    var data = JSON.parse(e.data);
    _.each(instances, function(sock) {
      if(data._socket.channel == sock.channel && data._socket.sessionId == sock.sessionId && sock.onmessage) {
        sock.onmessage(data);
        return true;
      }
    });
  };

  socket.onerror = function(e) {
    _.each(instances, function(sock) {
      sock.onerror && sock.onerror(e);
    });
  };

  socket.onclose = function() {
    _.each(instances, function(sock) {
      sock.onclose && sock.onclose();
    });
  };
};

var close = function() {
  shutdown = true;
  if(socket) socket.close();
  socket = null;
  instances = [];
};

module.exports = {
  init: init,
  close: close,
  Socket: Socket
};
