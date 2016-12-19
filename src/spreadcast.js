var _ = require('eakwell');

var Spreadcast = {
  Client: require('./client.js'),
  serve: require('./server.js')
};

if(typeof window !== 'undefined') {
  window.Spreadcast = Spreadcast;
}

module.exports = Spreadcast;
