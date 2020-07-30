var _ = require('eakwell');

var Socket = require('./socket.js');
var Broadcast = require('./broadcast.js');

var Room = function(roomName) {
  var self = this;

  self.name = roomName;

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
    var receiver = new Broadcast(streamId, roomName, !!self.onRemoveStream);
    receiver.receive(function(error, video) {
      if(error) return console.error(error);
      self.onAddStream(video, streamId);
      receiver.onStop = function() {
        self.onRemoveStream && self.onRemoveStream(video, streamId);
      };
    });
    receivers[streamId] = receiver;
  };

  self.publish = function(constraints, userName) {
    return new Promise(function(ok, fail) {
      if(publisher) return fail('Publishing already');
      userName = userName || _.uuid();
      publisher = new Broadcast(userName, roomName);
      publisher.publish(constraints, function(error, video) {
        if(error) {
          publisher = null;
          return fail(error);
        }
        ok(video);
      });
    });
  };

  self.unpublish = function() {
    publisher && publisher.stop();
    publisher = null;
  };

  self.record = function(cb) {
    if(!publisher) throw 'Not publishing';
    return publisher.record(cb);
  };

  self.snapshot = function() {
    return publisher && publisher.snapshot();
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
