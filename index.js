const Promise = require('bluebird');
const EventEmitter = require('events');
const fs = require('fs');
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
        if (r !== this.ready) {
            this.emit(r ? 'ready' : 'unready');
        }

        this.ready_ = r;
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

    createDataDirectory() {
        const dir = `./${this.config.directory}`;

        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
    }

    updateLoop() {
        return this.update().then(() => Promise.delay(this.config.updateInterval*1000)).then(() => this.updateLoop());
    }

    getProductInfo() {
        return new Promise((resolve, reject) => {
            this.user.getProductInfo([730], [], (apps, packages, unknownApps, unknownPackages) => {
                resolve([apps, packages, unknownApps, unknownPackages]);
            });
        });
    }

    getLatestManifestId() {
        return this.getProductInfo().then(([apps, packages, unknownApps, unknownPackages]) => {
            const csgo = apps['730'].appinfo;
            const commonDepot = csgo.depots['731'];

            return commonDepot.manifests.public;
        });
    }

    update() {
        let manifestId;
        let manifestFiles;
        let vpkDir;

        return this.getLatestManifestId().then((id) => {
              manifestId = id;

              return this.user.getManifestAsync(730, 731, manifestId);
        }).then(([manifest]) => {
            // download the VPK directory
            manifestFiles = manifest.files;

            const dirFile = manifest.files.find((file) => file.filename.endsWith("pak01_dir.vpk"));

            if (!dirFile) {
                throw new Error('Failed to find VPK directory file in manifest');
            }

            return this.user.downloadFileAsync(730, 731, dirFile, this.config.directory + '/pak01_dir.vpk');
        }).then(() => {
            vpkDir = new vpk(this.config.directory + '/pak01_dir.vpk');
            vpkDir.load();

            return this.downloadStickerFiles(vpkDir, manifestFiles);
        }).then(() => {
            this.vpkDir = vpkDir;
            this.vpkFiles = vpkDir.files.filter((f) => f.startsWith('resource/flash/econ/stickers'));

            this.ready = true;
        });
    }

    getRequiredStickerFiles(vpkDir) {
        // get required vpk files for the stickers
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

            console.log(file.sha_content);

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

    async isFileDownloaded(path, md5) {
        try {
            const hash = await hasha.fromFile(path, {algorithm: 'sha1'});

            return hash === md5;
        }
        catch (e) {
            return false;
        }
    }

    getStickerURL(stickerName, large=false) {
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

