import '@pixi/unsafe-eval';
import { Application, Assets } from 'pixi.js';
import { Spine } from '@esotericsoftware/spine-pixi';
import '@pixi/sound';
import { AdvPlayer } from './AdvPlayer';
import { recordStage } from './utils/recordStage';
import { createApp } from './utils/createApp';
import { AdventureAnimationStandCharacter } from './object/characterSpineModel';
import { resPath } from './utils/resPath';
import { baseAssets } from './constant/advConstant';
import type { IEpisodeModel } from './types/Episode';

const status = document.getElementById('status')!;
function notify(type: string, message?: string) {
  window.parent.postMessage({ type, message }, '*');
}
function fail(reason: unknown) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'object' && reason !== null
        ? JSON.stringify(reason)
        : String(reason);
  status.textContent = `剧情加载或播放失败：${message}`;
  status.hidden = false;
  notify('wds-adv-player-error', message);
}
function isolateSpineRendererError(message: string) {
  if (!/reading ['"]position['"]|position of null/i.test(message)) return false;
  const stage = (globalThis as { __PIXI_APP__?: { stage?: { children?: unknown[] } } }).__PIXI_APP__?.stage;
  const visit = (node: any) => {
    if (!node) return;
    if (node.skeleton && 'autoUpdate' in node) {
      node.autoUpdate = false;
      node.visible = false;
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(stage);
  console.warn('已隔离异常 Spine 角色，剧情继续播放。');
  return true;
}

window.addEventListener('error', (event) => {
  const message = String(event.message || event.error?.message || '');
  if (!isolateSpineRendererError(message)) fail(event.error || event.message);
  else event.preventDefault();
});
window.addEventListener('unhandledrejection', (event) => fail(event.reason));

try {
  const params = new URLSearchParams(location.search);
  const spineId = Number(params.get('spine'));
  if (params.get('mode') === 'spine-thumb') {
    const SIZE = 200;
    const app = new Application<HTMLCanvasElement>({
      hello: false,
      width: SIZE,
      height: SIZE,
      backgroundAlpha: 0,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    app.ticker.stop();
    document.body.appendChild(app.view);
    status.hidden = true;
    notify('wds-spine-thumb-ready');

    let busy = false;
    window.addEventListener('message', async (event) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'wds-render-spine-thumb' || !data.id || busy) return;
      busy = true;
      const id = String(data.id);
      const bundleName = `thumb_${id}`;
      let spine: Spine | null = null;
      try {
        Assets.addBundle(bundleName, {
          [`spine_${id}`]: resPath.spine(Number(id)),
          [`spine_atlas_${id}`]: resPath.spine_atlas(Number(id)),
        });
        await Assets.loadBundle(bundleName);
        spine = Spine.from(`spine_${id}`, `spine_atlas_${id}`);
        try {
          spine.state.setAnimation(0, 'breath', false);
        } catch {
          // ignore if animation name differs
        }
        spine.update(0);
        app.stage.addChild(spine);
        const bounds = spine.getLocalBounds();
        if (bounds.width > 0 && bounds.height > 0) {
          // Frame upper-body bust portrait (top ~52% of full standing height)
          const focusH = bounds.height * 0.52;
          const scale = Math.min((SIZE * 0.92) / Math.max(bounds.width * 0.65, focusH), (SIZE * 0.96) / focusH);
          spine.scale.set(scale);
          spine.x = SIZE / 2 - (bounds.x + bounds.width / 2) * scale;
          spine.y = SIZE * 0.06 - bounds.y * scale;
        } else {
          spine.scale.set(0.32);
          spine.x = SIZE / 2;
          spine.y = SIZE * 1.65;
        }
        app.renderer.render(app.stage);
        const dataUrl = app.view.toDataURL('image/webp', 0.84);
        window.parent.postMessage({ type: 'wds-spine-thumb-result', id, dataUrl }, '*');
      } catch {
        window.parent.postMessage({ type: 'wds-spine-thumb-error', id }, '*');
      } finally {
        if (spine) {
          app.stage.removeChild(spine);
          spine.destroy({ children: true });
        }
        await Assets.unloadBundle(bundleName).catch(() => {});
        busy = false;
      }
    });
  } else if (spineId > 0) {
    const app = createApp();
    Assets.addBundle('preview', {
      [`spine_${spineId}`]: resPath.spine(spineId),
      [`spine_atlas_${spineId}`]: resPath.spine_atlas(spineId),
    });
    await Assets.loadBundle('preview');
    const character = new AdventureAnimationStandCharacter(spineId);
    character.addTo(app.stage);
    character.changePosition(3);
    character.showCharacter();
    status.hidden = true;
  } else if (['live', 'standalone', 'record'].includes(params.get('mode') ?? '')) {
    const mode = params.get('mode');
    const editing = mode === 'live';
    const app = createApp(editing);
    Assets.addBundle('player-ui', baseAssets);
    await Assets.loadBundle('player-ui');

    const player = AdvPlayer.create(editing).addTo(app.stage);
    if (mode === 'record') player.prepareAutomaticCover();
    if (mode === 'standalone') {
      player.onOpenAudioSettings(() => notify('wds-open-audio-settings'));
      addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
          event.preventDefault();
          notify('wds-open-playback-file');
        } else if ((event.ctrlKey || event.metaKey) && event.key === ',') {
          event.preventDefault();
          notify('wds-open-audio-settings');
        }
      });
    }
    status.textContent = '等待剧集数据…';
    notify('wds-adv-player-ready');

    let loadSeq = 0;
    let recording: ReturnType<typeof recordStage> | undefined;
    let loaded = false;
    window.addEventListener('message', async (event) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'wds-record-start' && mode === 'record' && loaded && !recording) {
        try {
          recording = recordStage(app.view, player);
          await recording.start();
        } catch (err) {
          notify('wds-record-error', err instanceof Error ? err.message : String(err));
        }
      } else if (data.type === 'wds-record-stop') {
        recording?.stop();
      } else if (data.type === 'wds-load-episode' && data.episode && !recording) {
        loaded = false;
        const seq = ++loadSeq;
        try {
          // Native modes show the original cover itself while loading.
          status.hidden = true;
          player.setMuted(data.muted === true);
          player.setAudioMix(data.audioMix);
          if (editing) await player.loadLiveEpisode(data.episode as IEpisodeModel, Number(data.startIndex) || 0);
          else await player.load(data.episode as IEpisodeModel);
          if (seq !== loadSeq) return;
          loaded = true;
          window.parent.postMessage({
            type: 'wds-adv-player-loaded', loadId: data.loadId, missingAudio: player.missingAudio,
          }, event.origin);
          if (mode === 'standalone') player.play();
        } catch (err) {
          if (seq === loadSeq) fail(err);
        }
      } else if (data.type === 'wds-audio-mix') {
        player.setAudioMix(data.audioMix);
      } else if (editing && data.type === 'wds-audition-audio') {
        player.auditionAudio(typeof data.bgm === 'string' ? data.bgm : undefined, typeof data.se === 'string' ? data.se : undefined);
      } else if (editing && data.type === 'wds-seek' && typeof data.index === 'number') {
        player.seekAndRender(data.index, data.play === true);
      } else if (editing && data.type === 'wds-mute') {
        player.setMuted(data.muted === true);
      } else if (editing && data.type === 'wds-play') {
        player.setPlaying(true);
      } else if (editing && data.type === 'wds-pause') {
        player.setPlaying(false);
      }
    });
  } else {
    const source = params.get('id');
    if (!source) throw new Error('缺少剧情 JSON 地址。');
    const app = createApp();
    Assets.addBundle('player-ui', baseAssets);
    await Assets.loadBundle('player-ui');
    const player = AdvPlayer.create();
    player.addTo(app.stage);
    player.isVoice = false;
    await player.load(source);
    player.seekTo(Number(params.get('start') || 0));
    status.hidden = true;
    player.play();
    notify('wds-adv-player-ready');
  }
} catch (reason) {
  fail(reason);
}
