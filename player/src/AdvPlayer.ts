import { Container, FederatedPointerEvent, Assets} from "pixi.js";
import "@pixi/sound";
// import { Group } from 'tweedle.js';
//type
import { IEpisodeModel } from "./types/Episode";
//views
import { BackgroundView } from "./views/BackgroundView";
import { CharacterView } from "./views/CharacterView";
import { EffectView } from "./views/EffectView";
import { MovieView } from "./views/MovieView";
import { TextView } from "./views/TextView";
import { FadeView } from "./views/FadeView";
// import { HistoryView } from "./views/HistoryView";
import { UIView } from "./views/UIView";
//
import { CoverOpening } from "./object/coverOpening";
//manager
import { SoundController } from "./controller/soundController";
import { TranslationController } from "./controller/translationController";
//constant
import { baseAssets, Layer, TLFonts } from "./constant/advConstant";
//utils
import { checkImplements, isURL } from "./utils/check";
import { createEmptySprite } from "./utils/emptySprite";
import { resPath } from "./utils/resPath";
import { loadJson, loadResourcesFromEpisode } from './utils/loadResources'
import { banner, TrackLog } from "./utils/logger";

export class AdvPlayer extends Container {
  //init
  protected _loadPromise: Promise<any> | undefined;
  //View
  protected _backgroundView: BackgroundView;
  protected _characterView: CharacterView;
  protected _effectView: EffectView;
  protected _textView: TextView;
  protected _movieView: MovieView;
  protected _fadeView : FadeView;
  // protected _historyView: HistoryView;
  protected _uiView: UIView;
  protected _coverOpening: CoverOpening;
  // Controller
  protected _soundController: SoundController = new SoundController();
  protected _translationController: TranslationController = new TranslationController();
  //episode Info
  protected _episode: IEpisodeModel | undefined;
  protected _currentIndex: number = 0;
  protected _currentGroupOrder: number = 0;
  protected _isAuto: boolean = false;
  protected _isPlaying: boolean = false;
  protected _isVoice: boolean = true;
  protected _isAdventureEnded: boolean = false;
  protected _liveMode: boolean = false;
  protected _renderGen: number = 0;
  protected _liveLoadGen = 0;
  protected _liveLoading = false;
  protected _liveSeekIndex = 0;
  protected _visibleFrame = 0;
  protected _liveEnded = false;
  protected _liveMuted = false;
  protected _pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  protected _processing: Promise<any>[] = [];
  protected _trackPromise: Promise<boolean> | undefined;

  protected _handleVisibilityChange = this._onBlur.bind(this);

  constructor(liveMode: boolean = false) {
    super();
    this._liveMode = liveMode;

    //spine pma setting
    Assets.setPreferences({
      preferCreateImageBitmap: false,
    });

    //advPlayer setting
    this.addChild(createEmptySprite({ empty : true, color: 0x000000 }));
    this.sortableChildren = true;
    this.eventMode = "static";
    if (!this._liveMode) {
      document.addEventListener("visibilitychange", this._handleVisibilityChange);
    }

    //views
    this._uiView = new UIView().addTo(this, Layer.UILayer);
    if (this._liveMode) {
      // Studio live preview: hide unused Auto & Translate overlay buttons
      this._uiView.visible = false;
      this._uiView.eventMode = "none";
    }
    // this._historyView = new HistoryView().addTo(this, Layer.HistroyLayer);
    this._fadeView = new FadeView().addTo(this, Layer.FadeLayer);
    this._movieView = new MovieView().addTo(this, Layer.MovieLayer);
    this._textView = new TextView().addTo(this, Layer.TextLayer);
    this._effectView = new EffectView().addTo(this, Layer.EffectLayer);
    this._characterView = new CharacterView().addTo(this._effectView, Layer.CharacterLayer);
    this._backgroundView = new BackgroundView().addTo(this._effectView, Layer.BackgroundLayer);

    //Cover
    this._coverOpening = CoverOpening.new().addTo(this, Layer.CoverLayer);
    if (this._liveMode) {
      this._coverOpening.visible = false;
      this._coverOpening.eventMode = "none";
    }

    //ui button setting (disabled in Studio live mode)
    if (!this._liveMode) {
      this._uiView.AutoBtn.addclickFun(() => {
        this._isAuto = this._uiView.AutoBtn.Pressed;
        if(this._trackPromise && this._isAuto){
          this._trackPromise = this._trackPromise.then((
            previous_then_not_execute : boolean
          )=>{
            if(!this._isAuto){
              return true;
            }
            if(previous_then_not_execute){
              this._trackPromise = void 0;
              this._renderFrame();
            }
            return false;
          })
        }
      });
    }

    //log
    banner();
  }

