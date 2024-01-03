import EventEmitter from 'events';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import vpk from 'vpk';
import vdf from 'simple-vdf';
import { hashSync } from 'hasha';
import winston from 'winston';
import { exec } from 'child_process';
import { HttpClient } from '@doctormckay/stdlib/http.js'
import AdmZip from 'adm-zip';
import os from 'node:os';

const defaultConfig = {
    directory: 'data',
    updateInterval: 30000,
    stickers: true,
    patches: true,
    graffiti: true,
    characters: true,
    musicKits: true,
    cases: true,
    tools: true,
    statusIcons: true,
    logLevel: 'info',
    vrfBinary: 'Decompiler',
    depotDownloader: 'DepotDownloader',
    fileList: 'filelist.txt'
};

const APP_ID = 730;
const DEPOT_ID = 2347770;

const wears = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

const ECON_PATH = 'panorama/images/econ';

const neededDirectories = {
    stickers: `${ECON_PATH}/stickers`,
    patches: `${ECON_PATH}/patches`,
    graffiti: `${ECON_PATH}/stickers/default`,
    characters: `${ECON_PATH}/characters`,
    musicKits: `${ECON_PATH}/music_kits`,
    cases: `${ECON_PATH}/weapon_cases`,
    tools: `${ECON_PATH}/tools`,
    statusIcons: `${ECON_PATH}/status_icons`,
};

const neededFiles = {
    itemsGame: 'scripts/items/items_game.txt',
    itemsGameCdn: 'scripts/items/items_game_cdn.txt',
    csgoEnglish: 'resource/csgo_english.txt'
};

class CSGOCdn extends EventEmitter {
    get ready() {
        return this.ready_ || false;
    }

    get steamReady() {
        return !!this.user.steamID;
    }

    get phase() {
        return {
            ruby: 'am_ruby_marbleized',
            sapphire: 'am_sapphire_marbleized',
            blackpearl: 'am_blackpearl_marbleized',
            emerald: 'am_emerald_marbleized',
            phase1: 'phase1',
            phase2: 'phase2',
            phase3: 'phase3',
            phase4: 'phase4'
        }
    }

    set ready(r) {
        const old = this.ready;
        this.ready_ = r;

        if (r !== old && r) {
            this.log.debug('Ready');
            this.emit('ready');
        }
    }

    constructor(steamUser, config={}) {
        super();

        this.config = Object.assign(defaultConfig, config);

        this.createDataDirectory();

        this.user = steamUser;

        this.client = new HttpClient({
            defaultHeaders: {'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'},
        });

        this.log = winston.createLogger({
            level: config.logLevel,
            transports: [
                new winston.transports.Console({
                    colorize: true,
                    format: winston.format.printf((info) => {
                        return `[csgo-image-cdn] ${info.level}: ${info.message}`;
                    })
                })
            ]
        });

        if (!this.steamReady) {
            this.log.debug('Steam not ready, waiting for logon');

            this.user.once('loggedOn', () => {
                this.updateLoop();
            });
        }
        else {
            this.updateLoop();
        }
    }

    /**
     * Creates the data directory specified in the config if it doesn't exist
     */
    createDataDirectory() {
        const dir = `./${this.config.directory}`;

        if (!existsSync(dir)){
            mkdirSync(dir);
        }
    }

    /**
     * Runs the update loop at the specified config interval
     * @return {Promise<undefined>|void}
     */
    updateLoop() {
        if (this.config.updateInterval > 0) {
            this.log.info(`Auto-updates enabled, checking for updates every ${this.config.updateInterval} seconds`);
            this.update().then(() => {
                setTimeout(() => {
                    this.updateLoop();
                }, this.config.updateInterval*1000);
            })
        }
        else {
            this.log.info('Auto-updates disabled, checking if required files exist');

            // Try to load the resources locally
            try {
                this.loadResources();
                this.loadVPK();
                this.ready = true;
            } catch(e) {
                this.log.warn('Needed CS:GO files not installed');
                this.update();
            }
        }
    }

