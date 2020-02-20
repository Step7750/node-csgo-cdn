declare module "csgo-cdn" {
  import {EventEmitter} from 'events';

  type StringToStringObject = {
    [key:string]: string
  }

  type DeepStringToStringObject = {
    [key:string]: string | DeepStringToStringObject
  }

  type ItemsEnglishObject = StringToStringObject & {
    "inverted": {
      [key:string]: Array<string>
    }
  }
  
  export enum CsgoCdnLogLevel {
    Error = 'error',
    Warn = 'warn',
    Info = 'info',
    Verbose = 'verbose',
    Debug = 'debug',
    Silly = 'silly'
  }
  
  export enum CsgoCdnSkinPhases {
    Ruby = 'am_ruby_marbleized',
    Sapphire = 'am_sapphire_marbleized',
    Blackpearl = 'am_blackpearl_marbleized',
    Emerald = 'am_emerald_marbleized',
    Phase1 = 'phase1',
    Phase2 = 'phase2',
    Phase3 = 'phase3',
    Phase4 = 'phase4'
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
    public itemsGame: DeepStringToStringObject;
    public csgoEnglish: ItemsEnglishObject;
    public itemsGameCDN: StringToStringObject;

    constructor(steamUser: any, options?: Partial<CsgoCdnOptions>);

    getItemNameURL(marketHashName: string, phase?: CsgoCdnSkinPhases): string | undefined | null;
    getStickerURL(stickerName: string, large?: boolean): string | undefined | null;
    getWeaponURL(defindex: number, paintindex: number): string | undefined | null;

    on( event: 'ready', listener: () => void ): this;
  }
}