  public static create(liveMode: boolean = false) {
    return new this(liveMode);
  }

  protected _cancelPending() {
    this._renderGen++;
    for (const t of this._pendingTimers) clearTimeout(t);
    this._pendingTimers.clear();
    this._processing = [];
    this._trackPromise = void 0;
    this._textView.cancelTyping();
    this._fadeView.cancel();
    this._backgroundView.cancelTimers();
  }

  protected _schedule(fn: () => void, ms: number) {
    const gen = this._renderGen;
    const t = setTimeout(() => {
      this._pendingTimers.delete(t);
      if (gen !== this._renderGen || this.destroyed) return;
      fn();
    }, ms);
    this._pendingTimers.add(t);
  }

  public addTo<C extends Container>(parent: C): AdvPlayer {
    parent.addChild(this);
    return this;
  }

  public async clear() {
    this._cancelPending();
    this._soundController.reset();
    this.off("pointertap", this._tap, this);
    this._currentIndex = 0;
    this._episode = void 0;

    //hide all view!
    this._backgroundView.clear();
    this._characterView.clear();
    this._effectView.clear();
    this._textView.clear();
    this._movieView.clear();
    this._fadeView.clear();
    this._uiView.clear();

    if (this._coverOpening && !this._coverOpening.destroyed) {
      this._coverOpening.destroy({ children: true });
    }
    if (!this._liveMode) {
      this._coverOpening = CoverOpening.new().addTo(this, Layer.CoverLayer);
    }
  }

  public override destroy(options?: any): void {
    this._cancelPending();
    document.removeEventListener("visibilitychange", this._handleVisibilityChange);
    this._soundController.reset();
    this.off("pointertap", this._tap, this);
    super.destroy(options);
  }

  public async load(
    source: string | IEpisodeModel,
    translate?: string
  ) {
    return (this._loadPromise = (async () => {
      if (typeof source === "string") {
        if (!isURL(source)) {
          source = resPath.advJson(source);
        }
        source = await loadJson<IEpisodeModel>(source).catch(() => {
          this._coverOpening.error("The episode ID or URL is not correct, please re-confirm.");
          throw new Error("The episode ID or URL is not correct, please re-confirm.");
        });
      }

      if (!checkImplements<IEpisodeModel>(source)) {
        this._coverOpening.error("Episode file format error.");
        throw new Error("Episode file format error.");
      }

      if (!Assets.cache.has(baseAssets.font)) {
        await Assets.load(baseAssets.font);
      }

      if (this._episode) {
        await this.clear();
      }

      //如果有翻譯語言 就load該語言的翻譯文件
      if(translate){
        await this._translationController.load({
          EpId : source.EpisodeId,
          loadParser : translate,
        });
        //如果有翻譯文件 ui配置&load font asset
        if(this._translationController.hasTranslate){
          this._uiView.enableTLBtn();
          this._textView.isTranslate = this._translationController.hasTranslate;
          this._uiView.TranslateBtn.addclickFun(()=>{
            this._textView.isTranslate = this._uiView.TranslateBtn.Pressed;
            this._textView.toggleTextContent();
          })
          //font asset
          const TLfont = TLFonts.find(font => font.language === translate);
          if(TLfont){
            this._textView.addFontFamily(TLfont.family);
            this._coverOpening.addFontFamily(TLfont.family);
            if(!Assets.cache.has(TLfont.url)){
              this._coverOpening.log('loading assets...');
              await Assets.load(TLfont.url);
            }
          }
        }
      }

      this._episode = source as IEpisodeModel;
      this._coverOpening.init({
          type: this._episode.StoryType,
          chapter: this._episode.Chapter,
          title: this._episode.Title,
          order: this._episode.Order,
          TLTitle : this._translationController.translateModel?.TLTitle,
          info : this._translationController.translateModel?.info
      });

      //load故事所需的資源
      await loadResourcesFromEpisode(
        source,
        this._isVoice,
        (percentage) => this._coverOpening.progress(Math.floor(percentage * 100))
      )
      ;

      return this._episode;
    })());
  }

