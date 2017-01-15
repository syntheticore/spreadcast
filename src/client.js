_.each(require('webrtc-adapter').browserShim, function(shim) {
  shim();
});

window.Spreadcast = {
  Broadcast: require('./broadcast.js'),
  Room: require('./room.js'),
  Socket: require('./socket.js')
};
