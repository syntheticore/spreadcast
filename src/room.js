var _ = require('eakwell');

var Socket = require('./socket.js');
var Broadcast = require('./broadcast.js');

var Room = function(roomName) {
  var self = this;

  var publisher;
  var receivers = {};

  var socket = new Socket();

  socket.onerror = function(error) {
    console.log('WebSocket Error', error);
  };

  socket.onmessage = function(data) {
    switch(data.type) {
      case 'joinedRoom':
        _.each(data.streams, function(name) {
          receive(name);
        });
        break;

      case 'addStream':
        receive(data.name);
        break;
    }
  };

  socket.send({
    type: 'join',
    roomName: roomName
  });

  var receive = function(streamId) {
    var receiver = new Broadcast(streamId, roomName, true);
    receiver.receive(function(error, video) {
      if(error) return console.error(error);
      self.onAddStream(video, streamId);
      receiver.onStop = function() {
        self.onRemoveStream(video, streamId);
      };
    });
    receivers[streamId] = receiver;
  };

  self.publish = function(constraints, userName) {
    return new Promise(function(ok, fail) {
      publisher = new Broadcast(userName || _.uuid(), roomName);
      publisher.publish(constraints, function(error, video) {
        if(error) return fail(error);
        ok(video);
      });
    });
  };

  self.unpublish = function() {
    if(publisher) publisher.stop();
  };

  self.stop = function() {
    self.unpublish();
    _.each(receivers, function(receiver) {
      receiver.stop();
    });
    receivers = {};
    socket.close();
  };
};

module.exports = Room;
