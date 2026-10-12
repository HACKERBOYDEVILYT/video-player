import { VideoItem } from '../types';
import thumbScifi from '../assets/images/thumb_scifi_short_1791766779987.jpg';
import thumbNature from '../assets/images/thumb_nature_4k_1791766799584.jpg';
import thumbCosmos from '../assets/images/thumb_cosmos_hls_1791766811563.jpg';
import thumbUrban from '../assets/images/thumb_urban_timelapse_1791766823194.jpg';

export const PRESET_VIDEOS: VideoItem[] = [
  {
    id: 'preset-tears-of-steel',
    title: 'Tears of Steel — Sci-Fi Open Movie Master',
    subtitle: 'Blender Foundation Amsterdam · 1080p Direct Stream',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    thumbnail: thumbScifi,
    format: 'MP4',
    resolution: '1920x800',
    durationLabel: '12:14',
    sizeLabel: '176.8 MB',
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
    id: 'preset-iceland-nature',
    title: 'For Bigger Blazes — Nordic Glacial & Volcanic Aerials',
    subtitle: 'Direct High-Speed MP4 · Instant Download Test',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnail: thumbNature,
    format: 'MP4',
    resolution: '1280x720',
    durationLabel: '00:15',
    sizeLabel: '2.38 MB',
    license: 'Public Domain Sample',
    isAuthorized: true,
  },
  {
    id: 'preset-sintel-open',
    title: 'Sintel — Chronicle of the Dragon Scales',
    subtitle: 'W3C / Blender Open Movie · Fast Direct MP4 & WebM Compatible',
    url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
    thumbnail: thumbUrban,
    format: 'MP4',
    resolution: '854x480',
    durationLabel: '00:52',
    sizeLabel: '4.17 MB',
    license: 'CC-BY 3.0 Open License',
    isAuthorized: true,
  },
];
