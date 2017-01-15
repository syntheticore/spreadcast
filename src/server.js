var _ = require('eakwell');
var websocket = require('ws');

var SocketServer = require('./socketServer.js');

var Spreadcast = {
  Socket: require('./socket.js'),
  Broadcast: require('./broadcast.js'),
  Room: require('./room.js'),

  serve: function(options) {
    var wss = new SocketServer(options);

    var rooms = {};
    var broadcasts = {};
    var maxLeechers = options.maxLeechers || 3;
    var sessionIds = {};

    var closeBroadcast = function(broadcastName) {
      var broadcast = broadcasts[broadcastName];
      if(!broadcast) return;
      delete broadcasts[broadcastName];
      _.each(broadcast.receivers, function(receiver) {
        receiver.socket.send({
          type: 'stop',
          broadcastName: broadcastName
        });
      });
    };

    wss.onConnection = function(socket) {
      var sessionId = _.uuid()

      socket.onMessage = function(data) {
        switch(data.type) {
          case 'publishStream':
            var broadcast = broadcasts[data.name];
            if(broadcast) return socket.send({
              type: 'error',
              msg: 'BroadcastNameTaken'
            });
            broadcast = {
              name: data.name,
              sender: {
                id: sessionId,
                socket: socket,
                leechers: {}
              },
              receivers: {}
            };
            broadcasts[broadcast.name] = broadcast;
            socket.send({type: 'broadcastCreated'});
            break;

          case 'receiveStream':
            var broadcast = broadcasts[data.broadcastName];
            if(!broadcast) return socket.send({
              type: 'error',
              msg: 'NoSuchBroadcast'
            });
            var sock;
            var depth;
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
            broadcast.receivers[sessionId] = {
              socket: socket,
              depth: depth,
              leechers: {}
            };
            sock.send({
              type: 'offer',
              offer: data.offer,
              fromReceiver: sessionId
            });
            break;

          case 'closeBroadcast':
            closeBroadcast(data.broadcastName);
            break;

          case 'answer':
            var broadcast = broadcasts[data.broadcastName];
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
            var broadcast = broadcasts[data.broadcastName];
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

          case 'join':
            var room = rooms[data.roomName];
            if(!room) {
              room = {
                name: data.roomName,
                clients: {},
                streams: {}
              };
              rooms[data.roomName] = room;
            }
            room.clients[sessionId] = {
              id: sessionId,
              socket: socket
            };
            socket.send({
              type: 'joinedRoom',
              streams: room.streams,
              session: sessionId
            });
            break;

          case 'publish':
            var room = rooms[data.roomName];
            room.streams[sessionId] = sessionId;
            _.each(room.clients, function(client) {
              if(client.id != sessionId) client.socket.send({
                type: 'addStream',
                streamId: sessionId
              });
            });
            break;
        }
      };

      socket.onClose = function() {
        _.each(broadcasts, function(broadcast, name) {
          if(broadcast.sender.id == sessionId) {
            // Publisher went away -> Terminate stream
            closeBroadcast(name);
            return true;
          } else if(broadcast.receivers[sessionId]) {
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
            return true;
          }
        });
        _.each(rooms, function(room, name) {
          if(room.clients[sessionId]) {
            delete room.clients[sessionId];
            delete room.streams[sessionId];
            if(!_.keys(room.clients).length) {
              delete rooms[name];
            }
            return true;
          }
        });
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