  public loadAndPlay(
    source: string | IEpisodeModel,
    translate?: string,
    auto?: string
  ) {
    if (auto?.toLocaleLowerCase() === "true") {
      this._isAuto = true;
      this._coverOpening.setAuto(true);
      document.removeEventListener("visibilitychange", this._handleVisibilityChange);
    }
    this.load(source, translate).then(() => this._onready());
  }

  public play(skipCover: boolean = false) {
    if (this._loadPromise) {
      this._loadPromise.then(() => {
        if (skipCover) {
          this._playImmediate();
        } else {
          this._onready();
        }
      });
    }
  }

  public async loadLiveEpisode(episode: IEpisodeModel, startIndex: number = 0) {
    const generation = ++this._liveLoadGen;
    this._liveLoading = true;
    this._liveSeekIndex = startIndex;
    this._liveEnded = false;
    this._isPlaying = false;
    window.parent.postMessage({ type: "wds-adv-player-playstate", playing: false }, "*");
    this._cancelPending();
    this._soundController.reset();
    this._movieView.clear();
    this._loadPromise = void 0;

    try {
      if (!Assets.cache.has(baseAssets.font)) {
        await Assets.load(baseAssets.font).catch(() => {});
      }
      // Muted previews still preload voice, so unmute never needs to reload the episode.
      await loadResourcesFromEpisode(episode, true);
      if (this.destroyed || generation !== this._liveLoadGen) return;
      this._episode = episode;
      this._currentIndex = 0;
      this._visibleFrame = 0;
      this._backgroundView.clear();
      this._characterView.clear();
      this._effectView.clear();
      this._textView.clear();
      this._fadeView.clear();
    } finally {
      if (generation === this._liveLoadGen) this._liveLoading = false;
    }
    if (episode.EpisodeDetail.length > 0) this.seekAndRender(this._liveSeekIndex);
  }

  public setMuted(muted: boolean) {
    this._liveMuted = muted;
    this._soundController.setMuted(muted);
    this._movieView.setMuted(muted);
  }

  public seekTo(index: number) {
    if (!this._episode || this._episode.EpisodeDetail.length === 0) return
    this._currentIndex = Math.max(0, Math.min(Math.floor(index), this._episode.EpisodeDetail.length - 1))
  }

  public setPlaying(playing: boolean) {
    if (!this._episode?.EpisodeDetail.length || this._loadPromise || this._liveLoading || this._isPlaying === playing) return
    if (!playing) {
      this.seekAndRender(this._visibleFrame);
      return;
    }
    this._isPlaying = true;
    window.parent.postMessage({ type: "wds-adv-player-playstate", playing: true }, "*");
    this.seekTo(this._liveEnded ? 0 : this._visibleFrame);
    this._liveEnded = false;
    this._restoreVisualStateBefore(this._currentIndex);
    for (let i = this._currentIndex; i >= 0; i--) {
      const bgm = this.Track?.[i]?.BgmFileName;
      if (bgm) {
        if (!this.currentTrack?.BgmFileName) this._soundController.playBgm(bgm);
        break;
      }
    }
    void this._renderFrame(false);
  }

  public seekAndRender(index: number, instant: boolean = true) {
    if (this._liveLoading) {
      this._liveSeekIndex = index;
      return;
    }
    if (!this._episode?.EpisodeDetail.length || this._loadPromise) return;
    this._isPlaying = false;
    this._liveEnded = false;
    window.parent.postMessage({ type: "wds-adv-player-playstate", playing: false }, "*");
    this._cancelPending();
    this._soundController.reset();
    this._movieView.clear();
    this._characterView.offAllLipSync();
    this.seekTo(index);
    if (this._coverOpening && !this._coverOpening.destroyed) this._coverOpening.visible = false;
    if (!this._liveMode) this._uiView.alpha = 1;
    this._restoreVisualStateBefore(this._currentIndex);
    void this._renderFrame(this._liveMode || instant);
  }

