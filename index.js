const pomParser = require("pom-parser");
const fs = require("fs");
const path = require("path")
const lib = "./lib/"
const glob = require('glob');
const fse = require('fs-extra');
const util = require("util");
const fetch = require("node-fetch");
const ora = require('ora');
const spinner = ora('Starting...')


const getDirectories =
    _path => fs.readdirSync(_path).filter(
        file => fs.statSync(`${_path}/${file}`).isDirectory()
    )

const filename =
    ({ artifactId, version }) =>
        util.format('%s-%s.%s', artifactId, version, 'jar');


const groupPath =
    ({ groupId, artifactId, version }) =>
        `${groupId.replace(/\./g, '/')}/${artifactId}/${version}`


const makeArtifactUrl =
    (artifact) =>
        `https://repo1.maven.org/maven2/${groupPath(artifact)}/${filename(artifact)}`;


const downloadArtifact = async (artifact, destination) => {
    const artifactUrl = makeArtifactUrl(artifact)
    const res = await fetch(artifactUrl);

    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(path.join(lib, filename(artifact)));
        res.body.pipe(fileStream);
        res.body.on("error", (err) => {
            reject(err);
        });
        fileStream.on("finish", function () {
            resolve();
        });
    });
}

const parsePom = (opts) =>
    new Promise(
        (resolve, reject) => {
            pomParser.parse(opts, function (err, pomResponse) {
                if (err) {
                    console.log("ERROR: " + err);
                    return;
                }

                Promise.all(
                    pomResponse.pomObject.project.dependencies.dependency
                        .map(({ groupid: groupId, scope, version, artifactid: artifactId }) => {
                            if (groupId !== "org.jolie-lang" && scope !== "test" && scope !== "compile") {
                                const artifact = { groupId, artifactId, version }
                                !fs.existsSync(lib) && fs.mkdirSync(lib);
                                return downloadArtifact(artifact, lib, "")
                            }
                        })
                )
                    .then(() => resolve())
                    .catch(() => reject())
            })
        }
    );

const mvnManager = () => {
    spinner.start()
    spinner.text = "Downloading Maven dependencies..."
    return Promise.all(
        getDirectories('./node_modules').map((dir) => {
            const filePath = path.join('node_modules', dir, 'pom.xml')
            return fs.existsSync(filePath) && parsePom({ filePath })
        })
    )
}


const joliePostInstall = () => {
    spinner.succeed("Maven Dependencies downloaded!")

    spinner.text = "Moving Jolie modules..."

    return Promise.all(
        getDirectories('./node_modules').map((dir) =>
            new Promise((resolve, reject) => {
                const dirPath = path.join('node_modules', dir)

                // TODO: check @jolie in folder instead of file extension.
                const filePath = path.join(dirPath, '*.ol')

                glob(filePath, {}, (err, files) => {
                    files.length > 0
                        ? fse.copy(dirPath, `packages/${dir}`, { overwrite: true }, function (err) {

                            if (err) console.error(err)
                            resolve()

                        })
                        : resolve()
                })
            })
        )
    )
}

const movingServices = () => {
    spinner.succeed("Jolie modules moved!")
    spinner.text = "Moving Java services to lib..."

    return Promise.all(
        getDirectories('./packages').map((dir) => {
            const target = `packages/${dir}/target`
            return new Promise((resolve, reject) => {
                fs.existsSync(target)
                    ? glob(target + '/*.jar', {}, (err, files) => {
                        Promise.all(
                            files
                                .map(file => file.split('/').pop())
                                .map(async file => {
                                    spinner.succeed()
                                    spinner.text = `Moving ${file} to lib...`
                                    await fse.copy(`${target}/${file}`, path.join(lib, file))
                                })
                        )
                            .then(() => {
                                fs.rmdirSync(target, { recursive: true });
                                resolve()
                            })
                            .catch(error => console.log(error))

                    })
                    : resolve()
            })
        })
    )
}

mvnManager()
    .then(() => joliePostInstall())
    .then(() => movingServices())
    .then(() => {
        spinner.succeed("Java services moved to lib!")
        spinner.succeed("👁 Done!")
    })
    .catch(error => console.error(error))