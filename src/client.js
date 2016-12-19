var freeice = require('freeice');
var _ = require('eakwell');

var peerConfig = {iceServers: freeice()};

var Client = function(container) {
  var self = this;

  var wsUrl = location.origin.replace(/^http/, 'ws');
  var roomName;

  var localStream;
  var remoteStream;
  var localVideo;
  var remoteVideo;

  var senderPeer;
  var senderId;
  var receiverPeers = {};
  var senderIceCandidateCache = [];

  var socket;
  var socketReady;
  var shutdown = false;

  var openSocket = function() {
    socket = new WebSocket(wsUrl);
    socketReady = new Promise(function(ok, fail) {
      socket.onopen = function(event) {
        console.log("Socket open");
        ok();
      };
    });

    socket.onerror = function(error) {
      console.log('WebSocket Error', error);
    };

    socket.onclose = function(event) {
      console.log('WebSocket was closed', event);
      if(shutdown) return;
      // Reconnect socket and stream
      _.defer(function() {
        openSocket();
        if(senderPeer) socketReady.then(reconnect);
      }, 1000);
    };

    socket.onmessage = function(event) {
      var data = JSON.parse(event.data);
      if(!data._spreadcast) return;

      switch(data.type) {
        case 'offer':
          console.log("Got offer from receiver " + data.fromReceiver);
          var peer = new RTCPeerConnection(peerConfig);
          peer.onicecandidate = function(e) {
            if(e.candidate) {
              send({
                type: 'iceCandidate',
                roomName: roomName,
                candidate: e.candidate,
                to: data.fromReceiver
              });
            }
          };
          peer.addStream(localStream || remoteStream);
          // var stream = localStream || remoteStream;
          // stream.getTracks().forEach(track => peer.addTrack(track, stream));
          peer.setRemoteDescription(data.offer);
          peer.createAnswer().then(function(desc) {
            peer.setLocalDescription(desc);
            send({
              type: 'answer',
              answer: desc,
              roomName: roomName,
              toReceiver: data.fromReceiver
            });
          });
          receiverPeers[data.fromReceiver] = peer;
          break;
        
        case 'answer':
          senderId = data.fromSender;
          console.log("Got answer from sender " + senderId);
          senderPeer.setRemoteDescription(data.answer);
          break;
        
        case 'iceCandidate':
          console.log("Got iceCandidate from " + data.from);
          var peer = (data.from == senderId ? senderPeer : receiverPeers[data.from]);
          if(peer) peer.addIceCandidate(data.candidate);
          break;

        case 'stop':
          stop();
          break;

        case 'reconnect':
          reconnect();
          break;
      }
    };
  };

  openSocket();

  var send = function(data) {
    socketReady.then(function() {
      data._spreadcast = true;
      socket.send(JSON.stringify(data));
    });
  };

  var createVideoElement = function() {
    var video = document.createElement('video');
    video.autoplay = true;
    container.appendChild(video);
    return video;
  };

  var getMedia = function(constraints) {
    return navigator.mediaDevices.getUserMedia(_.merge({
      audio: true,
      video: {
        width: 640,
        height: 480,
        frameRate: 30
      }}, constraints || {})
    )
    .then(function(stream) {
      localVideo = localVideo || createVideoElement();
      localVideo.muted = true;
      localVideo.srcObject = stream;
      localStream = stream;
    })
    .catch(function(e) {
      alert('getUserMedia() error: ' + e.name);
    });
  };

  var terminate = function() {
    if(senderPeer) senderPeer.close();
    senderPeer = null;
    senderId = null;
    remoteStream = null;
    _.each(receiverPeers, function(peer) {
      peer.close();
    });
    receiverPeers = {};
    if(localStream) {
      _.each(localStream.getTracks(), function(track) {
        track.stop();
      });
      localStream = null;
    }
  };

  var reconnect = function() {
    terminate();
    self.receive(roomName);
  };

  var stop = function() {
    terminate();
    if(remoteVideo) remoteVideo.parentElement.removeChild(remoteVideo);
    if(localVideo) localVideo.parentElement.removeChild(localVideo);
    localVideo = null;
    remoteVideo = null;
    shutdown = true;
    socket.close();
    if(self.onStop) self.onStop();
  };
  
  self.publish = function(name, constraints) {
    roomName = name;
    getMedia(constraints).then(function() {
      send({
        type: 'openRoom',
        name: name
      });
    });
  };

  self.receive = function(name) {
    roomName = name;

    senderPeer = new RTCPeerConnection(peerConfig);

    senderPeer.onaddstream = function(e) {
      remoteVideo = remoteVideo || createVideoElement();
      remoteVideo.srcObject = e.stream;
      remoteStream = e.stream;
    };

    // senderPeer.ontrack = function(e) {
    //   remoteVideo = createVideoElement();
    //   remoteVideo.srcObject = e.streams[0];
    //   remoteStream = e.streams[0];
    // };

    senderPeer.onicecandidate = function(e) {
      if(e.candidate) {
        _.waitFor(function() {
          return senderId;
        }, function() {
          send({
            type: 'iceCandidate',
            roomName: roomName,
            candidate: e.candidate,
            to: senderId
          });
        });
      }
    };

    senderPeer.createOffer({
      offerToReceiveAudio: 1,
      offerToReceiveVideo: 1
    }).then(function(desc) {
      senderPeer.setLocalDescription(desc);
      send({
        type: 'joinRoom',
        roomName: roomName,
        offer: desc
      });
    });
  };

  self.stop = function() {
    // Close the entire room if we are the publisher
    if(!senderPeer) {
      send({
        type: 'closeRoom',
        roomName: roomName
      });
    }
    stop();
    roomName = null;
  };
};

module.exports = Client;
