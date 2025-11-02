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
    for (const asset of assets) {
        console.log(" ==> Found", asset.name);
        allAssets.push(asset);
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
