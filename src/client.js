var _ = require('eakwell');

var Client = function(options) {
  var self = this;

  _.each(require('webrtc-adapter').browserShim, function(shim) {
    shim();
  });

  var roomName;

  var localStream;
  var remoteStream;
  var remoteVideo;

  var senderPeer;
  var senderId;
  var receiverPeers = {};
  var senderIceCandidateCache = [];

  var wsUrl = location.origin.replace(/^http/, 'ws');
  var socket = new WebSocket(wsUrl);

  var send = function(data) {
    socket.send(JSON.stringify(data));
  };

  socket.onopen = function(event) {
    console.log("Socket open");
  };

  socket.onerror = function(error) {
    console.log('WebSocket Error ' + error);
  };

  socket.onclose = function(event) {
    console.log('WebSocket was closed ' + event);
  };

  socket.onmessage = function(event) {
    var data = JSON.parse(event.data);
    switch(data.type) {
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
        senderPeer.close();
        remoteVideo.parentElement.removeChild(remoteVideo);
        break;
    }
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
      var video = createVideoElement();
      video.muted = true;
      video.srcObject = stream;
      localStream = stream;
    })
    .catch(function(e) {
      alert('getUserMedia() error: ' + e.name);
    });
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
};

module.exports = Client;
