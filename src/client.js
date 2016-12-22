var freeice = require('freeice');
var _ = require('eakwell');

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
          var peer = getPeerConnection('publisher');
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
      if(socket) socket.send(JSON.stringify(data));
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

  var getPeerConnection = function(type) {
    var peer = new RTCPeerConnection({iceServers: freeice()});
    var value = function(str) {
      if(!str) return 0;
      if(!isNaN(str)) return Number(str);
      if(str == 'true') return true;
      if(str == 'false') return false;
      return str;
    };
    var iv = setInterval(function() {
      getStats(peer, null).then(function(stats) {
        // console.log(stats);
        var score = 0;
        stats.forEach(function(stat) {
          // console.log(stat);
          if(type == 'receiver') {
            // Receiver
            if(stat.type == 'ssrc' || stat.type == 'inboundrtp') {
              var received = value(stat.packetsReceived);
              if(stat.mediaType == 'video') {
                score -= value(stat.packetsLost) / received +
                         value(stat.googTargetDelayMs) +
                         value(stat.googCurrentDelayMs) +
                         value(stat.googDecodeMs) +
                         value(stat.googJitterBufferMs) +
                         value(stat.googRenderDelayMs) +
                         value(stat.framerateStdDev) +
                         value(stat.bitrateStdDev) + 
                         value(stat.jitter);
              } else if(stat.mediaType == 'audio') {
                score -= value(stat.packetsLost) / received +
                         value(stat.googCurrentDelayMs) +
                         value(stat.googJitterReceived) +
                         value(stat.googJitterBufferMs) +
                         value(stat.jitter);
              }
            }
          } else {
            // Publisher
            if((stat.type == 'ssrc' || stat.type == 'outboundrtp') && stat.mediaType == 'video') {
              var sent = value(stat.packetsSent);
              score -= value(stat.packetsLost) / sent +
                       value(stat.googAvgEncodeMs) +
                       value(stat.googRtt) +
                       value(stat.googEncodeUsagePercent) + 
                       value(stat.droppedFrames) / sent + 
                       value(stat.framerateStdDev);
              var limitedResolution = value(stat.googBandwidthLimitedResolution) || value(stat.googCpuLimitedResolution);
            } else if(stat.type == 'VideoBwe') {
              score += value(stat.googTransmitBitrate) +
                       value(stat.googReTransmitBitrate) +
                       value(stat.googAvailableSendBandwidth);
            }
          }
        });
        console.log(type, score);
      });
    }, 1000);
    peer.onclose = function() {
      clearInterval(iv);
    };
    return peer;
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
    if(socket) socket.close();
    socket = null;
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

    senderPeer = getPeerConnection('receiver');

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

function getStats(pc, selector) {
  if(navigator.mozGetUserMedia) {
    return pc.getStats(selector);
  }
  return new Promise(function(resolve, reject) {
    pc.getStats(function(response) {
      var standardReport = {};
      response.result().forEach(function(report) {
        var standardStats = {
          id: report.id,
          type: report.type
        };
        report.names().forEach(function(name) {
          standardStats[name] = report.stat(name);
        });
        standardReport[standardStats.id] = standardStats;
      });
      resolve(standardReport);
    }, selector, reject);
  });
}

if(typeof window !== 'undefined') {
  _.each(require('webrtc-adapter').browserShim, function(shim) {
    shim();
  });
  window.Spreadcast = Client;
}

module.exports = Client;