    /**
     * Returns the product info for CSGO, with its depots and packages
     */
    getProductInfo() {
        this.log.debug('Obtaining CS:GO product info');
        return new Promise((resolve, reject) => {
            this.user.getProductInfo([APP_ID], [], true, (apps, packages, unknownApps, unknownPackages) => {
                resolve([apps, packages, unknownApps, unknownPackages]);
            });
        });
    }

    /**
     * Returns the latest CSGO manifest ID for the public DEPOT_ID depot
     * @return {*|PromiseLike<*[]>|Promise<*[]>} DEPOT_ID Depot Manifest ID
     */
    getLatestManifestId() {
        this.log.debug('Obtaining latest manifest ID');
        return this.getProductInfo().then(([apps, packages, unknownApps, unknownPackages]) => {
            const csgo = packages[APP_ID].appinfo;
            const commonDepot = csgo.depots[DEPOT_ID];

            return commonDepot.manifests.public;
        });
    }

    /**
     * Retrieves and updates the sticker file directory from Valve
     *
     * Ensures that only the required VPK files are downloaded and that files with the same SHA1 aren't
     * redownloaded
     *
     * @return {Promise<void>}
     */
    async update() {
        this.log.info('Checking for CS:GO file updates');

        if (!this.steamReady) {
            this.log.warn(`Steam not ready, can't check for updates`);
            return;
        }

        if (!existsSync(`${this.config.directory}/${this.config.vrfBinary}`)) {
            this.log.error(`VRF binary not found at ${this.config.vrfBinary}, downloading...`);
            await this.downloadVRF();
        }

        if (!existsSync(`${this.config.directory}/${this.config.depotDownloader}`)) {
            this.log.error(`DepotDownloader binary not found at ${this.config.depotDownloader}, downloading...`);
            await this.downloadDepotDownloader();
        }

        writeFileSync(`${this.config.directory}/${this.config.fileList}`, 'game\\csgo\\pak01_dir.vpk');

        this.log.debug('Downloading require static files');

        await this.downloadFiles();

        unlinkSync(`${this.config.directory}/${this.config.fileList}`);

        this.log.debug('Loading static file resources');

        this.loadVPK();

        await this.downloadVPKFiles();

        this.loadResources();

        const pathsToDump = Object.keys(neededDirectories).filter((f) => this.config[f] === true ).map((f) => neededDirectories[f]).concat(Object.keys(neededFiles).map((f) => neededFiles[f]));

        // In CS:GO it was possible to just extract the image from the VPK, in CS2 this is not the case anymore
        // to work around this, we will still download all the required VPK's but then using https://github.com/ValveResourceFormat/ValveResourceFormat
        // we will extract the images from the VPK's directly and save them locally.
        // With that we can then use the images to generate the file path.
        await Promise.all(
            pathsToDump.map((path) => new Promise((resolve, reject) => {
                this.log.debug(`Dumping ${path}...`);
                exec(`${this.config.directory}/${this.config.vrfBinary} --input data/game/csgo/pak01_dir.vpk --vpk_filepath ${path} -o data -d > /dev/null`, (error) => {
                    if (error) {
                        console.error(`exec error: ${error}`);
                    }

                    resolve();
                });
            })
        ));

        this.log.info('Finished updating CS:GO files');
        this.ready = true;
    }

    /**
     * Returns a platform-architecture string
     *
     * Duplicate values with be an array
     *
     * @param dict Dictionary to invert
     */
    getPlatform() {
        const platform = os.platform();
        const architecture = os.arch();

        let osName = '';
        let archName = '';

        switch (platform) {
            case 'win32':
                osName = 'windows';
                break;
            case 'darwin':
                osName = 'macos';
                break;
            case 'linux':
                osName = 'linux';
                break;
            default:
                osName = 'unknown';
        }

        switch (architecture) {
            case 'x64':
                archName = 'x64';
                break;
            case 'arm64':
                archName = 'arm64';
                break;
            case 'arm':
                archName = 'arm';
                break;
            default:
                archName = 'unknown';
        }

        return `${osName}-${archName}`
    }

