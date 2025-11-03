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

let release_id: number | undefined = undefined;
let remoteAssetNames: string[] = [];
try {
    const { data: latestRelease } = await octokit.rest.repos.getLatestRelease({
        owner,
        repo: ".github",
    });
    release_id = latestRelease.id;
    remoteAssetNames = latestRelease.assets.map((asset) => asset.name);
} catch (_) {
    console.log("No existing release found, proceeding with a new one.");
}

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

const localAssetNames = allAssets.map((asset) => asset.name);

if (remoteAssetNames.length > 0) {
    const remoteAssetSet = new Set(remoteAssetNames);
    const localAssetSet = new Set(localAssetNames);

    if (
        remoteAssetSet.size === localAssetSet.size &&
        [...remoteAssetSet].every((name) => localAssetSet.has(name))
    ) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT!, `skip=true\n`);
        console.log(" ==> No changes detected, skipping release.");
        process.exit(0);
    }
}

await $`rm -rf assets`;
await $`mkdir assets`;

for (const asset of allAssets) {
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

cd("assets");
await $`find . -name '*.pkg.tar.zst' | sort | xargs repo-add --include-sigs arjix-aur.db.tar.gz`;
{
    await fs.remove("arjix-aur.db");
    await fs.remove("arjix-aur.files");

    await fs.rename("arjix-aur.db.tar.gz", "arjix-aur.db");
    await fs.rename("arjix-aur.files.tar.gz", "arjix-aur.files");
}

if (release_id !== undefined) {
    await octokit.rest.repos.deleteRelease({
        owner,
        repo: ".github",
        release_id,
    });
}
