var Socket = function(channel) {
  var self = this;

  var socket = new WebSocket(location.origin.replace(/^http/, 'ws'));
  var socketReady = new Promise(function(ok, fail) {
    socket.onopen = ok;
  });

  socket.onmessage = function(e) {
    var data = JSON.parse(e.data);
    if(!data[channel]) return;
    self.onmessage && self.onmessage(data);
  };

  socket.onerror = function(e) {
    self.onerror && self.onerror(e);
  };

  socket.onclose = function() {
    socket = null;
    self.onclose && self.onclose();
  };

  self.send = function(data) {
    socketReady.then(function() {
      data[channel] = true;
      if(socket) socket.send(JSON.stringify(data));
    });
  };

  self.close = function() {
    if(socket) socket.close();
    socket = null;
  };
};

module.exports = Socket;
