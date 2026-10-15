import { VideoItem } from '../types';
import thumbScifi from '../assets/images/thumb_scifi_short_1791766779987.jpg';
import thumbNature from '../assets/images/thumb_nature_4k_1791766799584.jpg';
import thumbCosmos from '../assets/images/thumb_cosmos_hls_1791766811563.jpg';
import thumbUrban from '../assets/images/thumb_urban_timelapse_1791766823194.jpg';

export const PRESET_VIDEOS: VideoItem[] = [
  {
    id: 'preset-sintel-open',
    title: 'Sintel — Chronicle of the Dragon Scales',
    subtitle: 'W3C & Blender Foundation · Fast 720p Direct MP4 Master',
    url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
    thumbnail: thumbScifi,
    format: 'MP4',
    resolution: '854x480 (HD Ready)',
    durationLabel: '00:52',
    sizeLabel: '4.17 MB',
    license: 'CC-BY 3.0 Open License',
    isAuthorized: true,
  },
  {
    id: 'preset-hls-cosmos-bipbop',
    title: 'Orbital Telemetry & Big Buck Bunny — Multi-Bitrate HLS',
    subtitle: 'Mux Adaptive M3U8 Stream · Auto / 1080p / 720p / 480p',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    thumbnail: thumbCosmos,
    format: 'HLS',
    resolution: 'Adaptive M3U8',
    durationLabel: '10:34',
    sizeLabel: 'HLS Stream',
    license: 'CC-BY 3.0 Open Stream',
    isAuthorized: true,
  },
  {
    id: 'preset-flower-macro',
    title: 'Botanical Bloom — Ultra High Speed MP4',
    subtitle: 'Mozilla Developer Network Open Stream · 100% CORS & Instant Play',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    thumbnail: thumbNature,
    format: 'MP4',
    resolution: '640x360',
    durationLabel: '00:05',
    sizeLabel: '1.12 MB',
    license: 'CC0 Public Domain Sample',
    isAuthorized: true,
  },
  {
    id: 'preset-bunny-webm',
    title: 'Big Buck Bunny Open Studio — WebM / VP9',
    subtitle: 'Wikimedia Commons Master · WebM HTML5 Stream',
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c0/Big_Buck_Bunny_4K.webm/Big_Buck_Bunny_4K.webm.480p.vp9.webm',
    thumbnail: thumbUrban,
    format: 'WEBM',
    resolution: '854x480',
    durationLabel: '10:34',
    sizeLabel: '32.4 MB',
    license: 'CC-BY 3.0 Open License',
    isAuthorized: true,
  },
];
