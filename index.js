const Promise = require('bluebird');
const EventEmitter = require('events');
const fs = Promise.promisifyAll(require('fs'));
const vpk = require('vpk');
const vdf = require('simple-vdf');
const hasha = require('hasha');
const winston = require('winston');

const defaultConfig = {
    directory: 'data',
    updateInterval: 30000,
    stickers: true,
    graffiti: true,
    musicKits: true,
    cases: true,
    tools: true,
    statusIcons: true,
    logLevel: 'info'
};

const wears = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

const neededDirectories = {
    stickers: 'resource/flash/econ/stickers',
    graffiti: 'resource/flash/econ/stickers/default',
    musicKits: 'resource/flash/econ/music_kits',
    cases: 'resource/flash/econ/weapon_cases',
    tools: 'resource/flash/econ/tools',
    statusIcons: 'resource/flash/econ/status_icons',
};

function bytesToMB(bytes) {
    return (bytes/1000000).toFixed(2);
}

class CSGOCdn extends EventEmitter {
    get ready() {
        return this.ready_ || false;
    }

    get steamReady() {
        return this.user.client.connected;
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

        this.user = Promise.promisifyAll(steamUser, {multiArgs: true});

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

        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
    }

    /**
     * Runs the update loop at the specified config interval
     * @return {Promise<undefined>|void}
     */
    updateLoop() {
        if (this.config.updateInterval > 0) {
            return this.update().then(() => Promise.delay(this.config.updateInterval*1000))
                .then(() => this.updateLoop());
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
            this.user.getProductInfo([730], [], (apps, packages, unknownApps, unknownPackages) => {
                resolve([apps, packages, unknownApps, unknownPackages]);
            });
        });
    }

    /**
     * Returns the latest CSGO manifest ID for the public 731 depot
     * @return {*|PromiseLike<*[]>|Promise<*[]>} 731 Depot Manifest ID
     */
    getLatestManifestId() {
        this.log.debug('Obtaining latest manifest ID');
        return this.getProductInfo().then(([apps, packages, unknownApps, unknownPackages]) => {
            const csgo = apps['730'].appinfo;
            const commonDepot = csgo.depots['731'];

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

        const manifestId = await this.getLatestManifestId();

        this.log.debug(`Obtained latest manifest ID: ${manifestId}`);

        const [manifest] = await this.user.getManifestAsync(730, 731, manifestId);
        const manifestFiles = manifest.files;

        const dirFile = manifest.files.find((file) => file.filename.endsWith("pak01_dir.vpk"));
        const itemsGameFile = manifest.files.find((file) => file.filename.endsWith("items_game.txt"));
        const itemsGameCDNFile = manifest.files.find((file) => file.filename.endsWith("items_game_cdn.txt"));
        const csgoEnglishFile = manifest.files.find((file) => file.filename.endsWith("csgo_english.txt"));

        this.log.debug(`Downloading required static files`);

        await this.downloadFiles([dirFile, itemsGameFile, itemsGameCDNFile, csgoEnglishFile]);

        this.log.debug('Loading static file resources');

        this.loadResources();
        this.loadVPK();

        await this.downloadVPKFiles(this.vpkDir, manifestFiles);

        this.ready = true;
    }

    loadResources() {
        this.itemsGame = vdf.parse(fs.readFileSync(`${this.config.directory}/items_game.txt`, 'utf8'))['items_game'];
        this.csgoEnglish = vdf.parse(fs.readFileSync(`${this.config.directory}/csgo_english.txt`, 'ucs2'))['lang']['Tokens'];
        this.itemsGameCDN = this.parseItemsCDN(fs.readFileSync(`${this.config.directory}/items_game_cdn.txt`, 'utf8'));

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
     * Downloads the given VPK files from the Steam CDN
     * @param files Steam Manifest File Array
     * @return {Promise<>} Fulfilled when completed downloading
     */
    async downloadFiles(files) {
        const promises = [];

        for (const file of files) {
            let name = file.filename.split('\\');
            name = name[name.length-1];

            const path = `${this.config.directory}/${name}`;

            const isDownloaded = await this.isFileDownloaded(path, file.sha_content);

            if (isDownloaded) {
                continue;
            }

            const promise = this.user.downloadFileAsync(730, 731, file, `${this.config.directory}/${name}`);
            promises.push(promise);
        }

        return Promise.all(promises);
    }

    /**
     * Loads the CSGO dir VPK specified in the config
     */
    loadVPK() {
        this.vpkDir = new vpk(this.config.directory + '/pak01_dir.vpk');
        this.vpkDir.load();

        this.vpkFiles = this.vpkDir.files.filter((f) => f.startsWith('resource/flash/econ/stickers'));
    }

    /**
     * Given the CSGO VPK Directory, returns the necessary indices for the chosen options
     * @param vpkDir CSGO VPK Directory
     * @return {Array} Necessary Sticker VPK Indices
     */
    getRequiredVPKFiles(vpkDir) {
        const requiredIndices = [];

        const neededDirs = Object.keys(neededDirectories).filter((f) => !!this.config[f]).map((f) => neededDirectories[f]);

        for (const fileName of vpkDir.files) {
            for (const dir of neededDirs) {
                if (fileName.startsWith(dir)) {
                    const archiveIndex = vpkDir.tree[fileName].archiveIndex;

                    if (!requiredIndices.includes(archiveIndex)) {
                        requiredIndices.push(archiveIndex);
                    }

                    break;
                }
            }
        }

        return requiredIndices.sort();
    }

    /**
     * Downloads the required VPK files
     * @param vpkDir CSGO VPK Directory
     * @param manifestFiles Manifest files
     * @return {Promise<void>}
     */
    async downloadVPKFiles(vpkDir, manifestFiles) {
        this.log.debug('Computing required VPK files for selected packages');

        const requiredIndices = this.getRequiredVPKFiles(vpkDir);

        this.log.debug(`Required VPK files ${requiredIndices}`);

        for (let index in requiredIndices) {
            index = parseInt(index);

            // pad to 3 zeroes
            const archiveIndex = requiredIndices[index];
            const paddedIndex = '0'.repeat(3-archiveIndex.toString().length) + archiveIndex;
            const fileName = `pak01_${paddedIndex}.vpk`;

            const file = manifestFiles.find((f) => f.filename.endsWith(fileName));
            const filePath = `${this.config.directory}/${fileName}`;

            const isDownloaded = await this.isFileDownloaded(filePath, file.sha_content);

            if (isDownloaded) {
                this.log.info(`Already downloaded ${filePath}`);
                continue;
            }

            const status = `[${index+1}/${requiredIndices.length}]`;

            this.log.info(`${status} Downloading ${fileName} - ${bytesToMB(file.size)} MB`);

            const promise = new Promise((resolve, reject) => {
                const ee = this.user.downloadFile(730, 731, file, filePath, () => {
                    resolve();
                });

                ee.on('progress', (bytesDownloaded, totalSize) => {
                    this.log.info(`${status} ${(bytesDownloaded*100/totalSize).toFixed(2)}% - ${bytesToMB(bytesDownloaded)}/${bytesToMB(totalSize)} MB`);
                });
            });

            await promise;

            this.log.info(`${status} Downloaded ${fileName}`);
        }
    }

    /**
     * Returns whether a file at the given path has the given sha1
     * @param path File path
     * @param sha1 File SHA1 hash
     * @return {Promise<boolean>} Whether the file has the hash
     */
    async isFileDownloaded(path, sha1) {
        try {
            const hash = await hasha.fromFile(path, {algorithm: 'sha1'});

            return hash === sha1;
        }
        catch (e) {
            return false;
        }
    }

    /**
     * Given a VPK path, returns the CDN URL
     * @param path VPK path
     * @return {string|void} CDN URL
     */
    getPathURL(path) {
        const file = this.vpkDir.getFile(path);

        if (!file) {
            this.log.error(`Failed to retrieve ${path} in VPK, do you have the package category enabled in options?`);
            return;
        }

        const sha1 = hasha(file, {
            'algorithm': 'sha1'
        });

        path = path.replace('resource/flash', 'icons');
        path = path.replace('.png', `.${sha1}.png`);

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

        const fileName = large ? `${name}_large.png` : `${name}.png`;
        const path = this.vpkFiles.find((t) => t.endsWith(fileName));

        if (path) return this.getPathURL(path);
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
     * Returns whether the given name is a weapon by checking for condition
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

            const kitIndex = Object.keys(stickerKits).find((n) => {
                const k = stickerKits[n];

                return k.item_name === stickerTag;
            });

            const kit = stickerKits[kitIndex];

            if (!kit || !kit.sticker_material) continue;

            const url = this.getStickerURL(kit.sticker_material, true);

            if (url) {
                return url;
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

            const path = `resource/flash/${kit.image_inventory}.png`;

            const url = this.getPathURL(path);

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

                    path = `resource/flash/${prefabs[item].image_inventory}.png`;
                }
                else {
                    path = `resource/flash/${items[item].image_inventory}.png`;
                }

                const url = this.getPathURL(path);

                if (url) {
                    return url;
                }
            }
        }
    }
}

module.exports = CSGOCdn;
