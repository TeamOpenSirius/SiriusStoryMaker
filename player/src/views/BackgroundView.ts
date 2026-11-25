import { Sprite, Assets } from "pixi.js";
import { Tween } from "tweedle.js";
import { IView } from "../types/View";
import { FadeTypes, IEpisodeBackground, IEpisodeFade } from "../types/Episode";
import SceneCameraList from "../constant/SceneCamera";

type CameraEffect = {
  Id: number;
  StartPositionX: number;
  StartPositionY: number;
  StartZoomRatio: number;
  EndPositionX: number;
  EndPositionY: number;
  EndZoomRatio: number;
  CameraMoveTurnaroundTimeSeconds: number;
};

export class BackgroundView extends IView {
  protected readonly _bgMap: Map<string, Sprite> = new Map();

  protected _currentBG: Sprite | undefined;
  protected _currentCard: Sprite | undefined;
  protected _currentCardLabel: string = "";
  protected _currentCameraEffects: CameraEffect | undefined;
  protected _cuttentZoom: Tween<any> | undefined;
  protected _timers: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor() {
    super();

    this.sortableChildren = true;
  }

  static new() {
    return new this();
  }

  public cancelTimers(): void {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    if (this._cuttentZoom) {
      this._cuttentZoom.stop();
      this._cuttentZoom = void 0;
    }
  }

  public clear(): void {
    this.cancelTimers();
    this._bgMap.clear();
    if (this._currentBG && !this._currentBG.destroyed) {
      this.removeChild(this._currentBG);
    }
    this._currentBG = void 0;
    if (this._currentCard && !this._currentCard.destroyed) {
      this.removeChild(this._currentCard);
    }
    this._currentCard = void 0;
    this._currentCardLabel = "";
  }

  public override destroy(options?: any): void {
    this.cancelTimers();
    super.destroy(options);
  }

