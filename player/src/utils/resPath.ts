import { customAudio, customBackground } from './customAssets';
import { baseAssetsUrl } from "../constant/advConstant"

export const resPath = {
    bgmMaster : `${baseAssetsUrl}/manifest/BGM.json`,
    seMaster : `${baseAssetsUrl}/manifest/SE.json`,
    advJson : (epId : number | string) => `${baseAssetsUrl}/episode/${epId}.json`,
    spine : (spineId : number) => `${baseAssetsUrl}/spine/${spineId}.skel`,
    spine_atlas : (spineId : number) => `${baseAssetsUrl}/spine/${spineId}.atlas`,
    background : (name : string) => customBackground(name) || `${baseAssetsUrl}/background/${encodeURIComponent(name)}.png`,
    cards : (charId : string) => `${baseAssetsUrl}/card/${charId}.png`,
    still : (label : string) => `${baseAssetsUrl}/still/${label}.png`,
    movie : (name : string) => `${baseAssetsUrl}/movie/${name}.mp4`,
    manifest : (EpisodeMasterId: number) => `${baseAssetsUrl}/voice/${EpisodeMasterId}/manifest.json`,
    voice : (EpisodeMasterId: number, voiceId : string) => customAudio('voice', voiceId) || `${baseAssetsUrl}/voice/${EpisodeMasterId}/${voiceId}.mp3`,
    bgm : (bgmId : string) => customAudio('bgm', bgmId) || `${baseAssetsUrl}/bgm/${bgmId}.mp3`,
    se : (seId : string) => customAudio('se', seId) || `${baseAssetsUrl}/se/${seId}.mp3`,
}

export default resPath
