var _ = require('eakwell');

var Client = function(options) {
  var self = this;

  _.each(require('webrtc-adapter').browserShim, function(shim) {
    shim();
  });

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
  var sockReady;
  var sessionId;

  var openSocket = function() {
    socket = new WebSocket(wsUrl);
    sockReady = new Promise(function(ok, fail) {
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
      _.defer(openSocket, 1000);
    };

    socket.onmessage = function(event) {
      var data = JSON.parse(event.data);
      switch(data.type) {
        case 'sessionId':
          if(sessionId) {
            console.log("Requesting session id " + sessionId);
            send({
              type: 'sessionId',
              id: sessionId
            });
          } else {
            console.log("Setting session id " + data.id);
            sessionId = data.id;
          }
          break;

        case 'offer':
          console.log("Got offer from receiver " + data.fromReceiver);
          var peer = new RTCPeerConnection(null);
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
          stop();
          self.receive(roomName);
          break;
      }
    };
  };

  openSocket();

  var send = function(data) {
    sockReady.then(function() {
      socket.send(JSON.stringify(data));
    });
  };

  var createVideoElement = function() {
    var video = document.createElement('video');
    video.autoplay = true;
    options.container.appendChild(video);
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
      localVideo = createVideoElement();
      localVideo.muted = true;
      localVideo.srcObject = stream;
      localStream = stream;
    })
    .catch(function(e) {
      alert('getUserMedia() error: ' + e.name);
    });
  };

  var stop = function() {
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
    if(remoteVideo) remoteVideo.parentElement.removeChild(remoteVideo);
    if(localVideo) localVideo.parentElement.removeChild(localVideo);
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

    senderPeer = new RTCPeerConnection(null);

    senderPeer.onaddstream = function(e) {
      remoteVideo = createVideoElement();
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
  };
};

module.exports = Client;