  public stepNext() {
    this.seekAndRender(this._visibleFrame + 1);
  }

  public stepPrev() {
    this.seekAndRender(this._visibleFrame - 1);
  }

  protected _restoreVisualStateBefore(targetIndex: number) {
    if (!this._episode) return
    const details = this._episode.EpisodeDetail
    // A seek can go backwards, so derive the stage from the target, not the last render.
    let latestBg: string | undefined;
    let latestStill: string | undefined;
    for (let i = 0; i <= targetIndex && i < details.length; i++) {
      const frame = details[i];
      if (frame.BackgroundImageFileName) {
        latestBg = frame.BackgroundImageFileName;
        latestStill = undefined;
      }
      if (frame.StillPhotoFileName) latestStill = frame.StillPhotoFileName;
    }
    const target = details[targetIndex];
    if (!target) return;
    if (!latestBg && !latestStill) this._backgroundView.clear();
    if (!target.BackgroundImageFileName && !target.StillPhotoFileName && (latestStill || latestBg)) {
      this._backgroundView.execute({
        BackgroundImageFileName: latestStill ? undefined : latestBg,
        StillPhotoFileName: latestStill,
        BackgroundCharacterImageFileName: target.BackgroundCharacterImageFileName,
      });
    } else if (!target.BackgroundCharacterImageFileName && !target.BackgroundImageFileName && !target.StillPhotoFileName) {
      this._backgroundView.execute({});
    }
    this._effectView.clear();
  }

  protected _playImmediate() {
    if (!this._loadPromise) return
    this._loadPromise = void 0
    if (this._coverOpening && !this._coverOpening.destroyed) {
      this._coverOpening.destroy({ children: true })
    }
    this._uiView.alpha = 1
    this.off("pointertap", this._tap, this)
    this.on("pointertap", this._tap, this)
    this._restoreVisualStateBefore(this._currentIndex)
    if (this._currentIndex === 0 && this.currentTrack) {
      this._backgroundView.execute(this.currentTrack)
    }
    void this._renderFrame()
  }

  protected _onready() {
    if (!this._loadPromise) {
      console.log("dont repeat play");
      return;
    }
    this._loadPromise = void 0;
    //cover
    if (this._isAuto) {
      setTimeout(() => {
        this._play();
      },3000);
    } else {
      this._coverOpening.once("pointertap", this._play, this);
    }
}

  protected _play() {
    this._coverOpening.close(()=>{
      setTimeout(() => {
        //set click event
        this.on("pointertap", this._tap, this);
        this._renderFrame();
      }, 400)
    });

    //ui view showing
    this._isAuto ? this._uiView.AutoBtn.Pressed = this._isAuto : this._uiView.alpha = 1;

    this._preRenderFrame();

    if (this._isAuto) {
      this._uiView.hide();
    }
  }

  protected _next() {
    this._currentIndex++;
    return this.currentTrack;
  }

  protected async _preRenderFrame(){
    if(this._currentIndex != 0 || !this.currentTrack) return;
    this._backgroundView.execute(this.currentTrack);
  }

