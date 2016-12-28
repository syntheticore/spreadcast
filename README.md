# spreadcast.js
[![npm version](https://badge.fury.io/js/spreadcast.svg)](http://badge.fury.io/js/spreadcast)

Broadcast a WebRTC stream to many subscribers

## Installation

  npm install spreadcast --save

## Usage
  
  ## Node Server

  ```JavaScript
  var Spreadcast = require('spreadcast');

  var server = require('http').createServer();
  server.listen();

  Spreadcast.serve({server: server});
  ```


  ## Browser Client

  ```JavaScript
  var Spreadcast = require('spreadcast');

  var container = document.querySelector('#container');

  var publisher = new Spreadcast.Client();
  publisher.publish('streamName', {
    video: {
      width: 320,
      height: 240,
      frameRate: 30
    }
  }, function(error, video) {
    if(error) console.error(error);
    container.appendChild(video);
  });

  var receiver = new Spreadcast.Client();
  receiver.receive('streamName', function(error, video) {
    if(error) console.error(error);
    container.appendChild(video);
  });
  ```

## License

  MIT
