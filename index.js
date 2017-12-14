const Promise = require('bluebird');
const EventEmitter = require('events');
const fs = Promise.promisifyAll(require('fs'));
const vpk = require('vpk');
const hasha = require('hasha');

const defaultConfig = {
    directory: 'data',
    updateInterval: 30000,
};

function bytesToMB(bytes) {
    return (bytes/1000000).toFixed(2);
}

class CSGOStickers extends EventEmitter {
    get ready() {
        return this.ready_ || false;
    }

    set ready(r) {
        const old = this.ready;
        this.ready_ = r;

        if (r !== old) {
            this.emit(r ? 'ready' : 'unready');
        }
    }

    constructor(steamUser, config={}) {
        super();

        this.config = Object.assign(defaultConfig, config);

        this.createDataDirectory();

        this.user = Promise.promisifyAll(steamUser, {multiArgs: true});

        this.updateLoop().catch((err) => {
            throw err;
        });
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
     * @return {Promise<undefined>}
     */
    updateLoop() {
        return this.update().then(() => Promise.delay(this.config.updateInterval*1000)).then(() => this.updateLoop());
    }

    /**
     * Returns the product info for CSGO, with its depots and packages
     */
    getProductInfo() {
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
        return this.getProductInfo().then(([apps, packages, unknownApps, unknownPackages]) => {
            const csgo = apps['730'].appinfo;
            const commonDepot = csgo.depots['731'];

            return commonDepot.manifests.public;
        });
    }

    /**
     * Returns the saved manifest ID for the current files
     * @return {Promise<string>} Saved manifest ID
     */
    async getSavedManifestId() {
        const path = `${this.config.directory}/manifestId`;
        const exists = fs.existsSync(path);

        if (!exists) return;

        const f = await fs.readFileAsync(path);

        return f.toString();
    }

    /**
     * Saves the given manifest ID to the file in the config
     * @param id Manifest ID to save
     * @return {*}
     */
    saveManifestId(id) {
        return fs.writeFileAsync(`${this.config.directory}/manifestId`, id);
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
        const manifestId = await this.getLatestManifestId();
        const savedManifestId = await this.getSavedManifestId();

        if (savedManifestId === manifestId) {
            // already downloaded, just load it
            if (!this.vpkDir) this.loadVPK();
        }
        else {
            const [manifest] = await this.user.getManifestAsync(730, 731, manifestId);
            const manifestFiles = manifest.files;

            const dirFile = manifest.files.find((file) => file.filename.endsWith("pak01_dir.vpk"));

            if (!dirFile) {
                throw new Error('Failed to find VPK directory file in manifest');
            }

            await this.user.downloadFileAsync(730, 731, dirFile, this.config.directory + '/pak01_dir.vpk');

            this.loadVPK();

            await this.downloadStickerFiles(this.vpkDir, manifestFiles);

            this.saveManifestId(manifestId);
        }

        this.ready = true;
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
     * Given the CSGO VPK Directory, returns the necessary indices for stickers
     * @param vpkDir CSGO VPK Directory
     * @return {Array} Necessary Sticker VPK Indices
     */
    getRequiredStickerFiles(vpkDir) {
        const requiredIndices = [];

        for (const fileName of vpkDir.files) {
            if (fileName.startsWith('resource/flash/econ/stickers')) {
                const archiveIndex = vpkDir.tree[fileName].archiveIndex;

                if (!requiredIndices.includes(archiveIndex)) {
                    requiredIndices.push(archiveIndex);
                }
            }
        }

        return requiredIndices.sort();
    }

    /**
     * Downloads the required sticker VPK files
     * @param vpkDir CSGO VPK Directory
     * @param manifestFiles Manifest files
     * @return {Promise<void>}
     */
    async downloadStickerFiles(vpkDir, manifestFiles) {
        const requiredIndices = this.getRequiredStickerFiles(vpkDir);

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
                console.log(`Already downloaded ${filePath}`);
                continue;
            }

            const status = `[${index+1}/${requiredIndices.length}]`;

            console.log(`${status} Downloading ${fileName} - ${bytesToMB(file.size)} MB`);

            const promise = new Promise((resolve, reject) => {
                const ee = this.user.downloadFile(730, 731, file, filePath, () => {
                    resolve();
                });

                ee.on('progress', (bytesDownloaded, totalSize) => {
                     console.log(`${status} ${(bytesDownloaded*100/totalSize).toFixed(2)}% - ${bytesToMB(bytesDownloaded)}/${bytesToMB(totalSize)} MB`);
                });
            });

            await promise;

            console.log(`${status} Downloaded ${fileName}`);
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
     * Returns the sticker Steam CDN URL for the specified sticker name
     *
     * Example Sticker Names: cologne2016/nv, cologne2016/fntc_holo, cologne2016/fntc_foil, cluj2015/sig_olofmeister_gold
     *
     * You can find the sticker names from their relevant "sticker_material" fields in items_game.txt
     *      items_game.txt can be found in the core game files of CS:GO
     *
     * @param stickerName The sticker name (the sticker_material field in items_game.txt)
     * @param large Whether to obtain the "large" CDN version of the sticker
     * @return {string|void} If successful, the HTTPS CDN URL for the sticker
     */
    getStickerURL(stickerName, large=false) {
        if (!this.ready) {
            return;
        }

        const fileName = large ? `${stickerName}_large.png` : `${stickerName}.png`;

        let path = this.vpkFiles.find((t) => t.endsWith(fileName));

        if (!path) return;

        const file = this.vpkDir.getFile(path);

        const md5 = hasha(file, {
            'algorithm': 'sha1'
        });

        path = path.replace('resource/flash', 'icons');
        path = path.replace('.png', `.${md5}.png`);

        return `https://steamcdn-a.akamaihd.net/apps/730/${path}`;
    }
}

module.exports = CSGOStickers;
