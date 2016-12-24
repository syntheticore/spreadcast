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
  var receiveCb;
  var publishCb;

  var openSocket = function() {
    socket = new WebSocket(wsUrl);
    socketReady = new Promise(function(ok, fail) {
      socket.onopen = function() {
        console.log("Socket open");
        ok();
      };
    });

    socket.onerror = function(error) {
      console.log('WebSocket Error', error);
    };

    socket.onclose = function() {
      console.log('WebSocket was closed');
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
        case 'roomCreated':
          publishCb && publishCb();
          break;

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
          receiveCb && receiveCb();
          break;
        
        case 'iceCandidate':
          console.log("Got iceCandidate from " + data.from);
          var peer = (data.from == senderId ? senderPeer : receiverPeers[data.from]);
          if(peer) peer.addIceCandidate(data.candidate);
          break;

        case 'stop':
          stop();
          break;

        case 'dropReceiver':
          var peer = receiverPeers[data.receiverId];
          if(peer) {
            peer.close();
            delete receiverPeers[data.receiverId];
          }
          break;

        case 'reconnect':
          reconnect();
          break;

        case 'error':
          if(data.msg == 'NoSuchRoom') {
            stop();
            receiveCb && receiveCb('Room doesn\'t exist');
          } else if(data.msg == 'RoomNameTaken') {
            stop();
            publishCb && publishCb('Room name is already taken');
          }
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
    ).then(function(stream) {
      localVideo = localVideo || createVideoElement();
      localVideo.muted = true;
      localVideo.srcObject = stream;
      localStream = stream;
    });
  };

  var getPeerConnection = function(type) {
    var peer = new RTCPeerConnection({iceServers: freeice()});
    return peer;
    var value = function(str) {
      if(!str) return 0;
      if(!isNaN(str)) return Number(str);
      if(str == 'true') return true;
      if(str == 'false') return false;
      return str;
    };
    peer.onsignalingstatechange = function() {
      if(peer.signalingState === 'closed') {
        clearInterval(iv);
      }
    };
    var iv = setInterval(function() {
      getStats(peer, null).then(function(stats) {
        // console.log(stats);
        var score = 0;
        _.each(stats, function(stat) {
          if(type == 'receiver') {
            // Receiver
            if(stat.type == 'ssrc' || stat.type == 'inboundrtp') {
              var received = value(stat.packetsReceived);
              if(stat.mediaType == 'video') {
                score -= value(stat.googTargetDelayMs) +
                         // value(stat.packetsLost) / received +
                         value(stat.googCurrentDelayMs) +
                         value(stat.googDecodeMs) +
                         value(stat.googJitterBufferMs) +
                         value(stat.googRenderDelayMs) +
                         value(stat.framerateStdDev) +
                         value(stat.bitrateStdDev) + 
                         value(stat.jitter) - 
                         value(stat.packetsReceivedPerSecond) -
                         value(stat.bitsReceivedPerSecond) -
                         value(stat.googFrameRateReceived) -
                         value(stat.googFrameWidthReceived);
              } else if(stat.mediaType == 'audio') {
                score -= value(stat.googCurrentDelayMs) +
                         // value(stat.packetsLost) / received +
                         value(stat.googJitterReceived) +
                         value(stat.googJitterBufferMs) +
                         value(stat.jitter) -
                         value(stat.packetsReceivedPerSecond) -
                         value(stat.bitsReceivedPerSecond);
              }
            }
          } else {
            // Publisher
            if((stat.type == 'ssrc' || stat.type == 'outboundrtp') && stat.mediaType == 'video') {
              var sent = value(stat.packetsSent);
              score -= value(stat.googAvgEncodeMs) +
                       value(stat.packetsLost) +
                       value(stat.googRtt) +
                       value(stat.googEncodeUsagePercent) + 
                       value(stat.droppedFrames) + 
                       value(stat.framerateStdDev) -
                       value(stat.packetsSentPerSecond) -
                       value(stat.bitsSentPerSecond) -
                       value(stat.googFrameRateSent) -
                       value(stat.googFrameWidthSent);
              var limitedResolution = value(stat.googBandwidthLimitedResolution) || value(stat.googCpuLimitedResolution);
            } else if(stat.type == 'VideoBwe') {
              score += value(stat.googTransmitBitrate) +
                       value(stat.googReTransmitBitrate) +
                       value(stat.googAvailableSendBandwidth) +
                       value(stat.googActualEncBitrate);
            }
          }
        });
        console.log(type, score);
      });
    }, 1000);
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
  
  self.publish = function(name, constraints, cb) {
    roomName = name;
    publishCb = cb;
    getMedia(constraints).then(function() {
      send({
        type: 'openRoom',
        name: name
      });
    }).catch(function() {
      publishCb && publishCb('Could not initialize video stream');
    });
  };

  self.receive = function(name, cb) {
    roomName = name;
    receiveCb = cb;

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
    }).catch(function() {
      publishCb && publishCb('Unable to create offer');
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
