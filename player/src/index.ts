import '@pixi/unsafe-eval';
import { Assets } from 'pixi.js';
import '@esotericsoftware/spine-pixi';
import '@pixi/sound';
import { AdvPlayer } from './AdvPlayer';
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
  if (spineId > 0) {
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
  } else if (params.get('mode') === 'live') {
    const app = createApp();
    Assets.addBundle('player-ui', baseAssets);
    await Assets.loadBundle('player-ui');

    // Create a single persistent live-mode AdvPlayer (no Auto button, no CoverOpening)
    const player = AdvPlayer.create(true).addTo(app.stage);
    status.textContent = '等待剧集数据…';
    notify('wds-adv-player-ready');

    let loadSeq = 0;
    window.addEventListener('message', async (event) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'wds-load-episode' && data.episode) {
        const seq = ++loadSeq;
        try {
          status.hidden = true;
          player.setMuted(data.muted === true);
          await player.loadLiveEpisode(
            data.episode as IEpisodeModel,
            typeof data.startIndex === 'number' ? data.startIndex : 0,
          );
          if (seq !== loadSeq) return;
          notify('wds-adv-player-loaded');
        } catch (err) {
          if (seq === loadSeq) fail(err);
        }
      } else if (data.type === 'wds-seek' && typeof data.index === 'number') {
        player.seekAndRender(data.index, data.instant !== false);
      } else if (data.type === 'wds-mute') {
        player.setMuted(data.muted === true);
      } else if (data.type === 'wds-play') {
        player.setPlaying(true);
      } else if (data.type === 'wds-pause') {
        player.setPlaying(false);
      } else if (data.type === 'wds-next') {
        player.stepNext();
      } else if (data.type === 'wds-prev') {
        player.stepPrev();
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