  execute({
    BackgroundImageFileName,
    BackgroundCharacterImageFileName,
    BackgroundImageFileFadeType,
    StillPhotoFileName,
    SceneCameraMasterId,
    FadeValue1 = 0,
  }: IEpisodeBackground & IEpisodeFade) {

    //清除之前的CameraEffect
    if (this._currentCameraEffects && this._cuttentZoom) {
      this._cuttentZoom.stop();
      this._currentBG?.position.set(
        1920 / 2 - (this._currentCameraEffects?.EndPositionX ?? 0),
        1080 / 2 - (this._currentCameraEffects?.EndPositionY ?? 0)
      );
      this._cuttentZoom = void 0;
      this._currentCameraEffects = void 0;
    }

    //清除之前的 BackgroundCharacterImageFileName
    if(!BackgroundCharacterImageFileName && this._currentCard){
      this.removeChild(this._currentCard);
      this._currentCard = void 0
    }

    //如果沒有就什麼都不做
    if (
      !BackgroundImageFileName &&
      !BackgroundCharacterImageFileName &&
      !StillPhotoFileName
    ) {
      return;
    }

    //如果有 BackgroundCharacterImageFileName
    if (BackgroundCharacterImageFileName && BackgroundCharacterImageFileName != this._currentCardLabel){
      let card;

      if (!this._bgMap.has(BackgroundCharacterImageFileName)){
        card = new Sprite(Assets.get(`card_${BackgroundCharacterImageFileName}`));
        card.anchor.set(0.5);
        card.scale.set(1.17);
        card.position.set(1920 / 2, 1080 / 2);
        card.zIndex = 2;
        this._bgMap.set(BackgroundCharacterImageFileName, card);
      }

      this._currentCard = card || this._bgMap.get(BackgroundCharacterImageFileName)!;
      this._currentCardLabel = BackgroundCharacterImageFileName;
      this.addChild(this._currentCard!);
    }

    let FadeDuration : number = 0;
    let ZoomDuration : number = 0;
    let newbg: Sprite | undefined ;

    // 如果有 BackgroundImageFileName
    if (BackgroundImageFileName) {
      if (this._currentBG) {
        this._currentBG.zIndex = 0;
      }

      if (!this._bgMap.has(BackgroundImageFileName)) {
        const bgTex = Assets.get(`bg_${BackgroundImageFileName}`);
        if (!bgTex) {
          console.warn(`[BackgroundView] Background texture missing: ${BackgroundImageFileName}`);
        } else {
          newbg = new Sprite(bgTex);
          newbg.anchor.set(0.5);
          const safeW = Math.max(1, newbg.texture.width);
          const safeH = Math.max(1, newbg.texture.height);
          newbg.scale.set(BackgroundImageFileName?.startsWith("asset_")
            ? Math.max(1920 / safeW, 1080 / safeH)
            : 1.17);
          newbg.position.set(1920/2, 1080/2);
          this._bgMap.set(BackgroundImageFileName, newbg);
        }
      }

      newbg = newbg || this._bgMap.get(BackgroundImageFileName);

      if(newbg && newbg!= this._currentBG){
        newbg.zIndex = 1;
        newbg.alpha = 0;
        this.addChild(newbg);
      }
    }

    // 如果有 StillPhotoFileName
    if (StillPhotoFileName) {
      if (this._currentBG) {
        this._currentBG.zIndex = 0;
      }

      if (!this._bgMap.has(StillPhotoFileName)) {
        newbg = new Sprite(Assets.get(`still_${StillPhotoFileName}`));
        newbg.anchor.set(0.5);
        newbg.scale.set(1.17);
        newbg.position.set(1920 / 2, 1080 / 2);
        this._bgMap.set(StillPhotoFileName, newbg);
      }

      newbg = newbg || this._bgMap.get(StillPhotoFileName)!;
      newbg.zIndex = 1;
      newbg.alpha = 0;
      this.addChild(newbg);
    }

    // 如果有SceneCameraEffect
    if (SceneCameraMasterId && newbg) {
      //未諗到點做
      this._currentCameraEffects = SceneCameraList.find((effect) => effect.Id == SceneCameraMasterId);
      newbg.scale.set(0.007 * (this._currentCameraEffects?.StartZoomRatio || 160)); //條數唔識計
      newbg.position.set(
        1920 / 2 - (this._currentCameraEffects?.StartPositionX ?? 0),
        1080 / 2 - (this._currentCameraEffects?.StartPositionY ?? 0)
      );
      this._cuttentZoom = new Tween(newbg).to(
        {
          position: {
            x: 1920 / 2 - (this._currentCameraEffects?.EndPositionX ?? 0),
            y: 1080 / 2 - (this._currentCameraEffects?.EndPositionY ?? 0),
          },
          scale: 1.17, //條數唔識計
        },
        this._currentCameraEffects?.CameraMoveTurnaroundTimeSeconds
      );
      ZoomDuration = this._currentCameraEffects?.CameraMoveTurnaroundTimeSeconds || 0
    }

    // 如果是Fade動畫
    if (BackgroundImageFileFadeType && newbg) {
      switch (BackgroundImageFileFadeType){
        case FadeTypes.CrossFade:
          new Tween(newbg).to({ alpha: 1 }, FadeValue1 * 1000).start();
          FadeDuration = FadeValue1 * 1000;
          break;
        default:
          FadeDuration = FadeValue1 * 1000;
          break;
      }
    }

    //執行更換背景
    //如果有Fade效果 會等一段時間才更換背景 並等待動畫完成
    if(FadeDuration > 0){
      const t1 = setTimeout(()=>{
        this._timers.delete(t1);
        if (!this.destroyed) this._insertBG(newbg, this._cuttentZoom);
      }, FadeDuration);
      this._timers.add(t1);

      return new Promise<void>((res, _) => {
        const t2 = setTimeout(()=>{
          this._timers.delete(t2);
          res();
        }, FadeDuration + 250);
        this._timers.add(t2);
      })
    }

    //如果沒有Fade效果 但有zoomEffect 就直接更換背景 並等待動畫完成
    if(this._cuttentZoom){
      this._insertBG(newbg, this._cuttentZoom);
      return new Promise<void>((res, _) => {
        const t3 = setTimeout(()=>{
          this._timers.delete(t3);
          res();
        }, ZoomDuration);
        this._timers.add(t3);
      })
    }

    //什麼都沒有 就直接換
    this._insertBG(newbg, this._cuttentZoom);
    return;
  }

  _insertBG(newbg?: Sprite, zoom?: Tween<any>) {
    if (zoom) {
      zoom.start().onComplete(() => {
        this._cuttentZoom = void 0;
        this._currentCameraEffects = void 0;
      });
    }

    if (newbg && newbg != this._currentBG) {
      newbg.alpha = 1;
      this._currentBG && this.removeChild(this._currentBG);
      this._currentBG = newbg;
    }
  }

}
