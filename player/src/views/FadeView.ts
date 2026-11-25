import { Sprite } from "pixi.js";
import { Tween } from "tweedle.js";
import { IView } from "../types/View";
import { FadeTypes, IEpisodeFade } from "../types/Episode";
import createEmptySprite from "../utils/emptySprite";
import { AdvTimeElapsedAnimation } from "../object/advTimeElapsedAnimation";

export class FadeView extends IView {

    protected readonly _whiteFadePanel: Sprite = createEmptySprite({ alpha: 0 });
    protected readonly _blackFadePanel: Sprite = createEmptySprite({
        color: 0x000000,
        alpha: 0,
    });
    protected readonly _advTimeElapsed: AdvTimeElapsedAnimation = AdvTimeElapsedAnimation.create();
    protected _totalDuration = 0;
    protected _activeTween: Tween<any> | undefined;
    protected _activeTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(){
        super();

        this.sortableChildren = true;

        this._whiteFadePanel.zIndex = 5;
        this.addChild(this._whiteFadePanel);

        this._blackFadePanel.zIndex = 5;
        this.addChild(this._blackFadePanel);

        this._advTimeElapsed.zIndex = 5;
        this.addChild(this._advTimeElapsed);
    }

    public cancel(): void {
        if (this._activeTimer) {
            clearTimeout(this._activeTimer);
            this._activeTimer = void 0;
        }
        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween.stopChainedTweens();
            this._activeTween = void 0;
        }
        if (!this._whiteFadePanel.destroyed) this._whiteFadePanel.alpha = 0;
        if (!this._blackFadePanel.destroyed) this._blackFadePanel.alpha = 0;
        if (!this._advTimeElapsed.destroyed) this._advTimeElapsed.alpha = 0;
    }

    public clear(): void {
        this.cancel();
    }

    public override destroy(options?: any): void {
        this.cancel();
        super.destroy(options);
    }

    execute({
        BackgroundImageFileFadeType,
        FadeValue1 = 0,
        FadeValue2 = 0,
        FadeValue3 = 0,
    }: IEpisodeFade) {
      let fadein: Tween<any> | undefined;

      if (BackgroundImageFileFadeType) {
        switch (BackgroundImageFileFadeType) {

          case FadeTypes.BlackFadeOutFadeIn:
            fadein = new Tween(this._blackFadePanel)
              .to( { alpha: 1 }, FadeValue1 * 1000 )
              .chain(
                new Tween(this._blackFadePanel)
                  .delay(2000 + FadeValue2 * 1000)
                  .to({ alpha: 0 }, FadeValue3 * 1000)
              )
            this._totalDuration = (FadeValue1 * 1000) + (2000 + (FadeValue2 * 1000)) + (FadeValue3 * 1000);
            break;

          case FadeTypes.WhiteFadeOutFadeIn:
            fadein = new Tween(this._whiteFadePanel)
              .to({ alpha: 1 }, FadeValue1 * 1000 )
              .chain(
                new Tween(this._whiteFadePanel)
                  .delay(2000 + FadeValue2 * 1000)
                  .to({ alpha: 0 }, FadeValue3 * 1000)
              );
              this._totalDuration = (FadeValue1 * 1000) + (2000 + (FadeValue2 * 1000)) + (FadeValue3 * 1000);
            break;

          case FadeTypes.TimeElapsed:
            fadein = this._advTimeElapsed.FadeIn;
            this._totalDuration = this._advTimeElapsed.totalDuration + 200;
            break;
        }
      }

      if(fadein){
        this.cancel();
        this._activeTween = fadein;
        fadein.start();
        return new Promise<void>((res, _)=>{
          this._activeTimer = setTimeout(()=>{
            this._activeTimer = void 0;
            res();
          }, this._totalDuration + 200)
        })
      }
      else{
        return;
      }
    }
}

// ------------|--------------------|------------
//    Value1   |       Value2       |   Value3

// 等 Value1 入 fade?
// Value2 < 0 ? 1 - Value2 : Value2
// 出 fade 等 Value3 到下一個unit?