    /**
     * By using the Github API request the latest tag from the given repository
     *
     * @param repository Repository to get the latest tag from
     *
     * @return {Promise<string>} Latest tag name
     */
    async getLatestGitTag(repository) {
        let latestTag = await this.client.request({
            method: 'GET',
            url: `https://api.github.com/repos/${repository}/releases/latest`
        });

        if(latestTag.statusCode !== 200) {
            throw new Error(`Failed to get latest release ${latestTag.statusCode}`);
        }

        return latestTag.jsonBody.tag_name
    }

    /**
     * This function will download the latest binary from the given repository
     *
     * And extract the binary from the zip file and save it in the data directory
     *
     * @param repository Repository to get the latest binary from
     *
     * @param binaryName Name of the binary to download
     */
    async getBinary(repository, binaryName) {
        const latestTag = await this.getLatestGitTag(repository);
        const platform = this.getPlatform();

        let binary = await this.client.request({
            method: 'GET',
            followRedirects: true,
            url: `https://github.com/${repository}/releases/download/${latestTag}/${binaryName}-${platform}.zip`
        });

        if(binary.statusCode !== 200 && binary.statusCode !== 302) {
            throw new Error(`Failed to get latest release ${binary.statusCode}`);
        }

        writeFileSync(`./data/${binaryName}.zip`, binary.rawBody);
        const zip = new AdmZip(`./data/${binaryName}.zip`);
        zip.extractAllTo('./data', true);

        unlinkSync(`./data/${binaryName}.zip`);

        if (platform !== 'win32') {
            chmodSync(`./data/${binaryName}`, '755');
        }
    }

    /**
     * Downloads the latest version of https://github.com/SteamRE/DepotDownloader
     */
    async downloadDepotDownloader() {
        await this.getBinary('SteamRE/DepotDownloader', 'DepotDownloader');
    }

    /**
     * Downloads the latest version of https://github.com/ValveResourceFormat/ValveResourceFormat
    */
    async downloadVRF() {
        await this.getBinary('ValveResourceFormat/ValveResourceFormat', 'Decompiler');
    }

    /**
     * Parses the items_game.txt, items_game_cdn.txt file and the csgo_english.txt file
     *
     * will also invert the csgo_english.txt file to make it easier to search for the correct item
     *
     */
    loadResources() {
        this.itemsGame = vdf.parse(this.vpkDir.getFile('scripts/items/items_game.txt').toString())['items_game'];
        this.itemsGameCDN = this.parseItemsCDN(this.vpkDir.getFile('scripts/items/items_game_cdn.txt').toString());
        this.csgoEnglish = vdf.parse(this.vpkDir.getFile('resource/csgo_english.txt').toString())['lang']['Tokens'];

        this.weaponNameMap = Object.keys(this.csgoEnglish).filter(n => n.startsWith("SFUI_WPNHUD"));
        this.csgoEnglishKeys = Object.keys(this.csgoEnglish);

        // Ensure paint kit descriptions are lowercase to resolve inconsistencies in the language and items_game file
        Object.keys(this.itemsGame.paint_kits).forEach((n) => {
            const kit = this.itemsGame.paint_kits[n];

            if ('description_tag' in kit) {
                kit.description_tag = kit.description_tag.toLowerCase();
            }
        });

        this.invertDictionary(this.csgoEnglish);
    }

    /**
     * Inverts the key mapping of a dictionary recursively while preserving the original keys
     *
     * Duplicate values with be an array
     *
     * @param dict Dictionary to invert
     */
    invertDictionary(dict) {
        dict['inverted'] = {};

        for (const prop in dict) {
            if (prop === 'inverted' || !dict.hasOwnProperty(prop)) continue;

            const val = dict[prop];

            if (typeof val === 'object' && !(val instanceof Array)) {
                this.invertDictionary(val);
            }
            else {
                if (dict['inverted'][val] === undefined) {
                    dict['inverted'][val] = [prop];
                }
                else {
                    dict['inverted'][val].push(prop);
                }
            }
        }
    }

