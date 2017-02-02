_.each(require('webrtc-adapter').browserShim, function(shim) {
  shim();
});

window.Spreadcast = {
  Room: require('./room.js'),
  Socket: require('./socket.js')
};
