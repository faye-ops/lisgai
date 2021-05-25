/* eslint-disable no-underscore-dangle */
/* global MediaMetadata playerSendMessage */
/* global Howl Howler */

{
  /**
   * Player class containing the state of our playlist and where we are in it.
   * Includes all methods for playing, skipping, updating the display, etc.
   * @param {Array} playlist Array of objects with playlist song details ({title, file, howl}).
   */
  class Player {
    constructor() {
      this.playlist = [];
      this.index = -1;
      this._loop_mode = 0;
      this._media_uri_list = {};
      this.playedFrom = 0;
      this.mode = 'background';
      this.skipTime = 15;
    }

    setMode(newMode) {
      this.mode = newMode;
    }

    setRefreshRate(rate = 10) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => {
        if (this.playing) {
          this.sendFrameUpdate();
        }
      }, 1000 / rate);
    }

    get currentAudio() {
      return this.playlist[this.index];
    }

    get currentHowl() {
      return this.currentAudio && this.currentAudio.howl;
    }

    get playing() {
      return this.currentHowl ? this.currentHowl.playing() : false;
    }

    static get muted() {
      return !!Howler._muted;
    }

    insertAudio(audio, idx) {
      if (this.playlist.find((i) => audio.id === i.id)) return;

      const audioData = {
        ...audio,
        disabled: false, // avoid first time load block
        howl: null,
      };
      if (idx) {
        this.playlist.splice(idx, 0, [audio]);
      } else {
        this.playlist.push(audioData);
      }
      this.sendPlaylistEvent();
    }

    removeAudio(idx) {
      if (!this.playlist[idx]) {
        return;
      }
      if (this.playlist[idx].howl && this.playlist[idx].howl.playing()) {
        this.skip('next');
      }
      this.playlist.splice(idx, 1);
      this.sendPlaylistEvent();
    }

    appendAudioList(list) {
      if (!Array.isArray(list)) {
        return;
      }
      list.forEach((audio) => {
        this.insertAudio(audio);
      });
    }

    clearPlaylist() {
      this.playlist = [];
      Howler.stop();
      this.sendPlaylistEvent();
    }

    setNewPlaylist(list) {
      if (list.length) {
        Howler.stop();

        this.playlist = list.map((audio) => ({
          ...audio,
          howl: null,
        }));
        // TODO: random mode need random choose first song to load
        this.index = 0;
        this.load(0);
      }
      this.sendPlaylistEvent();
    }

    playById(id) {
      const idx = this.playlist.findIndex((audio) => audio.id === id);
      this.play(idx);
    }

    loadById(id) {
      const idx = this.playlist.findIndex((audio) => audio.id === id);
      this.load(idx);
    }

    /**
     * Play a song in the playlist.
     * @param  {Number} index Index of the song in the playlist
     * (leave empty to play the first or current).
     */
    play(idx) {
      this.load(idx, true);
    }

    retrieveMediaUrl(index, playNow) {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:RETRIEVE_URL',
        data: {
          ...this.playlist[index],
          howl: undefined,
          index,
          playNow,
        },
      });
    }

    /**
     * Load a song from the playlist.
     * @param  {Number} index Index of the song in the playlist
     * (leave empty to load the first or current).
     */
    load(idx, playNow = false) {
      let index = typeof idx === 'number' ? idx : this.index;
      if (index < 0) return;
      if (!this.playlist[index]) {
        index = 0;
      }

      if (this.index !== index) Howler.stop();
      const data = this.playlist[index];

      if (!data.howl || !this._media_uri_list[data.id]) {
        this.retrieveMediaUrl(index, playNow);
      } else {
        this.finishLoad(index, playNow);
      }
    }

    finishLoad(index, playNow) {
      const data = this.playlist[index];

      // If we already loaded this track, use the current one.
      // Otherwise, setup and load a new Howl.
      const self = this;
      if (!data.howl) {
        data.howl = new Howl({
          src: [self._media_uri_list[data.url || data.id]],
          volume: 1,
          mute: self.muted,
          html5: true, // Force to HTML5 so that the audio can stream in (best for large files).
          onplay() {
            if ('mediaSession' in navigator) {
              const { mediaSession } = navigator;
              mediaSession.playbackState = 'playing';
              mediaSession.metadata = new MediaMetadata({
                title: self.currentAudio.title,
                artist: self.currentAudio.artist,
                album: `Listen1  •  ${(
                  self.currentAudio.album || '<???>'
                ).padEnd(100)}`,
                artwork: [
                  {
                    src: self.currentAudio.img_url,
                    sizes: '300x300',
                  },
                ],
              });
            }
            self.currentAudio.disabled = false;
            self.playedFrom = Date.now();
            self.sendPlayingEvent('Playing');
          },
          onload() {
            self.currentAudio.disabled = false;
            self.sendPlayingEvent('Loaded');
            self.sendFullUpdate();
          },
          onend() {
            switch (self.loop_mode) {
              case 2:
                self.skip('random');
                break;

              case 1:
                self.play();
                break;

              case 0:
              default:
                self.skip('next');
                break;
            }
            self.sendPlayingEvent('Ended');
            self.sendFullUpdate();
          },
          onpause() {
            navigator.mediaSession.playbackState = 'paused';
            self.sendPlayingEvent('Paused');
            self.sendFullUpdate();
          },
          onstop() {
            self.sendPlayingEvent('Stopped');
            self.sendFullUpdate();
          },
          onseek() {},
          onvolume() {},
          onloaderror(id, err) {
            playerSendMessage(this.mode, {
              type: 'BG_PLAYER:PLAY_FAILED',
              data: err,
            });
            self.currentAudio.disabled = true;
            self.sendPlayingEvent('err');
            self.currentHowl.unload();
            delete self._media_uri_list[data.id];
          },
          onplayerror(id, err) {
            playerSendMessage(this.mode, {
              type: 'BG_PLAYER:PLAY_FAILED',
              data: err,
            });
            self.currentAudio.disabled = true;
            self.sendPlayingEvent('err');
          },
        });
      }
      // Keep track of the index we are currently playing.
      this.index = index;
      this.sendLoadEvent();
      if (playNow && !this.currentHowl.playing()) {
        this.currentHowl.play();
      }
    }

    /**
     * Pause the currently playing track.
     */
    pause() {
      if (!this.currentHowl) return;

      // Puase the sound.
      this.currentHowl.pause();
    }

    /**
     * Skip to the next or previous track.
     * @param  {String} direction 'next' or 'prev'.
     */
    skip(direction) {
      // Get the next track based on the direction of the track.
      let { index } = this;
      let nextIndex = null;
      if (this._loop_mode === 2 || direction === 'random') {
        // random
        nextIndex = () => Math.floor(Math.random() * this.playlist.length);
      } else if (direction === 'prev') {
        nextIndex = (idx) => (idx - 1) % this.playlist.length;
      } else if (direction === 'next') {
        nextIndex = (idx) => (idx + 1) % this.playlist.length;
      }
      let tryCount = 0;
      while (tryCount < this.playlist.length - 1) {
        index = nextIndex(index);
        if (!this.playlist[index].disabled) {
          this.skipTo(index);
          return;
        }
        tryCount += 1;
      }
      this.skipTo(index);
    }

    /**
     * Skip to a specific track based on its playlist index.
     * @param  {Number} index Index in the playlist.
     */
    skipTo(index) {
      // Play the new track.
      this.play(index);
    }

    set loop_mode(input) {
      const LOOP_MODE = {
        all: 0,
        one: 1,
        shuffle: 2,
      };
      let myMode = 0;
      if (typeof input === 'string') {
        myMode = LOOP_MODE[input];
      } else {
        myMode = input;
      }
      if (!Object.values(LOOP_MODE).includes(myMode)) {
        return;
      }
      this._loop_mode = myMode;
      this.sendFullUpdate();
    }

    get loop_mode() {
      return this._loop_mode;
    }

    /**
     * Set the volume and update the volume slider display.
     * @param  {Number} val Volume between 0 and 1.
     */
    set volume(val) {
      // Update the global volume (affecting all Howls).
      if (val) {
        Howler.volume(val);
        this.sendVolumeEvent();
        this.sendFrameUpdate();
      }
    }

    // eslint-disable-next-line class-methods-use-this
    get volume() {
      return Howler.volume();
    }

    adjustVolume(inc) {
      this.volume = this.volume + inc ? 0.1 : -0.1;
      this.sendVolumeEvent();
      this.sendFrameUpdate();
    }

    mute() {
      Howler.mute(true);
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:MUTE',
        data: true,
      });
      this.sendFullUpdate();
    }

    unmute() {
      Howler.mute(false);
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:MUTE',
        data: false,
      });
      this.sendFullUpdate();
    }

    /**
     * Seek to a new position in the currently playing track.
     * @param  {Number} per Percentage through the song to skip.
     */
    seek(per) {
      if (!this.currentHowl) return;

      // Get the Howl we want to manipulate.
      const audio = this.currentHowl;

      // Convert the percent into a seek position.
      // if (audio.playing()) {
      // }
      audio.seek(audio.duration() * per);
    }

    /**
     * Format the time from seconds to M:SS.
     * @param  {Number} secs Seconds to format.
     * @return {String}      Formatted time.
     */
    static formatTime(secs) {
      const minutes = Math.floor(secs / 60) || 0;
      const seconds = secs - minutes * 60 || 0;

      return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    setMediaURI(uri, url) {
      if (url) {
        this._media_uri_list[url] = uri;
      }
    }

    setAudioDisabled(disabled, idx) {
      if (this.playlist[idx]) {
        this.playlist[idx].disabled = disabled;
      }
    }

    async sendFullUpdate() {
      return this;
      // const data = {
      //   muted: Player.muted,
      //   volume: Howler.volume(),
      //   loop_mode: this.loop_mode,
      //   playing: {
      //     id: this.currentAudio ? this.currentAudio.id : 0,
      //     duration: this.currentHowl ? this.currentHowl.duration() : 0,
      //     pos: this.currentHowl && this.currentHowl.state() === 'loaded' ?
      //       this.currentHowl.seek() : 0,
      //     playing: this.playing,
      //   },
      // };
      // playerSendMessage(this.mode, {
      //   type: 'BG_PLAYER:FULL_UPDATE',
      //   data,
      // });
    }

    async sendFrameUpdate() {
      const data = {
        id: this.currentAudio ? this.currentAudio.id : 0,
        duration: this.currentHowl ? this.currentHowl.duration() : 0,
        pos: this.currentHowl ? this.currentHowl.seek() : 0,
        playedFrom: this.playedFrom,
        playing: this.playing,
      };
      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: this.currentHowl ? this.currentHowl.duration() : 0,
          playbackRate: this.currentHowl ? this.currentHowl.rate() : 1,
          position: this.currentHowl ? this.currentHowl.seek() : 0,
        });
      }

      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:FRAME_UPDATE',
        data,
      });
    }

    async sendPlayingEvent(reason = 'UNKNOWN') {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAY_STATE',
        data: {
          isPlaying: this.playing,
          reason,
        },
      });
    }

    async sendLoadEvent() {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:LOAD',
        data: {
          ...this.currentAudio,
          howl: undefined,
        },
      });
    }

    async sendVolumeEvent() {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:VOLUME',
        data: this.volume * 100,
      });
    }

    async sendPlaylistEvent() {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAYLIST',
        data: this.playlist.map((audio) => ({ ...audio, howl: undefined })),
      });
    }
  }

  // Setup our new audio player class and pass it the playlist.

  window.threadPlayer = new Player();
  window.threadPlayer.setRefreshRate();
  window.threadPlayer.sendFullUpdate();

  const { threadPlayer } = window;
  const { mediaSession } = navigator;
  // TODO: enable after the play url retrieve logic moved to bg
  mediaSession?.setActionHandler('play', () => {
    threadPlayer.play();
  });
  mediaSession?.setActionHandler('pause', () => {
    threadPlayer.pause();
  });
  mediaSession?.setActionHandler('seekforward', () => {
    // User clicked "Seek Forward" media notification icon.
    const { currentHowl } = threadPlayer;
    const newTime = Math.min(
      currentHowl.seek() + threadPlayer.skipTime,
      currentHowl.duration()
    );
    currentHowl.seek(newTime);
  });

  mediaSession?.setActionHandler('seekbackward', () => {
    // User clicked "Seek Backward" media notification icon.
    const { currentHowl } = threadPlayer;
    const newTime = Math.max(currentHowl.seek() - threadPlayer.skipTime, 0);
    currentHowl.seek(newTime);
  });
  mediaSession?.setActionHandler('nexttrack', () => {
    threadPlayer.skip('next');
  });
  mediaSession?.setActionHandler('previoustrack', () => {
    threadPlayer.skip('prev');
  });
  playerSendMessage(this.mode, {
    type: 'BG_PLAYER:READY',
  });
}
