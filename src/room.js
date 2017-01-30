var _ = require('eakwell');

var Socket = require('./socket.js');
var Broadcast = require('./broadcast.js');
var Storage = require('./storage.js');

var Room = function(roomName) {
  var self = this;

  var publisher;
  var receivers = {};

  var socket = new Socket();
  var storage = new Storage();

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
      publisher = new Broadcast(userName || _.uuid(), roomName);
      publisher.publish(constraints, function(error, video) {
        if(error) return fail(error);
        ok(video);
      });
    });
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
      uploading = false;
      stopRecord && stopRecord();
      stopRecord = null;
    };

    return publisher.onStop;
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
