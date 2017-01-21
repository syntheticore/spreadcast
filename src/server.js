var _ = require('eakwell');
var websocket = require('ws');

var SocketServer = require('./socketServer.js');

var Spreadcast = {
  Socket: require('./socket.js'),
  Room: require('./room.js'),
  Storage: require('./storage.js'),
  SocketServer: SocketServer,

  serve: function(options) {
    var wss = new SocketServer(options);

    var rooms = {};
    var roomsByClient = {};
    var broadcastsByPublisher = {};
    var broadcastsByReceiver = {};
    var maxLeechers = options.maxLeechers || 3;
    var sessionIds = {};

    var closeBroadcast = function(publisherId) {
      var broadcast = broadcastsByPublisher[publisherId];
      if(!broadcast) return;
      delete broadcastsByPublisher[publisherId];
      delete broadcast.room.broadcasts[broadcast.name];
      _.each(broadcast.receivers, function(receiver) {
        receiver.socket.send({
          type: 'stop'
        });
      });
    };

    wss.onConnection = function(socket) {
      var sessionId = _.uuid()

      socket.onMessage = function(data) {
        switch(data.type) {

          case 'join':
            var room = rooms[data.roomName];
            if(!room) {
              room = {
                name: data.roomName,
                clients: {},
                broadcasts: {}
              };
              rooms[data.roomName] = room;
            }
            room.clients[sessionId] = {
              id: sessionId,
              socket: socket
            };
            roomsByClient[sessionId] = room;
            socket.send({
              type: 'joinedRoom',
              streams: _.keys(room.broadcasts)
            });
            break;

          case 'publishStream':
            var room = rooms[data.roomName];
            if(!room) return;

            var broadcast = {
              room: room,
              name: data.broadcastName,
              sender: {
                id: sessionId,
                socket: socket,
                leechers: {}
              },
              receivers: {}
            };

            room.broadcasts[data.broadcastName] = broadcast;
            broadcastsByPublisher[sessionId] = broadcast;
            _.each(room.clients, function(client) {
              if(client.socket.deviceId != socket.deviceId) client.socket.send({
                type: 'addStream',
                name: data.broadcastName
              });
            });
            break;

          case 'receiveStream':
            var room = rooms[data.roomName];
            if(!room) return;
            var broadcast = room.broadcasts[data.broadcastName];
            if(!broadcast) return;

            // Check if receiver is already publishing to the same room
            var directConnect = _.any(broadcast.room.broadcasts, function(stream) {
              return stream.sender.socket.deviceId == socket.deviceId;
            });

            var sock;
            var depth;
            var minLeechers = _.keys(broadcast.room.broadcasts).length;
            if(_.size(broadcast.sender.leechers) < maxLeechers) {
              // Send offer to original publisher
              broadcast.sender.leechers[sessionId] = {id: sessionId};
              sock = broadcast.sender.socket;
              depth = 1;
            } else {
              // Find uncongested receiver to use as a relay
              var freeReceivers = _.select(broadcast.receivers, function(receiver) {
                return _.size(receiver.leechers) < maxLeechers;
              });
              // Prefer nodes closer to the original publisher
              var bestReceiver = _.minBy(freeReceivers, function(receiver) {
                return receiver.depth * maxLeechers + _.size(receiver.leechers);
              });
              bestReceiver.leechers[sessionId] = {id: sessionId};
              sock = bestReceiver.socket;
              depth = bestReceiver.depth + 1;
            }
            var receiver = {
              socket: socket,
              depth: depth,
              leechers: {}
            };
            broadcast.receivers[sessionId] = receiver;
            broadcastsByReceiver[sessionId] = broadcast;
            sock.send({
              type: 'offer',
              offer: data.offer,
              fromReceiver: sessionId
            });
            break;

          case 'closeBroadcast':
            closeBroadcast(sessionId);
            break;

          case 'answer':
            var room = rooms[data.roomName];
            if(!room) return;
            var broadcast = room.broadcasts[data.broadcastName];
            if(!broadcast) return;
            var receiver = broadcast.receivers[data.toReceiver];
            if(!receiver) return;
            receiver.socket.send({
              type: 'answer',
              answer: data.answer,
              fromSender: sessionId
            });
            break;

          case 'iceCandidate':
            var room = rooms[data.roomName];
            if(!room) return;
            var broadcast = room.broadcasts[data.broadcastName];
            if(!broadcast) return;
            var sock;
            if(broadcast.sender.id == data.to) {
              sock = broadcast.sender.socket;
            } else {
              sock = broadcast.receivers[data.to].socket;
            }
            sock.send({
              type: 'iceCandidate',
              candidate: data.candidate,
              from: sessionId
            });
            break;
        }
      };

      socket.onClose = function() {
        var broadcast;
        if(broadcast = broadcastsByPublisher[sessionId]) {
          // Publisher went away -> Terminate stream
          closeBroadcast(sessionId);
        } else if(broadcast = broadcastsByReceiver[sessionId]) {
          // Remove leecher entries
          var dropMsg = {
            type: 'dropReceiver',
            receiverId: sessionId
          };
          delete broadcast.sender.leechers[sessionId];
          broadcast.sender.socket.send(dropMsg);
          _.each(broadcast.receivers, function(receiver) {
            delete receiver.leechers[sessionId];
            receiver.socket.send(dropMsg);
          });
          // Send reconnect signal to own leechers
          _.each(broadcast.receivers[sessionId].leechers, function(leecher) {
            var sock = broadcast.receivers[leecher.id].socket;
            sock.send({
              type: 'reconnect'
            });
          });
          // Delete receiver
          delete broadcast.receivers[sessionId];
          delete broadcastsByReceiver[sessionId];
        } else {
          var room = roomsByClient[sessionId];
          if(room) {
            delete room.clients[sessionId];
            delete roomsByClient[sessionId];
            if(!_.keys(room.clients).length) {
              delete rooms[room.name];
            }
          }
        }
      };
    };
  }
};

if(typeof window !== 'undefined') {
  _.each(require('webrtc-adapter').browserShim, function(shim) {
    shim();
  });
}

module.exports = Spreadcast;
