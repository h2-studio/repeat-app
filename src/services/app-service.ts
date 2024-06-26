import { createStore, produce, SetStoreFunction } from "solid-js/store";

import { PlaybackEffects } from "@/const";
import { Navigator } from "@solidjs/router";

import AudioService from "./audio-service";
import DbService from "./db-service";
import ResourceService from "./resource-service";
import SubtitleService from "./subtitle-service";

class AppStoreOptionsImpl implements AppStoreOptions {
  playLineWhileRecording: boolean = false;
  playbackRate: number = 1;
  autoPlay: boolean = true;
  autoStopRecording: boolean = true;
}

export class AppService {
  private _videoRef: HTMLVideoElement;
  private _store: AppStore;
  private _setStore: SetStoreFunction<AppStore>;
  private _navigator: Navigator;
  private _playTimeoutId: number;
  private _currentLine: SubtitleLine;

  private _audioService: AudioService;
  private _resourceService: ResourceService;
  private _dbService: DbService;
  private _subtitleService: SubtitleService;

  public get onDomainDataAvailable() {
    return this._audioService.onDomainDataAvailable;
  }

  public set onDomainDataAvailable(fn: (data: number[]) => void) {
    this._audioService.onDomainDataAvailable = fn;
  }

  public get store() {
    return this._store;
  }

  constructor() {
    let stores = createStore({
      options: this.loadOptions(),
    } as AppStore);

    this._store = stores[0];
    this._setStore = stores[1];

    this._resourceService = new ResourceService();

    this._audioService = new AudioService();

    this._audioService.onStateUpdate = (isRecording) => {
      this._setStore("isRecording", isRecording);

      if (this._store.options.playLineWhileRecording) {
        this.playLine(this._currentLine, true);
      }
    };

    this._audioService.autoStopRecording =
      this._store.options.autoStopRecording;

    this._dbService = new DbService();
    this._subtitleService = new SubtitleService();
  }

  private loadOptions(): AppStoreOptions {
    let options = new AppStoreOptionsImpl();

    // load LocalStorage
    for (let name of Object.getOwnPropertyNames(options)) {
      let value = localStorage.getItem(`option:${name}`);
      if (value != null) {
        (options as any)[name] = JSON.parse(value);
      }
    }

    return options;
  }

  private onMediaTimeUpdate() {
    if (this._videoRef.paused) {
      return;
    }

    let currentTime = this._videoRef.currentTime;
    let currentLine = this._store.currentLineIndex
      ? this._store.lines[this._store.currentLineIndex]
      : null;

    if (
      currentLine &&
      currentTime >= currentLine.start &&
      currentTime <= currentLine.end
    ) {
      // still playing the same line
      return;
    }

    // Fine the current line
    // TODO: better line search

    let line = this._store.lines.find(
      (line) => currentTime >= line.start && currentTime <= line.end
    );

    if (line) {
      this.selectLine(line.index, false);
    }
  }

  public async stopAll() {
    if (!this._videoRef.paused) {
      this._videoRef.pause();
    }

    if (this._store.isRecording) {
      this._audioService.stopRecord(true);
    }

    if (this._store.isPlayingRecord) {
      this._audioService.stopPlay();
    }
  }

  public setNavigator(navigator: Navigator) {
    this._navigator = navigator;
  }

  public setMediaRef(mediaRef: HTMLVideoElement) {
    this._videoRef = mediaRef;

    this._videoRef.addEventListener("timeupdate", () => {
      this.onMediaTimeUpdate();
    });

    this._videoRef.addEventListener("play", (e) => {
      this._setStore("isPlaying", true);
    });

    this._videoRef.addEventListener("pause", (e) => {
      this._setStore("isPlaying", false);
    });
  }

  public async startPractice(subtitleUrl: string) {
    let lines = await this._subtitleService.parseSubtitle(subtitleUrl);

    this._setStore(
      produce((store) => {
        store.subtitleUrl = subtitleUrl;
        store.lines = lines;
      })
    );
  }

  public async stopPractice() {
    this._setStore(
      produce((store) => {
        store.subtitleUrl = null;
        store.hasRecord = null;
        store.lines = null;
        store.currentLineIndex = null;
      })
    );
  }

  public navToHome() {
    this._navigator("/");
  }

  public navToStart() {
    this._navigator("/start");
  }

  public navToPractice(sourceUrl: string, subtitleUrl: string) {
    let params = new URLSearchParams({
      sourceUrl,
      subtitleUrl,
    });

    this._navigator("/practice?" + params.toString(), {
      state: {
        fromNavigator: true,
      } as PracticeNavState,
    });
  }

  public navToResource() {
    this._navigator("/resource");
  }

  public async useDemo(type: ResourceType) {
    this.navToPractice(
      `${import.meta.env.BASE_URL}demos/${
        type == "video" ? "video.mp4" : "audio.mp3"
      }`,
      `${import.meta.env.BASE_URL}demos/${type}.srt`
    );
  }

