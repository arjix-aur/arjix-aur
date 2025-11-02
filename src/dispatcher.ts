import { cwd } from "node:process";
import { Octokit } from "octokit";
import "zx/globals";

const ORG = "arjix-aur";

const octokit = new Octokit({ auth: process.env.TOKEN });
const repos = await octokit.rest.repos.listForOrg({
    org: "arjix-aur",
});

const packages = repos.data
    .filter(({ topics }) => topics?.includes("pkg"))
    .map(({ name, ssh_url }) => ({
        pkg: name.replace(/^pkg-/, ""),
        repo: name,
        ssh_url,
    }));

if (packages.length === 0) {
    console.error("No packages found.");
    process.exit(0);
}

const CLONES_DIR = "/home/docker/.clones";
{
    await $`runuser -u docker -- rm -rf ${CLONES_DIR}`;
    await $`runuser -u docker -- mkdir ${CLONES_DIR}`;
    cd(CLONES_DIR);
}

const origin = cwd();

const repositories: { org: string; repo: string; tag: string }[] = [];

for (const { pkg, repo } of packages) {
    cd(origin);

    try {
        await $`runuser -u docker -- paru -G ${pkg}`;
        cd(pkg);

        await $`runuser -u docker -- makepkg -so --noprepare --noconfirm`.quiet(true);

        const version = await $`source PKGBUILD > /dev/null && echo -n "\${pkgver}-\${pkgrel}"`.text();
        const tag = `aur/${version}`;

        repositories.push({ org: ORG, repo, tag });
    } catch (e) {
        console.error(`Failed to fetch version for ${pkg}`, e);
        fs.remove(path.resolve(origin, pkg));
    }
}

cd("..");
fs.remove(origin);

for (const { org, repo, tag } of repositories) {
    console.log("checking", { repo, tag });

    try {
        await octokit.rest.git.getRef({
            owner: org,
            repo,
            ref: `tags/${tag}`,
        });

        console.log(`${repo} is up to date`);
        continue;
    } catch {}

    const release = await octokit.rest.repos.createRelease({
        owner: org,
        repo,
        tag_name: tag,
        target_commitish: "main",
        name: tag,
        body: "",
        draft: false,
        prerelease: false,
    });

    if (release.status !== 201) {
        console.error(`Failed to create release for ${repo}/${tag}`);
        process.exit(1);
    }
}
