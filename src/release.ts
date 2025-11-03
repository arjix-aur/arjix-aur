import { Writable } from "node:stream";
import { Octokit } from "octokit";
import "zx/globals";

const org = "arjix-aur";
const owner = org;

const octokit = new Octokit({ auth: process.env.TOKEN });
const repos = await octokit.rest.repos.listForOrg({ org });

const packages = repos.data.filter(({ topics }) => topics?.includes("pkg"));

if (packages.length === 0) {
    console.error("No packages found.");
    process.exit(0);
}

let latestRelease;
try {
    latestRelease = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo: ".github",
        tag: "latest",
    });
} catch (error) {
    console.log("Latest release not found, creating a new one.");
    latestRelease = await octokit.rest.repos.createRelease({
        owner,
        repo: ".github",
        tag_name: "latest",
        name: "Latest",
        body: "Automated release of prebuilt packages",
        draft: false,
        prerelease: false,
    });
}

const release_id = latestRelease.data.id;
let remoteAssetNames = latestRelease.data.assets.map((asset) => asset.name);

const allAssets = [];
for (const { name: repo } of packages) {
    const { status, data: releases } = await octokit.rest.repos.listReleases({
        owner,
        repo,
    });

    if (status !== 200) {
        console.error(`Failed to list releases for ${owner}/${repo}`);
        continue;
    }

    const assets = releases.flatMap(({ assets }) => assets);
    for (const _ of assets) {
        console.log(" ==> Found", _.name);
        allAssets.push(_);
    }
}

await $`rm -rf assets`;
await $`mkdir assets`;

const assetsToDownload = allAssets.filter(
    (asset) => !remoteAssetNames.includes(asset.name)
);

if (assetsToDownload.length === 0) {
    console.log("No new assets to download.");
} else {
    for (const asset of assetsToDownload) {
        console.log(" ==> Downloading", asset.name);

        const { data: stream } = await octokit.request<ReadableStream<Uint8Array>>({
            url: asset.browser_download_url,
            mediaType: {
                format: "raw",
            },
            request: {
                parseSuccessResponseBody: false,
            },
        });

        const fileStream = fs.createWriteStream(path.resolve("assets", asset.name));
        await stream.pipeTo(Writable.toWeb(fileStream));
    }
}

// Download existing arjix-aur.db and arjix-aur.files (and their .sig counterparts)
// from the remote release, and rename them for repo-add.
const repoFilesToDownload = [
    "arjix-aur.db",
    "arjix-aur.files",
];

for (const fileName of repoFilesToDownload) {
    const remoteAsset = latestRelease.data.assets.find((asset) => asset.name === fileName);
    if (remoteAsset) {
        console.log(" ==> Downloading existing repo file", fileName);
        const { data: stream } = await octokit.request<ReadableStream<Uint8Array>>({
            url: remoteAsset.browser_download_url,
            mediaType: {
                format: "raw",
            },
            request: {
                parseSuccessResponseBody: false,
            },
        });
        const fileStream = fs.createWriteStream(path.resolve("assets", fileName));
        await stream.pipeTo(Writable.toWeb(fileStream));

        if (fileName.endsWith(".db") || fileName.endsWith(".files")) {
            await fs.rename(path.resolve("assets", fileName), path.resolve("assets", `${fileName}.tar.gz`));
            await fs.symlink(path.resolve("assets", `${fileName}.tar.gz`), path.resolve("assets", `${fileName}`));
        }
    }
}

cd("assets");

await $`find . -name '*.pkg.tar.zst' | sort | xargs repo-add --include-sigs arjix-aur.db.tar.gz`;
{
    // Rename the updated .tar.gz files back to their original names
    await fs.rename("arjix-aur.db.tar.gz", "arjix-aur.db");
    await fs.rename("arjix-aur.files.tar.gz", "arjix-aur.files");
}

const expectedLocalAssetNames = new Set([
    ...allAssets.map((asset) => asset.name),
    "arjix-aur.db",
    "arjix-aur.files",
]);

// Delete remote assets that are not in expected local assets
for (const remoteAssetName of remoteAssetNames) {
    if (!expectedLocalAssetNames.has(remoteAssetName)) {
        console.log(" ==> Deleting remote asset", remoteAssetName);
        const assetToDelete = latestRelease.data.assets.find(
            (asset) => asset.name === remoteAssetName
        );
        if (assetToDelete) {
            await octokit.rest.repos.deleteReleaseAsset({
                owner,
                repo: ".github",
                asset_id: assetToDelete.id,
            });
        }
    }
}

// Upload or re-upload repository files (db, files, and their sigs)
const repoFilesToUpload = [
    "arjix-aur.db",
    "arjix-aur.files",
];

for (const fileName of repoFilesToUpload) {
    if (fs.existsSync(fileName)) {
        console.log(" ==> Uploading repo file", fileName);
        const existingAsset = latestRelease.data.assets.find((asset) => asset.name === fileName);
        if (existingAsset) {
            await octokit.rest.repos.deleteReleaseAsset({
                owner,
                repo: ".github",
                asset_id: existingAsset.id,
            });
        }
        await octokit.rest.repos.uploadReleaseAsset({
            owner,
            repo: ".github",
            release_id: release_id,
            name: fileName,
            data: await fs.readFile(fileName) as any,
        });
    }
}

// Upload other local assets that are not in remote assets
for (const localAssetName of await fs.readdir(".")) {
    if (!repoFilesToUpload.includes(localAssetName) && !remoteAssetNames.includes(localAssetName)) {
        console.log(" ==> Uploading", localAssetName);
        await octokit.rest.repos.uploadReleaseAsset({
            owner,
            repo: ".github",
            release_id: release_id,
            name: localAssetName,
            data: await fs.readFile(localAssetName) as any,
        });
    }
}

