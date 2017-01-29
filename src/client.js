_.each(require('webrtc-adapter').browserShim, function(shim) {
  shim();
});

window.Spreadcast = {
  Room: require('./room.js'),
  Broadcast: require('./broadcast.js'),
  Socket: require('./socket.js')
};
