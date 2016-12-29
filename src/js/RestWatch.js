// (C) Copyright 2014-2015 Hewlett Packard Enterprise Development LP

var Rest = require('grommet/utils/Rest');

var RECONNECT_TIMEOUT = 5000; // 5s
var POLL_TIMEOUT = 10000; // 10s

var state = {
  ws: null,
  wsReady: false,
  timer: null,
  requests: [], // {message: , context: }
  nextRequestId: 1,
  initialized: false,
  socketUrl: null
};

var RestWatch = {

  _sendMessage: function(op, id, url, params) {
    state.ws.send(JSON.stringify({
      op: op,
      id: id,
      url: url,
      params: params
    }));
  },

  _onOpen: function() {
    state.wsReady = true;
    // send any requests we have queued up
    state.requests.forEach(function(request) {
      this._sendMessage('start', request.id, request.url, request.params);
    }, this);
  },

  _onError: function(error) {
    console.log('!!! RestWatch _onError TODO', error);
  },

  _onMessage: function(event) {
    var message = JSON.parse(event.data);
    // Figure out which message this corresponds to so we
    // know which action to deliver the response with.
    state.requests.some(function(request) {
      if (request.id === message.id) {
        // console.log('!!! RestWatch _onMessage', message);
        if ('error' === message.op) {
          request.failure(message.result);
        } else {
          request.success(message.result);
        }
      }
    });
  },

  _onClose: function() {
    console.log('!!! RestWatch _onClose');
    // lost connection, retry in a bit
    state.ws = null;
    state.wsReady = false;
    state.initialized = false;
    state.timer = setTimeout(this.initialize.bind(this), RECONNECT_TIMEOUT);
  },

  _getREST: function(request) {
    request.pollBusy = true;
    Rest.get(request.url, request.params)
      .end(function(err, res) {
        if (err) {
          request.failure(err);
        }

        if (res.ok) {
          request.success(res.body);
        }
        request.pollBusy = false;
      });
  },

  _poll: function() {
    state.requests.forEach(function(request) {
      if (!request.pollBusy) {
        this._getREST(request);
      }
    });
  },

  initialize: function(socketUrl) {
    if (!state.initialized && !state.ws && this.available() && (state.socketUrl || socketUrl)) {
      state.socketUrl = state.socketUrl || socketUrl;
      state.ws = new WebSocket(state.socketUrl);
      state.ws.onopen = this._onOpen.bind(this);
      state.ws.onerror = this._onError.bind(this);
      state.ws.onmessage = this._onMessage.bind(this);
      state.ws.onclose = this._onClose.bind(this);
      state.initialized = true;
    }
  },

  available: function() {
    return ('WebSocket' in window || 'MozWebSocket' in window);
  },

  start: function(url, params, success, failure) {
    this.initialize();
    var request = {
      id: state.nextRequestId,
      url: url,
      params: params,
      success: success,
      failure: failure
    };
    state.nextRequestId += 1;
    state.requests.push(request);

    if (state.wsReady) {
      this._sendMessage('start', request.id, request.url, request.params);
    } else if (!this.available()) {
      // no web sockets, fall back to polling
      this._getREST(request);
      clearTimeout(state.timer);
      state.timer = setTimeout(this._poll.bind(this), POLL_TIMEOUT);
    }
    return request.id;
  },

  stop: function(requestId) {
    state.requests = state.requests.filter(function(request) {
      if (request.id === requestId) {
        if (state.wsReady) {
          this._sendMessage('stop', request.id);
        }
        return false;
      } else {
        return true;
      }
    }, this);
  }
};

module.exports = RestWatch;
