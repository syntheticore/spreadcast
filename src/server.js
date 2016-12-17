var _ = require('eakwell');

var serve = function(server) {
  var WebSocketServer = require('ws').Server;
  var wss = new WebSocketServer({server: server});

  var rooms = {};

  wss.on('connection', function connection(socket) {
    var sessionId = _.uuid();

    socket.on('message', function incoming(msg) {
      var data = JSON.parse(msg);
      console.log(data);

      switch(data.type) {
        case 'openRoom':
          var room = {
            name: data.name,
            sender: {
              id: sessionId,
              socket: socket
            },
            receivers: {}
          };
          rooms[room.name] = room;
          break;

        case 'joinRoom':
          var room = rooms[data.roomName];
          if(!room) return;
          var sock = room.sender.socket;
          if(_.keys(room.receivers).length >= 1) {
            sock = room.receivers[_.keys(room.receivers)[0]];
          }
          room.receivers[sessionId] = socket;
          send(sock, {
            type: 'offer',
            offer: data.offer,
            fromReceiver: sessionId
          });
          break;

        case 'answer':
          var room = rooms[data.roomName];
          if(!room) return;
          send(room.receivers[data.toReceiver], {
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
            sock = room.receivers[data.to];
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
      _.each(rooms, function(room, name) {
        if(room.sender.id == sessionId) {
          delete rooms[name];
          _.each(room.receivers, function(sock) {
            try {
              send(sock, {
                type: 'stop',
                roomName: name
              });
            } catch(e) {}
          });
          return false;
        } else if(room.receivers[sessionId]) {
          delete room.receivers[sessionId];
        }
      });
    });
  });

  var send = function(socket, data) {
    socket.send(JSON.stringify(data));
  };
};

module.exports = serve;
