var _ = require('eakwell');

var serve = function(options) {
  var wss = options.socketServer || new (require('ws').Server({server: options.server}));

  var rooms = {};
  var maxLeechers = 1;
  var pingInterval = 10 * 1000;

  var closeRoom = function(roomName) {
    var room = rooms[roomName];
    if(!room) return;
    delete rooms[roomName];
    _.each(room.receivers, function(receiver) {
      try {
        send(receiver.socket, {
          type: 'stop',
          roomName: roomName
        });
      } catch(e) {}
    });
  };

  wss.on('connection', function connection(socket) {
    var sessionId = _.uuid();

    var ping = setInterval(function() {
      socket.ping(null, null, true);
    }, pingInterval);

    socket.on('message', function incoming(msg) {
      var data = JSON.parse(msg);
      console.log(data);

      switch(data.type) {
        case 'openRoom':
          var room = {
            name: data.name,
            sender: {
              id: sessionId,
              socket: socket,
              leechers: {}
            },
            receivers: {}
          };
          rooms[room.name] = room;
          break;

        case 'joinRoom':
          var room = rooms[data.roomName];
          if(!room) return;
          var sock;
          var depth;
          if(_.size(room.sender.leechers) < maxLeechers) {
            // Send offer to original publisher
            room.sender.leechers[sessionId] = {id: sessionId};
            sock = room.sender.socket;
            depth = 1;
          } else {
            // Find uncongested receiver to use as a proxy
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
          send(room.receivers[data.toReceiver].socket, {
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
          return false;
        } else if(room.receivers[sessionId]) {
          var receiver = room.receivers[sessionId];
          delete room.receivers[sessionId];
          // Remove leecher entries
          delete room.sender.leechers[sessionId];
          _.each(room.receivers, function(receiver) {
            delete receiver.leechers[sessionId];
          });
          // Send reconnect signal to own leechers
          _.each(receiver.leechers, function(leecher) {
            var sock = room.receivers[leecher.id].socket;
            send(sock, {
              type: 'reconnect'
            });
          });
        }
      });
    });
  });

  var send = function(socket, data) {
    socket.send(JSON.stringify(data));
  };
};

module.exports = serve;
