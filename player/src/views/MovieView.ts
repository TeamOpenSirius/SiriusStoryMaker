import { Texture, VideoResource, Sprite, Assets } from "pixi.js";
import { IView } from "../types/View";
import { IEpisodeMovie } from "../types/Episode";

export class MovieView extends IView {
  protected _currentMovie?: Sprite;
  protected _source?: HTMLVideoElement;
  protected _finish?: () => void;

  public execute({ MovieFileName }: IEpisodeMovie, muted = false) {
    if (!MovieFileName || !Assets.cache.has(`movie_${MovieFileName}`)) return;
    this.clear();
    const texture = Assets.get(`movie_${MovieFileName}`) as Texture<VideoResource>;
    const sprite = new Sprite(texture);
    const source = texture.baseTexture.resource.source;
    this._currentMovie = sprite;
    this._source = source;
    this.addChild(sprite);
    this.visible = true;
    source.muted = muted;
    source.currentTime = 0;
    return new Promise<void>((resolve) => {
      const finish = () => {
        source.removeEventListener("ended", finish);
        source.removeEventListener("error", finish);
        if (this._currentMovie === sprite) {
          this._currentMovie = undefined;
          this._source = undefined;
          this._finish = undefined;
          sprite.destroy();
          this.hide();
        }
        resolve();
      };
      this._finish = finish;
      source.addEventListener("ended", finish);
      source.addEventListener("error", finish);
      void source.play().catch(finish);
    });
  }

  public clear() {
    this.pauseMovie();
    this._finish?.();
  }

  public setMuted(muted: boolean) {
    if (this._source) this._source.muted = muted;
  }

  public pauseMovie() {
    this._source?.pause();
  }
}
