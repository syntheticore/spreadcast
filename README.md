# spreadcast.js
[![npm version](https://badge.fury.io/js/spreadcast.svg)](http://badge.fury.io/js/spreadcast)

Broadcast WebRTC streams to many receivers

## Installation

  npm install spreadcast --save

## Usage
  
  # Node Server

  ```JavaScript
  var Spreadcast = require('spreadcast');

  var server = require('http').createServer();
  server.listen();

  Spreadcast.serve({server: server});
  ```


  # Browser Client

  ```JavaScript
  // If you use Browserify in your project already,
  // you can require spreadcast directly

  var spreadcast = require('spreadcast');

  // Otherwise include the bundle from
  // ./node_modules/spreadcast/dist/spreadcast.min.js in your HTML

  // Use the Room class to easily implement a video chat
  // among several publishers with many viewers

  var room = new spreadcast.Room('roomName');

  room.onAddStream = function(video) {
    document.body.appendChild(video);
  };

  room.onRemoveStream = function(video) {
    video.parentElement.removeChild(video);
  };

  // Call publish/unpublish at any time
  // You can pass a regular WebRTC constraints object to configure your stream
  room.publish({
    video: {
      width: 320,
      height: 240,
      frameRate: 24
    }
  }).then(function(video) {
    document.body.appendChild(video);
  }).catch(function(error) {
    console.error(error);
  });
  ```

## License

  MIT
