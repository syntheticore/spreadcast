var _ = require('eakwell');

var Spreadcast = {
  Client: require('./client.js'),
  serve: require('./server.js')
};

if(typeof window !== 'undefined') {
  _.each(require('webrtc-adapter').browserShim, function(shim) {
    shim();
  });
  window.Spreadcast = Spreadcast;
}

module.exports = Spreadcast;
