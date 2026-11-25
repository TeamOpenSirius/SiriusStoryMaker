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

    const needBgmMaster = episodeTrack.EpisodeDetail.some(
        unit => unit.BgmFileName && unit.BgmFileName !== '999' && !unit.BgmFileName.startsWith('asset_')
    );
    const needSeMaster = episodeTrack.EpisodeDetail.some(
        unit => unit.SeFileName && !unit.SeFileName.startsWith('asset_')
    );
    const bgmlist = needBgmMaster ? await loadJson<string[]>(resPath.bgmMaster).catch(() => []) : [];
    const selist = needSeMaster ? await loadJson<string[]>(resPath.seMaster).catch(() => []) : [];

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
                (unit.BgmFileName.startsWith('asset_') || bgmlist.includes(unit.BgmFileName)) &&
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
                (unit.SeFileName.startsWith('asset_') || selist.includes(unit.SeFileName)) &&
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

    // voice: load local asset_ voices directly; only fetch CDN manifest for official non-asset_ voices
    if (isVoice) {
        const localVoices = new Set<string>();
        let hasCdnVoices = false;
        episodeTrack.EpisodeDetail.forEach((unit) => {
            if (!unit.VoiceFileName) return;
            if (unit.VoiceFileName.startsWith('asset_')) {
                localVoices.add(unit.VoiceFileName);
            } else {
                hasCdnVoices = true;
            }
        });
        localVoices.forEach((voiceId) => {
            resources[`voice_${voiceId}`] = resPath.voice(episodeTrack.EpisodeId, voiceId);
        });
        if (hasCdnVoices) {
            const voicemanifest = await loadJson<string[]>(
                resPath.manifest(episodeTrack.EpisodeId)
            ).catch(() => [] as string[]);
            voicemanifest.forEach((VoiceFileName) => {
                resources[`voice_${VoiceFileName}`] = resPath.voice(
                    episodeTrack.EpisodeId,
                    VoiceFileName
                );
            });
        }
    }

    const entries = Object.entries(resources);
    if (entries.length === 0) {
        callback?.(1);
        return {};
    }

    const bundleName = `${episodeTrack.EpisodeId}_bundle`;
    // Load assets resiliently so a single missing/invalid ID doesn't brick live preview
    const loaded: Record<string, unknown> = {};
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
        const subBundle = `${bundleName}_spine_${spineId}`;
        const pair: Record<string, string> = {};
        if (resources[skelKey]) pair[skelKey] = resources[skelKey];
        if (resources[atlasKey]) pair[atlasKey] = resources[atlasKey];
        const count = Object.keys(pair).length;
        Assets.addBundle(subBundle, pair);
        tasks.push(
            Assets.loadBundle(subBundle)
                .then((res) => Object.assign(loaded, res))
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
        Assets.add({ alias: key, src: url });
        tasks.push(
            Assets.load(key)
                .then((res) => {
                    loaded[key] = res;
                })
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
    return loaded;
}


export default {
    loadJson,
    loadCsv,
    loadResourcesFromEpisode
}
