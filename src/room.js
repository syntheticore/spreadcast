var _ = require('eakwell');

var Socket = require('./socket.js');
var Broadcast = require('./broadcast.js');
var Storage = require('./storage.js');

var Room = function(roomName, cb) {
  Socket.init();
  var self = this;

  var publisher;
  var receivers = {};

  var socket = new Socket.Socket();
  var storage = new Storage();

  socket.onerror = function(error) {
    console.log('WebSocket Error', error);
  };

  socket.onmessage = function(data) {
    switch(data.type) {
      case 'joinedRoom':
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
    var receiver = new Broadcast(roomName, !!self.onRemoveStream);
    receiver.receive(streamId, function(error, video) {
      if(error) return console.error(error);
      self.onAddStream(video);
      receiver.onStop = function() {
        self.onRemoveStream && self.onRemoveStream(video);
      };
    });
    receivers[streamId] = receiver;
  };

  self.publish = function(constraints, cb) {
    if(publisher) return;
    publisher = new Broadcast(roomName);
    publisher.publish(constraints, cb);
  };

  self.unpublish = function() {
    if(publisher) publisher.stop();
    publisher = null;
  };

  self.record = function(cb) {
    if(!publisher) throw 'Not publishing';

    // Record local stream to disk
    var recordId = _.uuid();
    var stopRecord = publisher.record(function(chunk) {
      storage.store(chunk, recordId);
    }, 50000);

    // Start uploading chunks to the server
    var uploading = true;
    var uploadingFinished = false;

    var uploadChunks = function() {
      if(uploadingFinished) return;
      storage.retrieve(recordId).then(function(chunk) {
        return cb(chunk);
      }).then(uploadChunks).catch(function() {
        if(!uploading) uploadingFinished = true;
        return _.delay(1000).then(uploadChunks);
      });
    };
    uploadChunks();

    publisher.onStop = function() {
      stopRecord();
      uploading = false;
    };

    return publisher.onStop;
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
