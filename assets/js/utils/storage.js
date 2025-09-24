(function(){
  'use strict';

  var SNAP_STORAGE_PREFIX = 'snap_finance_';
  var SNAP_KEYS = { APP: 'application', ORDER_SUBMITTED: 'order_submitted' };
  function now(){ return Date.now(); }
  function inMs(mins){ return mins * 60 * 1000; }

  var SnapStorage = {
    set: function(key, value){
      try {
        localStorage.setItem(SNAP_STORAGE_PREFIX + key, JSON.stringify(value));
        return true;
      } catch (err) {
        console.warn('[SnapStorage] Failed to set', key, err);
        return false;
      }
    },
    get: function(key, fallback){
      if (fallback === undefined) fallback = null;
      try {
        var raw = localStorage.getItem(SNAP_STORAGE_PREFIX + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) {
        console.warn('[SnapStorage] Failed to parse', key, err);
        return fallback;
      }
    },
    remove: function(key){
      try {
        localStorage.removeItem(SNAP_STORAGE_PREFIX + key);
        return true;
      } catch (err) {
        console.warn('[SnapStorage] Failed to remove', key, err);
        return false;
      }
    },
    clearAll: function(){
      try {
        Object.keys(localStorage)
          .filter(function(k){ return k.indexOf(SNAP_STORAGE_PREFIX) === 0; })
          .forEach(function(k){ localStorage.removeItem(k); });
        return true;
      } catch (err) {
        console.warn('[SnapStorage] Failed to clear all Snap keys', err);
        return false;
      }
    }
  };

  // Helpers (TTL + constants)
  SnapStorage.SNAP_KEYS = SNAP_KEYS;
  SnapStorage.setWithTTL = function(key, value, ttlMins){
    try {
      var v = Object.assign({}, value, { _ts: now(), _ttl: inMs(typeof ttlMins === 'number' ? ttlMins : 30) });
      return SnapStorage.set(key, v);
    } catch (e) {
      console.warn('[SnapStorage] setWithTTL failed', key, e);
      return false;
    }
  };
  SnapStorage.getIfFresh = function(key){
    var v = SnapStorage.get(key);
    if (!v) return null;
    if (typeof v._ts !== 'number' || typeof v._ttl !== 'number') return v;
    if (now() - v._ts > v._ttl) {
      SnapStorage.remove(key);
      return null;
    }
    return v;
  };

  window.SnapStorage = SnapStorage;
})();


