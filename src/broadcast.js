var freeice = require('freeice');
var _ = require('eakwell');

var Socket = require('./socket.js');
var Storage = require('./storage.js');

var Broadcast = function(broadcastName, roomName, keepVideos) {
  var self = this;

  var stream;
  var video;
  var senderPeer;
  var senderId;

  var receiverPeers = {};
  var senderIceCandidateCache = [];
  var shutdown = false;
  var stopRecord = null;

  var socket = new Socket();

  socket.onerror = function(error) {
    console.log('WebSocket Error', error);
  };

  socket.onreconnect = function() {
    if(senderPeer) reconnect();
  };

  socket.onmessage = function(data) {
    switch(data.type) {
      case 'offer':
        console.log("Got offer from receiver " + data.fromReceiver);
        var peer = getPeerConnection('publisher');
        peer.onicecandidate = function(e) {
          if(e.candidate) {
            socket.send({
              type: 'iceCandidate',
              roomName: roomName,
              broadcastName: broadcastName,
              candidate: e.candidate,
              to: data.fromReceiver
            });
          }
        };
        _.waitFor(function() {
          return stream;
        }, function() {
          peer.addStream(stream);
          // stream.getTracks().forEach(track => peer.addTrack(track, stream));
          peer.setRemoteDescription(data.offer);
          peer.createAnswer().then(function(desc) {
            peer.setLocalDescription(desc);
            socket.send({
              type: 'answer',
              answer: desc,
              roomName: roomName,
              broadcastName: broadcastName,
              toReceiver: data.fromReceiver
            });
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
    }
  };

  var createVideoElement = function() {
    var video = document.createElement('video');
    video.autoplay = true;
    return video;
  };

  var getMedia = function(constraints) {
    return navigator.mediaDevices.getUserMedia(_.merge({
      audio: true,
      video: {
        width: 320,
        height: 240,
        frameRate: 24
      }}, constraints || {})
    ).then(function(_stream) {
      stream = _stream;
      video = video || createVideoElement();
      video.muted = true;
      video.srcObject = stream;
      return new Promise(function(ok, fail) {
        video.onplaying = ok;
      });
    });
  };

  var getPeerConnection = function(type) {
    var peer = new RTCPeerConnection({iceServers: freeice()});
    return peer;
    return getPeerStats(peer, function(type, score) {
      console.log(type, score);
    });
  };

  var terminate = function() {
    if(senderPeer) senderPeer.close();
    _.each(receiverPeers, function(peer) {
      peer.close();
    });
    if(stream && !senderPeer) {
      _.each(stream.getTracks(), function(track) {
        track.stop();
      });
    }
    receiverPeers = {};
    senderPeer = null;
    senderId = null;
    stream = null;
  };

  var reconnect = function() {
    terminate();
    self.receive();
  };

  var stop = function() {
    terminate();
    if(video && video.parentElement && !keepVideos) video.parentElement.removeChild(video);
    video = null;
    shutdown = true;
    socket.close();
    self.onStop && self.onStop();
    stopRecord && stopRecord();
  };

  var record = function(cb, chunksize) {
    chunksize = chunksize || Infinity;
    var recordedBlobs = [];
    var mediaRecorder = new MediaRecorder(stream);
    var buffersize = 0;
    mediaRecorder.ondataavailable = function(e) {
      if(e.data && e.data.size > 0) {
        if(buffersize + e.data.size > chunksize && recordedBlobs.length) {
          cb && cb(new Blob(recordedBlobs, {type: 'video/webm'}));
          recordedBlobs = [];
          buffersize = 0;
        }
        recordedBlobs.push(e.data);
        buffersize += e.data.size;
      }
    };
    mediaRecorder.start(100);
    return function() {
      mediaRecorder.stop();
      cb && recordedBlobs.length && cb(new Blob(recordedBlobs, {type: 'video/webm'}));
    };
  };
  
  self.publish = function(constraints, cb) {
    getMedia(constraints).then(function() {
      socket.send({
        type: 'publishStream',
        roomName: roomName,
        broadcastName: broadcastName
      });
      cb && cb(null, video);
    }).catch(function() {
      cb && cb('Could not initialize video stream');
    });
  };

  self.publishStream = function(_stream) {
    stream = _stream;
    socket.send({
      type: 'publishStream',
      roomName: roomName,
      broadcastName: broadcastName
    });
  };

  self.receive = function(cb) {
    senderPeer = getPeerConnection('receiver');

    senderPeer.onaddstream = function(e) {
      stream = e.stream;
      video = video || createVideoElement();
      video.srcObject = stream;
      cb && cb(null, video);
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
          socket.send({
            type: 'iceCandidate',
            roomName: roomName,
            broadcastName: broadcastName,
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
      socket.send({
        type: 'receiveStream',
        roomName: roomName,
        broadcastName: broadcastName,
        offer: desc
      });
    }).catch(function() {
      cb && cb('Unable to create offer');
    });
  };

  self.stop = function() {
    // Close the entire broadcast if we are the publisher
    if(!senderPeer) {
      socket.send({
        type: 'closeBroadcast'
      });
    }
    stop();
  };

  self.record = function(cb) {
    // Record stream to disk
    var recordId = _.uuid();
    var storage = new Storage();
    var stopRec = record(function(chunk) {
      storage.store(chunk, recordId);
    }, 50000);

    // Start uploading chunks to the server
    var uploading = true;
    var uploadingFinished = false;

    var uploadChunks = function() {
      if(uploadingFinished) return cb(null);
      storage.retrieve(recordId).then(cb).then(uploadChunks).catch(function() {
        if(!uploading) uploadingFinished = true;
        return _.delay(1000).then(uploadChunks);
      });
    };
    uploadChunks();

    // Recording shall end automatically when the broadcast stops
    stopRecord = function() {
      uploading = false;
      stopRec && stopRec();
      stopRec = null;
    };

    return stopRecord;
  };

  self.snapshot = function() {
    if(!video) return;
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    var context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  };

  self.getStream = function() {
    return stream;
  };
};

var getPeerStats = function(peer, cb) {
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
      cb(type, score);
    });
  }, 1000);
  return peer;
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

module.exports = Broadcast;
