import '@esotericsoftware/spine-pixi';
import '@pixi/sound';
import { Assets, ProgressCallback } from "pixi.js";
import resPath from "./resPath";
import { IEpisodeModel } from "../types/Episode";
import { parse } from 'papaparse'

export async function loadJson<T extends Object>(source : string) : Promise<T>{
    return fetch(source)
        .then(response => {
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            return response.json() as Promise<T>;
        })
}

export async function loadCsv<T>(source : string) : Promise<T[]>{
    return fetch(source)
        .then(response => {
            if(!response.ok){
                throw new Error(response.statusText);
            }
            return response.text();
        })
        .then(async (csvtext)=>{
            return parse(csvtext, {header: true}).data as T[];
        })
}

export async function loadResourcesFromEpisode(
    episodeTrack: IEpisodeModel,
    isVoice?: boolean,
    callback?: ProgressCallback,
) {
    const resources = {} as Record<string, string>;

    episodeTrack.EpisodeDetail.forEach((unit) => {
        //Backgorund
        if (unit.BackgroundImageFileName) {
            if (!resources[`bg_${unit.BackgroundImageFileName}`]) {
                resources[`bg_${unit.BackgroundImageFileName}`] =
                    resPath.background(unit.BackgroundImageFileName);
            }
        }

        //CharacterImages
        if (unit.BackgroundCharacterImageFileName) {
            if (!resources[`card_${unit.BackgroundCharacterImageFileName}`]) {
                resources[`card_${unit.BackgroundCharacterImageFileName}`] =
                    resPath.cards(unit.BackgroundCharacterImageFileName);
            }
        }

        //still
        if (unit.StillPhotoFileName) {
            if (!resources[`still_${unit.StillPhotoFileName}`]) {
                resources[`still_${unit.StillPhotoFileName}`] = resPath.still(
                    unit.StillPhotoFileName
                );
            }
        }

        //movie
        if (unit.MovieFileName) {
            if (!resources[`movie_${unit.MovieFileName}`]) {
                resources[`movie_${unit.MovieFileName}`] = resPath.movie(
                    unit.MovieFileName
                );
            }
        }

        //bgm
        if (unit.BgmFileName) {
            if (
                unit.BgmFileName != "999" &&
                !resources[`bgm_${unit.BgmFileName}`]
            ) {
                resources[`bgm_${unit.BgmFileName}`] = resPath.bgm(
                    unit.BgmFileName
                );
            }
        }

        //Se
        if (unit.SeFileName) {
            if (
                !resources[`se_${unit.SeFileName}`]
            ) {
                resources[`se_${unit.SeFileName}`] = resPath.se(
                    unit.SeFileName
                );
            }
        }

        //spine
        unit.CharacterMotions.forEach((motion) => {
            if (motion.SpineId != 0 && !resources[`spine_${motion.SpineId}`]) {
                resources[`spine_${motion.SpineId}`] = resPath.spine(
                    motion.SpineId
                );
                resources[`spine_atlas_${motion.SpineId}`] = resPath.spine_atlas(
                    motion.SpineId
                );
            }
        });
    });

    // The frames already index their audio. Optional CDN manifests must not gate
    // playback (an unavailable/stale manifest otherwise drops healthy audio URLs).
    if (isVoice) {
        for (const frame of episodeTrack.EpisodeDetail) {
            const voice = frame.VoiceFileName;
            if (voice) resources[`voice_${voice}`] = resPath.voice(episodeTrack.EpisodeId, voice);
        }
    }

    const entries = Object.entries(resources);
    if (entries.length === 0) {
        callback?.(1);
        return { missingAudio: [] as string[] };
    }

    const bundleName = `${episodeTrack.EpisodeId}_bundle`;
    // Load assets resiliently so a single missing/invalid ID doesn't brick live preview
    let completed = 0;
    const total = entries.length;

    // Group spine .skel and .atlas pairs so Pixi loads atlas alongside skel
    const spineIds = new Set<string>();
    for (const [key] of entries) {
        if (key.startsWith('spine_') && !key.startsWith('spine_atlas_')) {
            spineIds.add(key.slice('spine_'.length));
        }
    }

    const tasks: Promise<void>[] = [];
    for (const spineId of spineIds) {
        const skelKey = `spine_${spineId}`;
        const atlasKey = `spine_atlas_${spineId}`;
        // Skip already-cached Spine assets so live frame edits re-render instantaneously
        if (Assets.cache.has(skelKey) && Assets.cache.has(atlasKey)) {
            completed += 2;
            callback?.(Math.min(1, completed / total));
            continue;
        }
        const subBundle = `${bundleName}_spine_${spineId}_${Date.now()}`;
        const pair: Record<string, string> = {};
        if (resources[skelKey]) pair[skelKey] = resources[skelKey];
        if (resources[atlasKey]) pair[atlasKey] = resources[atlasKey];
        const count = Object.keys(pair).length;
        Assets.addBundle(subBundle, pair);
        tasks.push(
            Assets.loadBundle(subBundle)
                .catch((err) => {
                    console.warn(`[AdvPlayer] Failed to load spine ${spineId}:`, err);
                })
                .finally(() => {
                    completed += count;
                    callback?.(Math.min(1, completed / total));
                })
        );
    }

    for (const [key, url] of entries) {
        if (key.startsWith('spine_')) continue;
        if (Assets.cache.has(key)) {
            completed += 1;
            callback?.(Math.min(1, completed / total));
            continue;
        }
        Assets.add({ alias: key, src: url });
        tasks.push(
            Assets.load(key)
                .catch((err) => {
                    console.warn(`[AdvPlayer] Failed to load asset ${key} (${url}):`, err);
                })
                .finally(() => {
                    completed += 1;
                    callback?.(Math.min(1, completed / total));
                })
        );
    }

    await Promise.all(tasks);
    callback?.(1);
    return { missingAudio: entries
        .filter(([key]) => /^(bgm|se|voice)_/.test(key) && !Assets.cache.has(key))
        .map(([key]) => key) };
}


export default {
    loadJson,
    loadCsv,
    loadResourcesFromEpisode
}
