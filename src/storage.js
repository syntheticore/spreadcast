var _ = require('eakwell');

var Storage = function(cb) {
  var self = this;

  var dbReady = new Promise(function(ok) {
    var request = indexedDB.open('spreadcast', 4);

    request.onupgradeneeded = function(e) {
      var db = e.target.result;
      db.createObjectStore('chunks', {autoIncrement: true});
      db.createObjectStore('streams', {keyPath: 'sessionId'});
    };

    request.onsuccess = function(e) {
      var db = e.target.result;
      db.onerror = function(e) {
        console.error('Database error: ' + e.target.errorCode);
      };
      ok(db);
    };
  });

  function transaction(db, storeName) {
    return db.transaction([storeName], 'readwrite').objectStore(storeName);
  }

  self.store = function(chunk, sessionId, cb) {
    dbReady.then(function(db) {
      transaction(db, 'chunks').add(chunk).onsuccess = function(e) {
        var chunkKey = e.target.result;
        var streamTrans = transaction(db, 'streams');
        streamTrans.get(sessionId).onsuccess = function(e) {
          var stream = e.target.result || {sessionId: sessionId, chunkIds: []};
          stream.chunkIds.push(chunkKey);
          streamTrans.put(stream).onsuccess = cb || _.noop;
        };
      };
    });
  };

  self.retrieve = function(sessionId) {
    return dbReady.then(function(db) {
      return new Promise(function(ok, fail) {
        var streamTrans = transaction(db, 'streams');
        streamTrans.get(sessionId).onsuccess = function(e) {
          var stream = e.target.result;
          if(!stream) return fail('No such stream');
          var key = stream.chunkIds.shift();
          if(!key) return fail('No more chunks');
          streamTrans.put(stream).onsuccess = function() {
            var chunkTrans = transaction(db, 'chunks');
            chunkTrans.get(key).onsuccess = function(e) {
              var chunk = e.target.result;
              chunkTrans.delete(key);
              ok(chunk);
            };
          };
        };
      });
    });
  };
};

module.exports = Storage;
