declare module "csgo-cdn" {
  import {EventEmitter} from 'events';

  export enum CsgoCdnLogLevel {
    Error = 'error',
    Warn = 'warn',
    Info = 'info',
    Verbose = 'verbose',
    Debug = 'debug',
    Silly = 'silly'
  }

  export interface CsgoCdnOptions {
    directory: string, // relative data directory for VPK files
    updateInterval: number, // seconds between update checks, -1 to disable auto-updates
    logLevel: CsgoCdnLogLevel, // logging level, (error, warn, info, verbose, debug, silly)
    stickers: boolean, // whether to obtain the vpk for stickers
    graffiti: boolean, // whether to obtain the vpk for graffiti
    musicKits: boolean, // whether to obtain the vpk for music kits
    cases: boolean, // whether to obtain the vpk for cases
    tools: boolean, // whether to obtain the vpk for tools
    statusIcons: boolean, // whether to obtain the vpk for status icons
  }

  export default class CsgoCdn extends EventEmitter {
    public itemsGame: any[];
    public csgoEnglish: any[];
    public itemsGameCDN: any[];

    constructor(steamUser: any, options: CsgoCdnOptions);

    getItemNameURL(marketHashName: string, phase: any): string;
    getStickerURL(stickerName: string, large?: boolean): string;
    getWeaponURL(defindex: number, paintindex: number): string;

    on( event: 'ready', listener: () => void ): this;
  }
}
