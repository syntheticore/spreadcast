(function (factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  }
  else if (typeof require === "function" && typeof exports === "object" && typeof module === "object") {
    module.exports = factory();
  }
  else {
    window.Spreadcast = factory();
  }
})(function () {
  var _ = require('eakwell');
  var browserShim = require('webrtc-adapter').browserShim;

  _.each(browserShim, function (shim) {
    shim();
  });

  return {
    Room: require('./room.js'),
    Socket: require('./socket.js')
  };
});
