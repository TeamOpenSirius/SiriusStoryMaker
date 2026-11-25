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

    const bgmlist = episodeTrack.EpisodeDetail.some(unit => unit.BgmFileName && unit.BgmFileName !== '999') ? await loadJson<string[]>(resPath.bgmMaster) : [];
    const selist = episodeTrack.EpisodeDetail.some(unit => unit.SeFileName) ? await loadJson<string[]>(resPath.seMaster) : [];

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

    // voice
    if (isVoice) {
        let voicemanifest = await loadJson<string[]>(
            resPath.manifest(episodeTrack.EpisodeId)
        );
        voicemanifest.forEach((VoiceFileName) => {
            resources[`voice_${VoiceFileName}`] = resPath.voice(
                episodeTrack.EpisodeId,
                VoiceFileName
            );
        });
    }

    Assets.addBundle(`${episodeTrack.EpisodeId}_bundle`, resources);
    return Assets.loadBundle(`${episodeTrack.EpisodeId}_bundle`, callback)
}


export default {
    loadJson,
    loadCsv,
    loadResourcesFromEpisode
}
