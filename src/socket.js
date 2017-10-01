var _ = require('eakwell');

var sockets = {};

var Socket = function(options) {
  var channel, url;

  switch(typeof options) {
    case 'object':
      channel = options.channel;
      url = options.url;
      break;
    case 'string':
      channel = options;
      break;
  }

  channel = channel || 'spreadcast';
  url = url || location.origin.replace(/^http/, 'ws');

  var self = this;

  var socket = init(url);

  self.channel = channel || 'spreadcast';
  self.sessionId = _.uuid();

  self.send = function(data) {
    socket._ready.then(function() {
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
    if(!_.remove(socket._instances, self)) return;
    self.onclose && self.onclose();
    self.send({
      type: '_closeSocket'
    });
    if(!socket._instances.length) close(socket);
  };

  socket._instances.push(self);

  self.send({
    type: '_initSocket'
  });
};

var openSocket = function(url) {
  var socket = sockets[url] = new WebSocket(url);
  socket._url = url;
  socket._ready = new Promise(function(ok) {
    socket.onopen = ok;
  });
  socket._shutdown = false;
  socket.onclose = function(e) {
    if(socket._shutdown) return;
    // Reconnect socket
    _.defer(function() {
      openSocket();
      _.each(instances, function(sock) {
        sock.onreconnect && sock.onreconnect(e);
      });
    }, 1000);
  };
  return socket;
};

var init = function(url) {
  if (sockets[url]) return sockets[url];

  var socket = openSocket(url);
  socket._instances = [];
  socket.onmessage = function(e) {
    var data = JSON.parse(e.data);
    _.each(socket._instances, function(sock) {
      if(data._socket.channel == sock.channel && data._socket.sessionId == sock.sessionId && sock.onmessage) {
        sock.onmessage(data);
        return true;
      }
    });
  };

  socket.onerror = function(e) {
    _.each(socket._instances, function(sock) {
      sock.onerror && sock.onerror(e);
    });
  };

  socket.onclose = function() {
    _.each(socket._instances, function(sock) {
      sock.onclose && sock.onclose();
    });
  };

  return socket;
};

var close = function(socket) {
  socket._shutdown = true;
  socket.close();
  delete sockets[socket._url];
};

module.exports = Socket;
