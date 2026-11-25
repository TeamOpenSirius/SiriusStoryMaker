import { AlphaFilter, Graphics} from "pixi.js";
import { Tween } from "tweedle.js";
import { Spine } from '@esotericsoftware/spine-pixi';
import { baseAssets } from "../constant/advConstant";

export class AdvTimeElapsedAnimation extends Graphics{

    protected _jugon : Spine | undefined;
    protected aplha_filter = new AlphaFilter();
    protected _spineDuratinon = 3400;

    constructor(){
        super();
        this.beginFill(0xffffff);
        this.drawRect(0, 0, 1920, 1080);
        this.alpha = 0;

        // The decorative Spine transition is optional; missing production assets
        // must never prevent the story player from loading.
        Promise.resolve().then(()=>{
            const progress = (baseAssets as any).jugon_progress as string | undefined;
            const progressAtlas = (baseAssets as any).jugon_progress_atlas as string | undefined;
            if (!progress || !progressAtlas) return;
            this._jugon = Spine.from(progress, progressAtlas);
            this._jugon.scale.set(.25);
            this._jugon.visible = false;
            this.addChild(this._jugon);

            let jugon_height = this._jugon.getBounds().height;
            this._jugon.position.set(1920 / 2, 1080 / 2 + (jugon_height/2));
            this._jugon.filters = [this.aplha_filter];
            this._jugon.state.addListener({
                complete :() => this._hide(),
            })
        }).catch(() => undefined)
    }

    static create(){
        return new this();
    }

    get FadeIn(){
        return new Tween(this)
            .to({alpha : 1}, 400)
            .onComplete(()=>{
                if (this._jugon) { this._jugon.visible = true; this._jugon.state.setAnimation(0, "animation", false); }
            })
    }

    _hide(){
        new Tween(this.aplha_filter)
            .to({alpha : 0}, 300)
            .chain(new Tween(this)
                .to({alpha : 0}, 300)
                .delay(800)
                .onComplete(()=>{
                    this._jugon!.visible = false;
                })
                .start()
            )
            .start();
    }

    get totalDuration(){
        return 400 + this._spineDuratinon + 1200;
    }
}
