/* global angular forge */
function lastfm() {
  angular.module('lastfmClient', []).provider('lastfm', function lastfm_func() {
    this.options = {
      apiKey: 'unknown',
      apiSecret: 'unknown',
    };

    this.setOptions = (options) => {
      if (!angular.isObject(options))
        throw new Error('Options should be an object!');
      this.options = angular.extend({}, this.options, options);
    };

    this.apiUrl = 'https://ws.audioscrobbler.com/2.0/';

    this.$get = [
      '$window',
      ($window) => {
        const { options, apiUrl } = this;
        let status = 0;

        /**
         * Computes string for signing request
         *
         * See http://www.last.fm/api/authspec#8
         */
        function generateSign(params) {
          const keys = Object.keys(params).filter(
            (key) => key !== 'format' || key !== 'callback'
          );

          // params has to be ordered alphabetically
          keys.sort();

          const o = keys.reduce((r, key) => r + key + params[key], '');

          // append secret
          return forge.md5
            .create()
            .update(forge.util.encodeUtf8(o + options.apiSecret))
            .digest()
            .toHex();
        }

        /**
         * Creates query string from object properties
         */
        function createQueryString(params) {
          const parts = [];
          Object.keys(params).forEach((key) =>
            parts.push(`${key}=${encodeURIComponent(params[key])}`)
          );
          return parts.join('&');
        }

        // eslint-disable-next-line no-underscore-dangle
        function _isAuthRequested() {
          const token = localStorage.getObject('lastfmtoken');
          return token != null;
        }

        function getSession(callback) {
          // load session info from localStorage
          let mySession = localStorage.getObject('lastfmsession');
          if (mySession != null) {
            return callback(mySession);
          }
          // trade session with token
          const token = localStorage.getObject('lastfmtoken');
          if (token == null) {
            return callback(null);
          }
          // token exists
          const params = {
            method: 'auth.getsession',
            api_key: options.apiKey,
            token,
          };
          const apiSig = generateSign(params);
          const url = `${apiUrl}?${createQueryString(
            params
          )}&api_sig=${apiSig}&format=json`;
          axios
            .get(url)
            .then((response) => {
              const { data } = response;
              mySession = data.session;
              localStorage.setObject('lastfmsession', mySession);
              callback(mySession);
            })
            .catch((error) => {
              if (error.response.status === 403) {
                callback(null);
              }
            });
          return null;
        }

        function getUserInfo(callback) {
          getSession((session) => {
            if (session == null) {
              callback(null);
              return;
            }
            const params = {
              method: 'user.getinfo',
              api_key: options.apiKey,
              sk: session.key,
            };

            params.api_sig = generateSign(params);

            const url = `${apiUrl}?${createQueryString(params)}&format=json`;
            axios.post(url).then((response) => {
              const { data } = response;
              if (callback != null) {
                callback(data);
              }
            });
          });
        }

        function updateStatus() {
          // auth status
          // 0: never request for auth
          // 1: request but fail to success
          // 2: success auth
          if (!_isAuthRequested()) {
            status = 0;
            return;
          }
          getUserInfo((data) => {
            if (data === null) {
              status = 1;
            } else {
              status = 2;
            }
          });
        }

        function getAuth(callback) {
          const url = `${apiUrl}?method=auth.gettoken&api_key=${options.apiKey}&format=json`;
          axios.get(url).then((response) => {
            const { data } = response;
            const { token } = data;
            localStorage.setObject('lastfmtoken', token);
            const grant_url = `http://www.last.fm/api/auth/?api_key=${options.apiKey}&token=${token}`;
            $window.open(grant_url, '_blank');
            status = 1;
            if (callback != null) {
              callback();
            }
          });
        }

        function cancelAuth() {
          localStorage.removeItem('lastfmsession');
          localStorage.removeItem('lastfmtoken');
          updateStatus();
        }

        function sendNowPlaying(track, artist, callback) {
          getSession((session) => {
            const params = {
              method: 'track.updatenowplaying',
              track,
              artist,
              api_key: options.apiKey,
              sk: session.key,
            };

            params.api_sig = generateSign(params);

            const url = `${apiUrl}?${createQueryString(params)}&format=json`;
            axios.post(url).then((response) => {
              const { data } = response;
              if (callback != null) {
                callback(data);
              }
            });
          });
        }

        function scrobble(timestamp, track, artist, album, callback) {
          getSession((session) => {
            const params = {
              method: 'track.scrobble',
              'timestamp[0]': timestamp,
              'track[0]': track,
              'artist[0]': artist,
              api_key: options.apiKey,
              sk: session.key,
            };

            if (album !== '' && album != null) {
              params['album[0]'] = album;
            }

            params.api_sig = generateSign(params);

            const url = `${apiUrl}?${createQueryString(params)}&format=json`;
            axios.post(url).then((response) => {
              const { data } = response;
              if (callback != null) {
                callback(data);
              }
            });
          });
        }

        function isAuthorized() {
          return status === 2;
        }

        function isAuthRequested() {
          return !(status === 0);
        }

        function getStatusText() {
          switch (status) {
            case 0:
              return '?????????';
            case 1:
              return '?????????';
            case 2:
              return '?????????';
            default:
              return '';
          }
        }

        const publicApi = {
          getAuth,
          cancelAuth,
          getSession,
          sendNowPlaying,
          scrobble,
          getUserInfo,
          getStatusText,
          updateStatus,
          isAuthorized,
          isAuthRequested,
        };

        return publicApi;
      },
    ];
  });
}

lastfm();