  public async updatePlaybackRate(playbackRate: number) {
    this._videoRef.playbackRate = playbackRate;
    this.updateOption("playbackRate", playbackRate);
  }

  public async updateOption<O extends keyof AppStoreOptions>(
    option: O,
    value: AppStoreOptions[O]
  ) {
    this._setStore("options", option, value);
    localStorage.setItem(`option:${option}`, JSON.stringify(value));

    if (option == "autoStopRecording") {
      this._audioService.autoStopRecording = value as boolean;
    }
  }

  public selectLine(index: number, updateTime: boolean = true) {
    this._setStore("currentLineIndex", index);
    if (index != null) {
      let line = this._store.lines[index];

      if (updateTime) {
        this._videoRef.currentTime = line.start;
        if (this._store.options.autoPlay) {
          this.playSelectLine();
        }
      }
    }
  }

  public unselectLine() {
    // if video is not paused, onMediaTimeUpdate will update currentLineIndex
    this._videoRef.pause();
    this._setStore("currentLineIndex", null);
  }

  public selectPreviousLine() {
    if (this._store.currentLineIndex == null) {
      this.selectLine(0);
    } else if (this._store.currentLineIndex > 1) {
      this.selectLine(this._store.currentLineIndex - 1);
    }
  }

  public selectNextLine() {
    if (this._store.currentLineIndex == null) {
      this.selectLine(0);
    } else if (this._store.currentLineIndex < this._store.lines.length - 1) {
      this.selectLine(this._store.currentLineIndex + 1);
    }
  }

  public playSelectLine() {
    this.playLine(this._store.lines[this._store.currentLineIndex || 0]);
  }

  public playSelectLineRecord() {
    if (this._store.currentLineIndex != null) {
      this.playLineRecord(this._store.lines[this._store.currentLineIndex]);
    }
  }

  public recordSelectLine() {
    if (this._store.currentLineIndex != null) {
      this.recordLine(this._store.lines[this._store.currentLineIndex]);
    }
  }

  public async playLine(line: SubtitleLine, lowVolume: boolean = false) {
    this.stopAll();
    this._currentLine = line;

    clearTimeout(this._playTimeoutId);

    this._videoRef.currentTime = line.start;

    let originVolume: number;
    if (lowVolume) {
      originVolume = this._videoRef.volume;
      this._videoRef.volume = 0.3;
    }

    await this._videoRef.play();

    let duration =
      line.duration * PlaybackEffects[this._videoRef.playbackRate] * 1000;

    this._playTimeoutId = setTimeout(() => {
      if (!this._videoRef.paused) {
        if (lowVolume) {
          this._videoRef.volume = originVolume;
        }

        this._videoRef.pause();
      }
    }, duration);
  }

  public async playLineRecord(line: SubtitleLine) {
    this.stopAll();
    this._currentLine = line;

    if (!line.record) {
      return;
    }

    this._setStore("isPlayingRecord", true);
    this._audioService.play(line.record, () => {
      this._setStore("isPlayingRecord", false);
    });
  }

  public recordLine(line: SubtitleLine) {
    this.stopAll();

    this._currentLine = line;

    this._audioService.record().then((record) => {
      this._setStore("lines", line.index, "record", record);
      if (!this._store.hasRecord) {
        this._setStore("hasRecord", true);

        if (!this._store.subtitleUrl.startsWith("blob:")) {
          this._dbService.setPracticed(this._store.subtitleUrl);
        }
      }

      if (this._store.options.autoPlay) {
        this.playSelectLineRecord();
      }
    });
  }

  public stopRecord() {
    this._audioService?.stopRecord();
  }

  public exportRecord(): Promise<void> {
    return new Promise((resolve, reject) => {
      // make it async
      setTimeout(() => {
        let buffers = this._store.lines.map((l) => l.record).filter((r) => r);
        if (buffers.length == 0) {
          return resolve(null);
        }

        try {
          let blob = this._audioService.export(buffers);

          let ele = document.createElement("a");
          ele.href = window.URL.createObjectURL(blob);

          let date = new Date().toISOString().substring(0, 10);
          ele.download = `repeat-${date}.mp3`;
          ele.click();

          resolve(null);
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  }

  public async loadResourceCategories(): Promise<void> {
    let categories = await this._resourceService.fetchCategories();

    this._setStore("categories", categories);
  }

  public async loadResources(category: ResourceCategory): Promise<void> {
    let resources = await this._resourceService.fetchResources(category.path);

    this._setStore("categories", category.index, "resources", resources);
  }

  public getPracticeRecord(subtitleUrl: string): Promise<PracticeRecord> {
    return this._dbService.getPracticeRecord(subtitleUrl);
  }
}
