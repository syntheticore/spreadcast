var _ = require('eakwell');

var Socket = require('./socket.js');
var Broadcast = require('./broadcast.js');

var Room = function(roomName, cb) {
  Socket.init();
  var self = this;

  var sessionId;
  var publisher;
  var receivers = {};

  var socket = new Socket.Socket();

  socket.onerror = function(error) {
    console.log('WebSocket Error', error);
  };

  socket.onmessage = function(data) {
    switch(data.type) {
      case 'joinedRoom':
        sessionId = data.session;
        cb && cb(null);
        _.each(data.streams, function(streamId) {
          receive(streamId);
        });
        break;

      case 'addStream':
        receive(data.streamId);
        break;
    }
  };

  socket.send({
    type: 'join',
    roomName: roomName
  });

  var receive = function(streamId) {
    var receiver = new Broadcast(streamId, true);
    receiver.receive(function(error, video) {
      if(error) return console.error(error);
      self.onAddStream(video);
      receiver.onStop = function() {
        self.onRemoveStream(video);
      };
    });
    receivers[streamId] = receiver;
  };

  self.publish = function(constraints, cb) {
    publisher = new Broadcast(sessionId);
    publisher.publish(constraints, function(error, video) {
      cb(error, video);
      socket.send({
        type: 'publish',
        roomName: roomName
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
  };
};

module.exports = Room;