    parseItemsCDN(data) {
        let lines = data.split('\n');

        const items_game_cdn = {};

        for (let line of lines) {
            let kv = line.split('=');

            if (kv[1]) {
                items_game_cdn[kv[0]] = kv[1];
            }
        }

        return items_game_cdn;
    }

    /**
     * Loads the CSGO dir VPK specified in the config
     */
    loadVPK() {
        this.vpkDir = new vpk(`${this.config.directory}/game/csgo/pak01_dir.vpk`);
        this.vpkDir.load();

        this.vpkStickerFiles = this.vpkDir.files.filter((f) => f.startsWith(neededDirectories.stickers));
        this.vpkPatchFiles = this.vpkDir.files.filter((f) => f.startsWith(neededDirectories.patches));
        this.vpkStatusIconFiles = this.vpkDir.files.filter((f) => f.startsWith(neededDirectories.statusIcons));
    }

    /**
     * Given the CSGO VPK Directory, returns the necessary indices for the chosen options
     * @return {Array} Necessary Sticker VPK Indices
     */
    getRequiredVPKFiles() {
        const requiredIndices = [];

        const dirs = Object.keys(neededDirectories).filter((f) => !!this.config[f]).map((f) => neededDirectories[f]);
        const files = Object.keys(neededFiles).map((f) => neededFiles[f]);

        for (const fileName of this.vpkDir.files) {
            if (dirs.some((dir) => fileName.startsWith(dir)) || files.some((file) => fileName === file))  {
                const archiveIndex = this.vpkDir.tree[fileName].archiveIndex;
                if (!requiredIndices.includes(archiveIndex)) {
                    requiredIndices.push(archiveIndex);
                }
            }
        }

        return requiredIndices.sort();
    }

    /**
     * Downloads the required VPK files
     * @return {Promise<void>}
     */
    async downloadVPKFiles() {
        this.log.debug('Computing required VPK files for selected packages');

        const requiredIndices = this.getRequiredVPKFiles();

        this.log.debug(`Downloading Required VPK files ${requiredIndices}`);

        const filesToDownload = [];

        for (let index in requiredIndices) {
            index = parseInt(index);

            // pad to 3 zeroes
            const archiveIndex = requiredIndices[index];
            const paddedIndex = '0'.repeat(3-archiveIndex.toString().length) + archiveIndex;
            const fileName = `pak01_${paddedIndex}.vpk`;
            const filePath = `${this.config.directory}/${fileName}`;

            filesToDownload.push({ fileName: `game\\csgo\\${fileName}`, filePath });
        }

        writeFileSync(`${this.config.directory}/${this.config.fileList}`, filesToDownload.map((f) => f.fileName).join('\n'));

        await this.downloadFiles();

        unlinkSync(`${this.config.directory}/${this.config.fileList}`);
    }