  protected async _renderFrame(instant: boolean = false) {
    const gen = ++this._renderGen;
    this._trackPromise = void 0;
    let index = this._currentIndex;
    if (!this.currentTrack) {
      this._isPlaying = false;
      this._liveEnded = true;
      if (this._liveMode) { this._soundController.reset(); this._movieView.clear(); }
      window.parent.postMessage({ type: "wds-adv-player-playstate", playing: false }, "*");
      window.parent.postMessage({ type: "wds-adv-player-ended" }, "*");
      return;
    }

    this._visibleFrame = index;
    const track = this.currentTrack;
    const nextTrack = this.nextTrack;

    window.parent.postMessage({
      type: "wds-adv-player-frame",
      index,
      total: this.Track?.length ?? 0,
    }, "*");

    TrackLog(index+1, this.Track!.length, track);

    if (this._translationController.hasTranslate) {
      let tl = this._translationController.findTranslate(track.Id);
      if (tl) {
        track.TLSpeakerName = tl.SpeakerName;
        track.TLPhrase = tl.translation || tl.Phrase;
      }
    }

    if (!instant) this._soundController.sound(track);
    this._effectView.hideEffect(track);

    if (!instant) {
      let fade_process = this._fadeView.execute(track);
      if (fade_process) {
        this._processing.push(fade_process);
        this._characterView.hideCharacter();
        this._textView.hideTextPanel();
      }
    } else {
      this._fadeView.cancel();
    }

    //effect處理
    this._effectView.execute(track);

    //背景處理
    if (instant) {
      if (track.BackgroundImageFileName || track.StillPhotoFileName || track.BackgroundCharacterImageFileName) {
        this._backgroundView.execute({
          BackgroundImageFileName: track.BackgroundImageFileName,
          StillPhotoFileName: track.StillPhotoFileName,
          BackgroundCharacterImageFileName: track.BackgroundCharacterImageFileName,
        });
      }
    } else if (index > 0 || this._liveMode) {
      let bg_process = this._backgroundView.execute(track);
      if (bg_process) {
        this._processing.push(bg_process);
        this._characterView.hideCharacter();
        this._textView.hideTextPanel();
      }
    }

    // Animations 確保動畫跑完
    if (this._processing.length > 0) {
      const pending = this._processing;
      await Promise.all(pending);
      if (this._processing === pending) this._processing = [];
    }
    if (gen !== this._renderGen || this.destroyed) return;

    //影片處理
    if (!instant) {
      let movie_process = this._movieView.execute(track, this._liveMuted);
      if (movie_process) {
        this._characterView.hideCharacter();
        this._textView.hideTextPanel();
        await movie_process;
        if (gen !== this._renderGen || this.destroyed) return;
      }
    }

    //spine處理
    if (track.BackgroundCharacterImageFileName) {
      this._characterView.hideCharacter();
    } else {
      this._characterView.execute(track);
    }

    //對話處理
    let phrase = track.Phrase;
    let isSameGroup = track.GroupOrder == nextTrack?.GroupOrder;
    this._textView.allowNextIconDisplay = !isSameGroup;
    this._textView.execute(track, instant);

    //當播完聲音後 停止spine的口部動作
    this._soundController.onVoiceEnd = () => this._characterView.offAllLipSync();

    //聲音處理
    if (!instant) {
      this._soundController.voice(track);
    }

    //準備下一個unit
    this._next();

    // In instant seek mode (editor cursor / outline jump), stay on this frame without auto-advancing
    if (instant) return;

    // 計算等候時間
    let duration = Math.max(
      this._soundController.voiceDuration,
      this._textView.typingTotalDuration ?? 0
    );

    // 沒有文字或者同組就自動跳下一個
    if (phrase.length === 0 || isSameGroup) {
      if (isSameGroup) {
        duration += 1200;
      }

      this._schedule(() => {
        if (index + 1 === this._currentIndex) {
          void this._renderFrame(false);
        }
      }, duration);

      return;
    }

    if (this._isPlaying || (this._isAuto && !this._liveMode)) {
      const waitMs = Math.max(duration + 1100, 1400);
      this._schedule(() => {
        if ((this._isPlaying || this._isAuto) && index + 1 === this._currentIndex) {
          void this._renderFrame(false);
        }
      }, waitMs);
    }
  }

  protected _onBlur() {
    if (this._isAuto && document.hidden) {
      this._isAuto = false;
      this._uiView.AutoBtn.Pressed = false;
    }
  }

  protected _tap(e: FederatedPointerEvent) {
    if (e.target !== this) {
      return;
    }
    if (this._processing.length === 0 && !this._isAuto) {
      this._renderFrame();
    }
    if (this._isAuto) {
      this._uiView.ShortShow();
    }
  }

  get Track() {
    return this._episode?.EpisodeDetail;
  }

  get currentTrack() {
    return this._episode?.EpisodeDetail[this._currentIndex];
  }

  get nextTrack() {
    return this._currentIndex + 1 >= (this._episode?.EpisodeDetail.length ?? 0)
      ? void 0
      : this._episode?.EpisodeDetail[this._currentIndex + 1];
  }

  get isVoice() {
    return this._isVoice;
  }

  set isVoice(bool : boolean){
    this._isVoice = bool;
    this._soundController.isVoice = this._isVoice;
  }

  get TranslationController(){
    return this._translationController;
  }

}
