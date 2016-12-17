# spreadcast.js
[![npm version](https://badge.fury.io/js/spreadcast.svg)](http://badge.fury.io/js/spreadcast)

Broadcast a WebRTC stream to many subscribers

## Installation

  npm install spreadcast --save

## Usage
  
  ### Server

    ```JavaScript
    var Spreadcast = require('spreadcast');

    var server = require('http').createServer();
    server.listen(PORT);

    Spreadcast.serve(server);


  ### Client

    ```JavaScript
    var container = document.getElementById('container');

    var publisher = new Spreadcast.Client({
      container: container
    });
    publisher.publish('streamName');

    var receiver = new Spreadcast.Client({
      container: container
    });
    receiver.receive('streamName');

## License

  MIT
