var _ = require('eakwell');
var websocket = require('ws');

var Spreadcast = {
  Socket: require('./socket.js'),
  Client: require('./client.js'),

  serve: function(options) {
    var wss = options.socketServer || new websocket.Server({server: options.server});

    var rooms = {};
    var pingInterval = 10 * 1000;
    var maxLeechers = options.maxLeechers || 3;

    var closeRoom = function(roomName) {
      var room = rooms[roomName];
      if(!room) return;
      delete rooms[roomName];
      _.each(room.receivers, function(receiver) {
        send(receiver.socket, {
          type: 'stop',
          roomName: roomName
        });
      });
    };

    wss.on('connection', function(socket) {
      var sessionId = _.uuid();

      var ping = setInterval(function() {
        if(socket.ping) socket.ping(null, null, true);
      }, pingInterval);

      socket.on('message', function(msg) {
        var data = JSON.parse(msg);
        if(!data._spreadcast) return;

        console.log(data);

        switch(data.type) {
          case 'openRoom':
            var room = rooms[data.name];
            if(room) return send(socket, {
              type: 'error',
              msg: 'RoomNameTaken'
            });
            room = {
              name: data.name,
              sender: {
                id: sessionId,
                socket: socket,
                leechers: {}
              },
              receivers: {}
            };
            rooms[room.name] = room;
            send(socket, {type: 'roomCreated'});
            break;

          case 'joinRoom':
            var room = rooms[data.roomName];
            if(!room) return send(socket, {
              type: 'error',
              msg: 'NoSuchRoom'
            });
            var sock;
            var depth;
            if(_.size(room.sender.leechers) < maxLeechers) {
              // Send offer to original publisher
              room.sender.leechers[sessionId] = {id: sessionId};
              sock = room.sender.socket;
              depth = 1;
            } else {
              // Find uncongested receiver to use as a relay
              var freeReceivers = _.select(room.receivers, function(receiver) {
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
            room.receivers[sessionId] = {
              socket: socket,
              depth: depth,
              leechers: {}
            };
            send(sock, {
              type: 'offer',
              offer: data.offer,
              fromReceiver: sessionId
            });
            break;

          case 'closeRoom':
            closeRoom(data.roomName);
            break;

          case 'answer':
            var room = rooms[data.roomName];
            if(!room) return;
            var receiver = room.receivers[data.toReceiver];
            if(!receiver) return;
            send(receiver.socket, {
              type: 'answer',
              answer: data.answer,
              fromSender: sessionId
            });
            break;

          case 'iceCandidate':
            var room = rooms[data.roomName];
            if(!room) return;
            var sock;
            if(room.sender.id == data.to) {
              sock = room.sender.socket;
            } else {
              sock = room.receivers[data.to].socket;
            }
            send(sock, {
              type: 'iceCandidate',
              candidate: data.candidate,
              from: sessionId
            });
            break;
        }
      });

      socket.on('close', function() {
        clearInterval(ping);
        _.each(rooms, function(room, name) {
          if(room.sender.id == sessionId) {
            // Publisher went away -> Terminate stream
            closeRoom(name);
            return true;
          } else if(room.receivers[sessionId]) {
            // Remove leecher entries
            var dropMsg = {
              type: 'dropReceiver',
              receiverId: sessionId
            };
            delete room.sender.leechers[sessionId];
            send(room.sender.socket, dropMsg);
            _.each(room.receivers, function(receiver) {
              delete receiver.leechers[sessionId];
              send(receiver.socket, dropMsg);
            });
            // Send reconnect signal to own leechers
            _.each(room.receivers[sessionId].leechers, function(leecher) {
              var sock = room.receivers[leecher.id].socket;
              send(sock, {
                type: 'reconnect'
              });
            });
            // Delete receiver
            delete room.receivers[sessionId];
            return true;
          }
        });
      });
    });

    var send = function(socket, data) {
      try {
        data._spreadcast = true;
        socket.send(JSON.stringify(data));
      } catch(e) {}
    };
  }
};

module.exports = Spreadcast;