    /**
     * Download the files from the filelist.txt via depotdownloader
     * @return {Promise<void>}
     */
    async downloadFiles() {
        return new Promise((resolve, reject) => {
            exec(`./${this.config.directory}/${this.config.depotDownloader} -app ${APP_ID} -depot ${DEPOT_ID} -filelist ${this.config.directory}/${this.config.fileList} -dir ${this.config.directory} -os windows -osarch 64 max-downloads 16 -max-servers 40 -validate`, (error, stdout) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    reject();
                }

                resolve();
            });
        })
    }

    /**
     * Returns all items found in the items_game.txt file
     * @return {array} All CS:GO Items
     */
    getItems() {
        if(!this.ready) {
            return [];
        }

        return this.itemsGame?.items;
    }

    /**
     * Given a VPK path, returns the CDN URL
     * @param path VPK path
     * @param type Whether to load via VPK or via local file
     * @return {string|void} CDN URL
     */
    getPathURL(path, type='vpk') {
        let file;
        if(type === 'vpk') {
            this.log.debug(`Reading vpk ${path}...`);
            file = this.vpkDir.getFile(path);
        } else if(type === 'local') {
            path = path.replace('.vtex_c', '.png');
            if(!path.endsWith('.png')) {
                path = `${path}.png`
            }
            this.log.debug(`Reading local file ${this.config.directory + '/' + path}...`);
            // check if file exists
            if (!existsSync(`./${this.config.directory}/${path}`)) {
                this.log.error(`Failed to retrieve ${path} in VPK, do you have the package category enabled in options?`);
                return;
            }
            file = readFileSync(`./${this.config.directory}/${path}`)
        }

        if (!file) {
            this.log.error(`Failed to retrieve ${path} in VPK, do you have the package category enabled in options?`);
            return;
        }

        const sha1 = hashSync(file, {
            'algorithm': 'sha1'
        });

        path = path.replace('panorama/images', 'icons');
        path = path.replace('.png', `.${sha1}.png`);
        path = path.replace('_png', '');

        return `https://steamcdn-a.akamaihd.net/apps/730/${path}`;
    }

    /**
     * Returns the item Steam CDN URL for the specified name
     *
     * Example Sticker Names: cologne2016/nv, cologne2016/fntc_holo, cologne2016/fntc_foil, cluj2015/sig_olofmeister_gold
     *
     * You can find the sticker names from their relevant "sticker_material" fields in items_game.txt
     *      items_game.txt can be found in the core game files of CS:GO or as itemsGame here
     *
     * @param name The item name (the sticker_material field in items_game.txt, or the cdn file format)
     * @param large Whether to obtain the "large" CDN version of the item
     * @return {string|void} If successful, the HTTPS CDN URL for the item
     */
    getStickerURL(name, large=true) {
        if (!this.ready) {
            return;
        }

        const fileName = large ? `${name}_large_png` : `${name}_png`;
        const path = this.vpkStickerFiles.find((t) => t.endsWith(`${fileName}.vtex_c`));

        if (path) return this.getPathURL(path, 'local');
    }

    /**
     * Returns the item Steam CDN URL for the specified name
     *
     * Example Patch Names: case01/patch_phoenix, case01/patch_dangerzone, case01/patch_easypeasy, case_skillgroups/patch_goldnova1
     *
     * You can find the patch names from their relevant "patch_material" fields in items_game.txt
     *      items_game.txt can be found in the core game files of CS:GO or as itemsGame here
     *
     * @param name The item name (the patch_material field in items_game.txt, or the cdn file format)
     * @param large Whether to obtain the "large" CDN version of the item
     * @return {string|void} If successful, the HTTPS CDN URL for the item
     */
    getPatchURL(name, large=true) {
        if (!this.ready) {
            return;
        }

        const fileName = large ? `${name}_large_png` : `${name}_png`;
        const path = this.vpkPatchFiles.find((t) => t.endsWith(`${fileName}.vtex_c`));

        if (path) return this.getPathURL(path, 'local');
    }

    /**
     * Returns the item Steam CDN URL for the specified name
     *
     * Example Patch Names: blast_pickem_2023_crystal, 5yearcoin, service_medal_2016_lvl2
     *
     * You can find the status icon names from their relevant "image_inventory" fields in items_game.txt
     *      items_game.txt can be found in the core game files of CS:GO or as itemsGame here
     *
     * @param name The item name (the image_inventory field in items_game.txt)
     * @param large Whether to obtain the "large" CDN version of the item
     * @return {string|void} If successful, the HTTPS CDN URL for the item
     */
    getStatusIconURL(name, large=true) {
        if (!this.ready) {
            return;
        }

        const fileName = large ? `${name}_large_png` : `${name}_png`;
        const path = this.vpkStatusIconFiles.find((t) => t.endsWith(`${fileName}.vtex_c`));

        if (path) return this.getPathURL(path, 'local');
    }

    /**
     * Given the specified defindex and paintindex, returns the CDN URL
     *
     * The item properties can be found in items_game.txt
     *
     * @param defindex Item Definition Index (weapon type)
     * @param paintindex Item Paint Index (skin type)
     * @return {string|void} Weapon CDN URL
     */
    getWeaponURL(defindex, paintindex) {
        if (!this.ready) return;

        const paintKits = this.itemsGame.paint_kits;

        // Get the skin name
        let skinName = '';

        if (paintindex in paintKits) {
            skinName = paintKits[paintindex].name;

            if (skinName === 'default') {
                skinName = '';
            }
        }

        // Get the weapon name
        let weaponName;

        const items = this.itemsGame.items;

        if (defindex in items) {
            weaponName = items[defindex].name;
        }

        // Get the image url
        const cdnName = `${weaponName}_${skinName}`;

        return this.itemsGameCDN[cdnName];
    }

    /**
     * Returns whether the given name is a weapon by checking
     * the prefab and whether it is used by one of the sides
     * @param marketHashName Item name
     * @return {boolean} Whether a weapon
     */
    isWeapon(marketHashName) {
        const prefabs = this.itemsGame.prefabs;
        const items = this.itemsGame.items;
        const weaponName = marketHashName.split('|')[0].trim();

        const weaponTags = this.csgoEnglish['inverted'][weaponName];

        if (!weaponTags) return false;

        // For every matching weapon tag...
        for (const t of weaponTags) {
            const weaponTag = `#${t}`;

            const prefab = Object.keys(prefabs).find((n) => {
                const fab = prefabs[n];

                return fab.item_name === weaponTag;
            });

            let fab;

            if (!prefab) {
                // special knives aren't in the prefab (karambits, etc...)
                const item = Object.keys(items).find((n) => {
                    const i = items[n];

                    return i.item_name === weaponTag;
                });

                fab = items[item];
            }
            else {
                fab = prefabs[prefab];
            }

            if (fab && fab.used_by_classes) {
                const used = fab.used_by_classes;

                // Ensure that the item is used by one of the sides
                if (used['terrorists'] || used['counter-terrorists']) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Returns the sticker URL given the market hash name
     * @param marketHashName Sticker name
     * @return {string|void} Sticker image URL
     */
    getStickerNameURL(marketHashName) {
        const reg = /Sticker \| (.*)/;
        const match = marketHashName.match(reg);

        if (!match) return;

        const stickerName = match[1];

        for (const tag of this.csgoEnglish['inverted'][stickerName] || []) {
            const stickerTag = `#${tag}`;

            const stickerKits = this.itemsGame.sticker_kits;

            const kitIndex = Object.keys(stickerKits).find((n) => {
                const k = stickerKits[n];

                return k.item_name === stickerTag;
            });

            const kit  = stickerKits[kitIndex];

            if (!kit || !kit.sticker_material) continue;

            const url = this.getStickerURL(stickerKits[kitIndex].sticker_material, true);

            if (url) {
                return url;
            }
        }
    }

    /**
     * Returns the patch URL given the market hash name
     * @param marketHashName Patch name
     * @return {string|void} Patch image URL
     */
    getPatchNameURL(marketHashName) {
        const reg = /Patch \| (.*)/;
        const match = marketHashName.match(reg);

        if (!match) return;

        const stickerName = match[1];

        for (const tag of this.csgoEnglish['inverted'][stickerName] || []) {
            const stickerTag = `#${tag}`;

            const stickerKits = this.itemsGame.sticker_kits; // Patches are in the sticker_kits as well

            const kitIndex = Object.keys(stickerKits).find((n) => {
                const k = stickerKits[n];

                return k.item_name === stickerTag;
            });

            const kit  = stickerKits[kitIndex];

            if (!kit || !kit.patch_material) continue;

            const url = this.getPatchURL(stickerKits[kitIndex].patch_material, true);

            if (url) return url;
        }
    }

    /**
     * Returns the graffiti URL given the market hash name
     * @param marketHashName Graffiti name (optional tint)
     * @param large Whether to obtain the "large" CDN version of the item
     * @return {string|void} CDN Image URL
     */
    getGraffitiNameURL(marketHashName, large=true) {
        const reg = /Sealed Graffiti \| ([^(]*)/;
        const match = marketHashName.match(reg);

        if (!match) return;

        const graffitiName = match[1].trim();

        for (const tag of this.csgoEnglish['inverted'][graffitiName] || []) {
            const stickerTag = `#${tag}`;

            const stickerKits = this.itemsGame.sticker_kits;

            const kitIndices = Object.keys(stickerKits).filter((n) => {
                const k = stickerKits[n];

                return k.item_name === stickerTag;
            });

            // prefer kit indices with "graffiti" in the name
            kitIndices.sort((a, b) => {
                const index1 = !!stickerKits[a].name && stickerKits[a].name.indexOf('graffiti');
                const index2 = !!stickerKits[b].name && stickerKits[b].name.indexOf('graffiti');
                if (index1 === index2) {
                    return 0
                } else if (index1 > -1) {
                    return -1
                } else {
                    return 1
                }
            });

            for (const kitIndex of kitIndices) {
                const kit = stickerKits[kitIndex];

                if (!kit || !kit.sticker_material) continue;

                const url = this.getStickerURL(kit.sticker_material, true);

                if (url) {
                    return url;
                }
            }
        }
    }

    /**
     * Returns the weapon URL given the market hash name
     * @param marketHashName Weapon name
     * @param {string?} phase Optional Doppler Phase from the phase enum
     * @return {string|void} Weapon image URL
     */
    getWeaponNameURL(marketHashName, phase) {
        const hasWear = wears.findIndex((n) => marketHashName.includes(n)) > -1;

        if (hasWear) {
            // remove it
            marketHashName = marketHashName.replace(/\([^)]*\)$/, '');
        }

        const match = marketHashName.split('|').map((m) => m.trim());

        const weaponName = match[0];
        const skinName = match[1];

        if (!weaponName) return;

        const weaponTags = this.csgoEnglish['inverted'][weaponName] || [];
        const prefabs = this.itemsGame.prefabs;
        const items = this.itemsGame.items;

        // For every matching weapon tag...
        for (const t of weaponTags) {
            const weaponTag = `#${t}`;

            const prefab = Object.keys(prefabs).find((n) => {
                const fab = prefabs[n];

                return fab.item_name === weaponTag;
            });

            let weaponClass;

            if (!prefab) {
                // special knives aren't in the prefab (karambits, etc...)
                const item = Object.keys(items).find((n) => {
                    const i = items[n];

                    return i.item_name === weaponTag;
                });

                if (items[item]) {
                    weaponClass = items[item].name;
                }
            }
            else {
                const item = Object.keys(items).find((n) => {
                    const i = items[n];

                    return i.prefab === prefab;
                });

                if (items[item]) {
                    weaponClass = items[item].name;
                }
            }

            if (!weaponClass) continue;

            // Check if this is a vanilla weapon
            if (!skinName) {
                if (weaponClass && this.itemsGameCDN[weaponClass]) {
                    return this.itemsGameCDN[weaponClass];
                }
                else {
                    continue;
                }
            }

            // For every matching skin name...
            for (const key of this.csgoEnglish['inverted'][skinName] || []) {
                const skinTag = `#${key.toLowerCase()}`;

                const paintKits = this.itemsGame.paint_kits;

                const paintindexes = Object.keys(paintKits).filter((n) => {
                    const kit = paintKits[n];
                    const isPhase = !phase || kit.name.endsWith(phase);

                    return isPhase && kit.description_tag === skinTag;
                });

                // For every matching paint index...
                for (const paintindex of paintindexes) {
                    const paintKit = paintKits[paintindex].name;

                    const path = (paintKit ? `${weaponClass}_${paintKit}` : weaponClass).toLowerCase();

                    if (this.itemsGameCDN[path]) {
                        return this.itemsGameCDN[path];
                    }
                }
            }
        }
    }

    /**
     * Returns the music kit URL given the market hash name
     * @param marketHashName Music kit name
     * @return {string|void} Music kit image URL
     */
    getMusicKitNameURL(marketHashName) {
        const reg = /Music Kit \| (.*)/;
        const match = marketHashName.match(reg);

        if (!match) return;

        const kitName = match[1];

        for (const t of this.csgoEnglish['inverted'][kitName] || []) {
            const tag = `#${t}`;

            const musicDefs = this.itemsGame.music_definitions;

            const kitIndex = Object.keys(musicDefs).find((n) => {
                const k = musicDefs[n];

                return k.loc_name === tag;
            });

            const kit = musicDefs[kitIndex];

            if (!kit || !kit.image_inventory) continue;

            const path = `panorama/images/${kit.image_inventory}_png`;

            const url = this.getPathURL(path, 'local');

            if (url) {
                return url;
            }
        }
    }

    /**
     * Retrieves the given item CDN URL given its market_hash_name
     *
     * Examples: M4A4 | 龍王 (Dragon King) (Field-Tested), Sticker | Robo, AWP | Redline (Field-Tested)
     *
     * Note: For a weapon, the name MUST have the associated wear
     *
     * @param marketHashName Item name
     * @param {string?} phase Optional Doppler Phase from the phase enum
     */
    getItemNameURL(marketHashName, phase) {
        marketHashName = marketHashName.trim();
        let strippedMarketHashName = marketHashName;

        // Weapons and Music Kits can have extra tags we need to ignore
        const extraTags = ['★ ', 'StatTrak™ ', 'Souvenir '];

        for (const tag of extraTags) {
            if (strippedMarketHashName.startsWith(tag)) {
                strippedMarketHashName = strippedMarketHashName.replace(tag, '');
            }
        }

        if (this.isWeapon(strippedMarketHashName)) {
            return this.getWeaponNameURL(strippedMarketHashName, phase);
        }
        else if (strippedMarketHashName.startsWith('Music Kit |')) {
            return this.getMusicKitNameURL(strippedMarketHashName);
        }
        else if (marketHashName.startsWith('Sticker |')) {
            return this.getStickerNameURL(marketHashName);
        }
        else if (marketHashName.startsWith('Sealed Graffiti |')) {
            return this.getGraffitiNameURL(marketHashName);
        }
        else if (marketHashName.startsWith('Patch |')) {
            return this.getPatchNameURL(marketHashName);
        }
        else {
            // Other in items
            for (const t of this.csgoEnglish['inverted'][marketHashName] || []) {
                const tag = `#${t.toLowerCase()}`;
                const items = this.itemsGame.items;
                const prefabs = this.itemsGame.prefabs;

                let item = Object.keys(items).find((n) => {
                    const i = items[n];

                    return i.item_name && i.item_name.toLowerCase() === tag;
                });

                let path;

                if (!items[item] || !items[item].image_inventory) {
                    // search the prefabs (ex. CS:GO Case Key)
                    item = Object.keys(prefabs).find((n) => {
                        const i = prefabs[n];

                        return i.item_name && i.item_name.toLowerCase() === tag;
                    });

                    if (!prefabs[item] || !prefabs[item].image_inventory) continue;

                    path = `panorama/images/${prefabs[item].image_inventory}_png`;
                }
                else {
                    path = `panorama/images/${items[item].image_inventory}_png`;
                }

                const url = this.getPathURL(path, 'local');

                if (url) {
                    return url;
                }
            }
        }
    }
}

export default CSGOCdn;