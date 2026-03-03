import { execSync } from 'child_process';

export interface FfmpegStatus {
  isAvailable: boolean;
  path: string;
  version: string;
}

export function checkFfmpegAvailability(): FfmpegStatus {
  try {
    const versionOutput = execSync('ffmpeg -version', { encoding: 'utf-8', timeout: 5000 });
    const versionMatch = versionOutput.match(/ffmpeg version (\S+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    let ffmpegPath = 'ffmpeg';
    try {
      const whereOutput = execSync('where ffmpeg', { encoding: 'utf-8', timeout: 5000 }).trim();
      ffmpegPath = whereOutput.split('\n')[0].trim();
    } catch {
      // 'where' failed but ffmpeg -version worked, so it's in PATH
    }

    console.log(`[FFmpeg] Found: ${ffmpegPath} (version ${version})`);
    return { isAvailable: true, path: ffmpegPath, version };
  } catch (error) {
    console.error('[FFmpeg] Not found in PATH. Video streaming will not work.');
    console.error('[FFmpeg] Install FFmpeg and ensure it is in your system PATH.');
    console.error('[FFmpeg] Download: https://ffmpeg.org/download.html');
    return { isAvailable: false, path: '', version: '' };
  }
}
